/**
 * /api/match-kusum-lead.js — KUSUM-specialist vendor matching engine (v0.9)
 *
 * Mirrors api/match-lead.js but KUSUM-specific:
 *   - Filters vendors to kusum_specialist=true only
 *   - Matches on component support (vendor must handle A, B, or C)
 *   - Different scoring (drought district priority, Component A premium)
 *   - 48-hour expiry (KUSUM sales cycle is slower than rooftop)
 *   - Writes to kusum_lead_assignments table (NOT lead_assignments)
 *
 * Protected by MATCH_INTERNAL_TOKEN env var.
 * Called by api/kusum-lead.js automatically for HOT/WARM tiers.
 * Can also be called directly by admin for manual reassignment.
 *
 * ENV VARS:
 *   SUPABASE_URL
 *   SUPABASE_SERVICE_ROLE_KEY
 *   MATCH_INTERNAL_TOKEN
 *   WHATSAPP_API_KEY
 *   WHATSAPP_PROVIDER
 *   PORTAL_BASE_URL
 *   MSG91_INTEGRATED_NUMBER (only if provider=msg91)
 */

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  // Auth: require internal token
  const token = req.headers['x-internal-token'];
  if (!token || token !== process.env.MATCH_INTERNAL_TOKEN) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  try {
    const { kusumLeadId, excludeVendorIds = [] } = req.body || {};
    if (!kusumLeadId) return res.status(400).json({ error: 'kusumLeadId required' });

    const result = await matchKusumLead(kusumLeadId, excludeVendorIds);
    return res.status(200).json(result);
  } catch (err) {
    console.error('matchKusumLead error:', err);
    return res.status(500).json({ error: 'Internal error', detail: err.message });
  }
}

/**
 * Core matching logic — exported for direct invocation from kusum-lead.js
 */
export async function matchKusumLead(kusumLeadId, excludeVendorIds = []) {
  const supabaseUrl = process.env.SUPABASE_URL;
  const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  
  if (!supabaseUrl || !supabaseKey) {
    return { matched: false, reason: 'supabase_not_configured' };
  }

  // ===== Fetch the lead =====
  const leadRes = await fetch(`${supabaseUrl}/rest/v1/kusum_leads?id=eq.${kusumLeadId}&select=*`, {
    headers: {
      'apikey': supabaseKey,
      'Authorization': `Bearer ${supabaseKey}`
    }
  });
  
  if (!leadRes.ok) {
    return { matched: false, reason: 'lead_fetch_failed' };
  }
  
  const leads = await leadRes.json();
  if (!leads.length) {
    return { matched: false, reason: 'lead_not_found' };
  }
  
  const lead = leads[0];
  
  // Skip ineligible leads
  if (lead.recommended_component === 'ineligible' || lead.recommended_component === 'needs_review') {
    return { matched: false, reason: 'lead_not_eligible', component: lead.recommended_component };
  }
  
  // Skip if already assigned (idempotency check)
  const existingRes = await fetch(
    `${supabaseUrl}/rest/v1/kusum_lead_assignments?kusum_lead_id=eq.${kusumLeadId}&outcome=eq.pending&select=id`,
    {
      headers: {
        'apikey': supabaseKey,
        'Authorization': `Bearer ${supabaseKey}`
      }
    }
  );
  
  if (existingRes.ok) {
    const existing = await existingRes.json();
    if (existing.length > 0 && excludeVendorIds.length === 0) {
      return { matched: false, reason: 'already_assigned', assignmentId: existing[0].id };
    }
  }
  
  // ===== Fetch eligible KUSUM-specialist vendors =====
  // Must be: active=true, kusum_specialist=true, covers district, supports component
  const component = lead.recommended_component;
  const district = lead.district_slug;
  
  // Query KUSUM-specialist vendors
  let vendorQuery = `${supabaseUrl}/rest/v1/vendors?` +
    `active=eq.true&` +
    `kusum_specialist=eq.true&` +
    `select=id,company_name,brand_name,phone,whatsapp_phone,email,tier,coverage_districts,kusum_components,kusum_pump_brands,kusum_max_pump_hp,kusum_borewell_capability,kusum_vfd_certified,kusum_5yr_amc_offered,commission_rate,response_time_avg_minutes,close_rate_kusum`;
  
  const vendorsRes = await fetch(vendorQuery, {
    headers: {
      'apikey': supabaseKey,
      'Authorization': `Bearer ${supabaseKey}`
    }
  });
  
  if (!vendorsRes.ok) {
    return { matched: false, reason: 'vendors_query_failed' };
  }
  
  const allVendors = await vendorsRes.json();
  
  // ===== Filter by hard requirements =====
  const eligible = allVendors.filter(v => {
    // Exclude explicitly excluded vendors (e.g., on reassignment)
    if (excludeVendorIds.includes(v.id)) return false;
    
    // Must cover the district
    if (!v.coverage_districts || !v.coverage_districts.includes(district)) return false;
    
    // Must support the recommended component
    if (!v.kusum_components || v.kusum_components.length === 0) return false;
    const componentLetter = component === 'C1' || component === 'C2' ? 'C' : component; // C1/C2 both need C-capable
    if (!v.kusum_components.includes(componentLetter)) return false;
    
    // For Component B, must handle the recommended pump HP
    if (component === 'B' && lead.pump_hp) {
      if (!v.kusum_max_pump_hp || v.kusum_max_pump_hp < lead.pump_hp) return false;
    }
    
    return true;
  });
  
  if (eligible.length === 0) {
    // Update lead status to flag for admin manual triage
    await fetch(`${supabaseUrl}/rest/v1/kusum_leads?id=eq.${kusumLeadId}`, {
      method: 'PATCH',
      headers: {
        'apikey': supabaseKey,
        'Authorization': `Bearer ${supabaseKey}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ status: 'unmatched_no_vendor' })
    });
    
    return {
      matched: false,
      reason: 'no_eligible_vendors',
      component: component,
      district: district,
      diagnostic: {
        total_kusum_specialists: allVendors.length,
        excluded_count: excludeVendorIds.length,
        criteria_failures: 'no vendor covers district + component combination'
      }
    };
  }
  
  // ===== Score each eligible vendor =====
  const scored = eligible.map(v => {
    let score = 0;
    const diagnostic = [];
    
    // Tier weight (KUSUM tier hierarchy: premium > standard > probation)
    if (v.tier === 'premium') { score += 30; diagnostic.push('tier_premium:+30'); }
    else if (v.tier === 'standard') { score += 20; diagnostic.push('tier_standard:+20'); }
    else if (v.tier === 'probation') { score += 10; diagnostic.push('tier_probation:+10'); }
    
    // Component A premium routing (it's a ₹Cr+ deal)
    if (component === 'A' && v.tier === 'premium') {
      score += 25;
      diagnostic.push('component_a_premium_bonus:+25');
    }
    
    // KUSUM HOT lead bonus
    if (lead.kusum_lead_tier === 'HOT') {
      score += 15;
      diagnostic.push('hot_lead:+15');
    }
    
    // Drought district priority (Bundelkhand)
    const bundelkhand = ['jhansi', 'jalaun', 'lalitpur', 'banda', 'hamirpur', 'mahoba', 'chitrakoot'];
    if (bundelkhand.includes(district)) {
      // Bonus for vendors who already operate in Bundelkhand (proven coverage)
      const bundelkhandCoverage = v.coverage_districts.filter(d => bundelkhand.includes(d)).length;
      if (bundelkhandCoverage >= 3) {
        score += 10;
        diagnostic.push('bundelkhand_specialist:+10');
      }
    }
    
    // Vendor capabilities bonus
    if (v.kusum_borewell_capability === true) {
      score += 5;
      diagnostic.push('borewell_capable:+5');
    }
    if (v.kusum_vfd_certified === true) {
      score += 5;
      diagnostic.push('vfd_certified:+5');
    }
    if (v.kusum_5yr_amc_offered === true) {
      score += 8;
      diagnostic.push('5yr_amc:+8');
    }
    
    // Response time score (faster = better)
    if (v.response_time_avg_minutes) {
      if (v.response_time_avg_minutes < 60) { score += 10; diagnostic.push('fast_response:+10'); }
      else if (v.response_time_avg_minutes < 240) { score += 5; diagnostic.push('moderate_response:+5'); }
      else if (v.response_time_avg_minutes > 1440) { score -= 10; diagnostic.push('slow_response:-10'); }
    }
    
    // Historical close rate on KUSUM
    if (v.close_rate_kusum) {
      if (v.close_rate_kusum > 0.30) { score += 15; diagnostic.push('high_close_rate:+15'); }
      else if (v.close_rate_kusum > 0.15) { score += 8; diagnostic.push('mid_close_rate:+8'); }
      else if (v.close_rate_kusum < 0.05) { score -= 10; diagnostic.push('low_close_rate:-10'); }
    }
    
    return { ...v, _score: score, _diagnostic: diagnostic };
  });
  
  // Sort by score descending
  scored.sort((a, b) => b._score - a._score);
  const winner = scored[0];
  
  // ===== Create assignment =====
  const now = new Date();
  const expiresAt = new Date(now.getTime() + 48 * 60 * 60 * 1000); // 48 hours
  
  // Calculate commission amount (5% on KUSUM benchmark)
  const benchmarkCost = lead.estimated_gross_cost || 0;
  const commissionRate = winner.commission_rate || 5.0;
  const commissionAmount = Math.round(benchmarkCost * commissionRate / 100);
  
  const assignmentRes = await fetch(`${supabaseUrl}/rest/v1/kusum_lead_assignments`, {
    method: 'POST',
    headers: {
      'apikey': supabaseKey,
      'Authorization': `Bearer ${supabaseKey}`,
      'Content-Type': 'application/json',
      'Prefer': 'return=representation'
    },
    body: JSON.stringify({
      kusum_lead_id: kusumLeadId,
      vendor_id: winner.id,
      assigned_at: now.toISOString(),
      expires_at: expiresAt.toISOString(),
      assignment_method: excludeVendorIds.length > 0 ? 'reassignment' : 'auto_match',
      recommended_component: component,
      recommended_pump_hp: lead.pump_hp,
      outcome: 'pending',
      benchmark_cost_inr: benchmarkCost,
      commission_rate: commissionRate,
      commission_amount: commissionAmount,
      commission_status: 'pending'
    })
  });
  
  if (!assignmentRes.ok) {
    const err = await assignmentRes.text();
    console.error('KUSUM assignment insert failed:', err);
    return { matched: false, reason: 'assignment_insert_failed', detail: err };
  }
  
  const assignment = (await assignmentRes.json())[0];
  
  // Update lead status
  await fetch(`${supabaseUrl}/rest/v1/kusum_leads?id=eq.${kusumLeadId}`, {
    method: 'PATCH',
    headers: {
      'apikey': supabaseKey,
      'Authorization': `Bearer ${supabaseKey}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({ status: 'assigned' })
  });
  
  // ===== Notify vendor via WhatsApp =====
  await notifyKusumVendor({
    provider: process.env.WHATSAPP_PROVIDER || 'webhook',
    apiKey: process.env.WHATSAPP_API_KEY,
    vendor: winner,
    lead: lead,
    assignment: assignment,
    component: component,
    commissionAmount: commissionAmount,
    portalBaseUrl: process.env.PORTAL_BASE_URL || 'https://solarsubsidies.com'
  });
  
  return {
    matched: true,
    assignmentId: assignment.id,
    vendorId: winner.id,
    vendorName: winner.company_name,
    vendorPhone: winner.phone,
    component: component,
    score: winner._score,
    diagnostic: winner._diagnostic,
    commissionAmount: commissionAmount,
    expiresAt: expiresAt.toISOString(),
    candidatesConsidered: eligible.length,
    assignmentMethod: excludeVendorIds.length > 0 ? 'reassignment' : 'auto_match'
  };
}

// =====================================================
// WHATSAPP NOTIFICATION TO ASSIGNED VENDOR
// =====================================================
async function notifyKusumVendor({ provider, apiKey, vendor, lead, assignment, component, commissionAmount, portalBaseUrl }) {
  if (!apiKey) return;
  
  const vendorPhone = vendor.whatsapp_phone || vendor.phone;
  if (!vendorPhone) {
    console.warn('KUSUM vendor has no phone for WhatsApp:', vendor.id);
    return;
  }
  
  const tierEmoji = lead.kusum_lead_tier === 'HOT' ? '🔥' : lead.kusum_lead_tier === 'WARM' ? '🟡' : '⚪';
  
  const componentLabel = {
    'A': '🏛️ Component A (Solar Plant ' + (lead.estimated_system_kw ? `~${Math.round(lead.estimated_system_kw/1000)} MW` : '') + ')',
    'B': `💧 Component B (${lead.pump_hp || '?'} HP Standalone Pump)`,
    'C1': '⚡ Component C1 (Grid-Pump Solarisation)',
    'C2': '⚡ Component C2 (Feeder-Level Solarisation)'
  }[component] || component;
  
  const message = `${tierEmoji} NEW KUSUM LEAD ASSIGNED — ${vendor.company_name}

🌾 ${lead.name}
📞 ${lead.phone}
📍 ${lead.district_slug || '—'}${lead.village_or_tehsil ? ', ' + lead.village_or_tehsil : ''}

✨ ${componentLabel}

🌾 Land: ${lead.land_owned_acres || '—'} acres
💧 Water: ${lead.water_source || '—'} ${lead.water_depth_ft ? `(${lead.water_depth_ft} ft depth)` : ''}
🌺 Crops: ${lead.primary_crops || '—'}
⚡ Pump situation: ${lead.pump_situation || '—'}

💰 Estimated cost: ₹${lead.estimated_gross_cost ? Number(lead.estimated_gross_cost).toLocaleString('en-IN') : '—'}
💸 Subsidy: ₹${((lead.estimated_subsidy_central || 0) + (lead.estimated_subsidy_state || 0)).toLocaleString('en-IN')}
👤 Farmer share: ₹${lead.estimated_farmer_contribution ? Number(lead.estimated_farmer_contribution).toLocaleString('en-IN') : '—'}

💵 Your commission on close: ₹${commissionAmount.toLocaleString('en-IN')} (${vendor.commission_rate || 5}%)

⏰ Respond within 48 hours or this lead reassigns.

👉 Claim/decline: ${portalBaseUrl}/vendors/portal.html?leadId=${assignment.id}

—
KUSUM = MNRE pump empanellment + UPNEDA approval required for installation.
Lead ID: ${assignment.id.slice(0, 8).toUpperCase()}`;
  
  try {
    switch (provider) {
      case 'aisensy':
        return await fetch('https://backend.aisensy.com/campaign/t1/api/v2', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            apiKey,
            campaignName: 'kusum_vendor_lead_assigned',
            destination: vendorPhone,
            userName: vendor.company_name,
            templateParams: [vendor.company_name, lead.name, component, assignment.id.slice(0, 8)]
          })
        });
      case 'interakt':
        return await fetch('https://api.interakt.ai/v1/public/message/', {
          method: 'POST',
          headers: { 'Authorization': `Basic ${apiKey}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({
            countryCode: '+91',
            phoneNumber: vendorPhone.replace('+91', ''),
            type: 'Text',
            data: { message }
          })
        });
      case 'msg91':
        return await fetch('https://api.msg91.com/api/v5/whatsapp/whatsapp-outbound-message/bulk/', {
          method: 'POST',
          headers: { 'authkey': apiKey, 'Content-Type': 'application/json' },
          body: JSON.stringify({
            integrated_number: process.env.MSG91_INTEGRATED_NUMBER,
            content_type: 'template',
            payload: {
              to: [vendorPhone],
              type: 'template',
              template: { name: 'kusum_vendor_lead_assigned', body_text: [message] }
            }
          })
        });
      default:
        if (apiKey?.startsWith('http')) {
          return await fetch(apiKey, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ to: vendorPhone, message })
          });
        }
    }
  } catch (e) {
    console.error('KUSUM vendor notification error:', e);
  }
}
