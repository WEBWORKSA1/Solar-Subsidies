/**
 * /api/match-kusum-lead.js — KUSUM-specialist vendor matching engine (v0.9.0)
 *
 * Mirrors api/match-lead.js but KUSUM-specific. Aligned to canonical schema
 * in data/0008_kusum_and_directory.sql.
 *
 * Key behaviors:
 *   - Filters vendors WHERE handles_kusum=true (canonical column)
 *   - Matches on kusum_components @> {recommended_component}
 *   - Different scoring: drought district priority, Component A → premium routing
 *   - 48-hour expiry (KUSUM cycle is slower than rooftop's 24hr)
 *   - Writes to kusum_lead_assignments table (NOT lead_assignments)
 *   - KUSUM commission ALWAYS 5% (regardless of vendor's rooftop commission_rate)
 *     v0.9.0 FIX: previously inherited vendor.commission_rate which conflated
 *     rooftop and KUSUM economics. KUSUM has different unit economics — 5% is
 *     hardcoded until/unless we add vendors.kusum_commission_rate column.
 *
 * Protected by MATCH_INTERNAL_TOKEN env var.
 * Called by api/kusum-lead.js automatically for HOT/WARM tiers.
 * Can be called by admin /api/admin?action=reassign-kusum-lead for manual reassignment.
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

const KUSUM_COMMISSION_PCT = 5.0;  // Hardcoded; different unit economics from rooftop

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const token = req.headers['x-internal-token'] || req.query.token;
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
 * Core matching logic. Exportable for direct calls from kusum-lead.js or admin.js.
 */
export async function matchKusumLead(kusumLeadId, excludeVendorIds = []) {
  const supabaseUrl = process.env.SUPABASE_URL;
  const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!supabaseUrl || !supabaseKey) {
    return { matched: false, reason: 'supabase_not_configured' };
  }

  const headers = {
    'apikey': supabaseKey,
    'Authorization': `Bearer ${supabaseKey}`
  };

  // ===== 1. Fetch the KUSUM lead =====
  const leadRes = await fetch(
    `${supabaseUrl}/rest/v1/kusum_leads?id=eq.${kusumLeadId}&select=*`,
    { headers }
  );
  if (!leadRes.ok) return { matched: false, reason: 'lead_fetch_failed' };

  const leads = await leadRes.json();
  if (!leads.length) return { matched: false, reason: 'lead_not_found' };
  const lead = leads[0];

  if (lead.recommended_component === 'ineligible' || lead.recommended_component === 'needs_review') {
    return { matched: false, reason: 'lead_not_eligible', component: lead.recommended_component };
  }
  if (lead.kusum_lead_tier === 'COLD') {
    return { matched: false, reason: 'cold_lead_admin_triage_only' };
  }

  // ===== 2. Idempotency =====
  if (excludeVendorIds.length === 0) {
    const existingRes = await fetch(
      `${supabaseUrl}/rest/v1/kusum_lead_assignments?kusum_lead_id=eq.${kusumLeadId}&outcome=eq.pending&select=id`,
      { headers }
    );
    if (existingRes.ok) {
      const existing = await existingRes.json();
      if (existing.length > 0) {
        return { matched: false, reason: 'already_assigned', assignmentId: existing[0].id };
      }
    }
  }

  // ===== 3. Fetch eligible KUSUM-specialist vendors =====
  const component = lead.recommended_component;
  const componentToMatch = (component === 'C1' || component === 'C2') ? 'C' : component;

  let vendorQuery = `${supabaseUrl}/rest/v1/vendors?` +
    `active=eq.true&` +
    `tier=neq.suspended&` +
    `handles_kusum=eq.true&` +
    `coverage_districts=cs.{${lead.district_slug}}&` +
    `kusum_components=cs.{${componentToMatch}}&` +
    `select=id,company_name,brand_name,phone,email,tier,commission_rate,` +
    `coverage_districts,kusum_components,avg_response_time_minutes,` +
    `leads_received,leads_closed,lead_capacity_per_week`;

  if (excludeVendorIds.length > 0) {
    vendorQuery += `&id=not.in.(${excludeVendorIds.join(',')})`;
  }

  const vendorsRes = await fetch(vendorQuery, { headers });
  if (!vendorsRes.ok) {
    const err = await vendorsRes.text();
    console.error('KUSUM vendor query failed:', err);
    return { matched: false, reason: 'vendors_query_failed', detail: err };
  }

  const candidates = await vendorsRes.json();

  if (candidates.length === 0) {
    await fetch(`${supabaseUrl}/rest/v1/kusum_leads?id=eq.${kusumLeadId}`, {
      method: 'PATCH',
      headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: 'documents_pending' })
    });
    return {
      matched: false,
      reason: 'no_eligible_vendors',
      component,
      district: lead.district_slug,
      excluded: excludeVendorIds.length
    };
  }

  // ===== 4. Score each candidate =====
  const bundelkhand = ['jhansi', 'jalaun', 'lalitpur', 'banda', 'hamirpur', 'mahoba', 'chitrakoot'];
  const isDroughtDistrict = bundelkhand.includes(lead.district_slug);
  const isComponentA = component === 'A';

  for (const v of candidates) {
    let score = 0;
    const diag = [];

    if (v.tier === 'premium') {
      score += isComponentA ? 50 : 30;
      diag.push(`premium:+${isComponentA ? 50 : 30}`);
    } else if (v.tier === 'standard') {
      score += 20;
      diag.push('standard:+20');
    } else if (v.tier === 'probation') {
      score += 10;
      diag.push('probation:+10');
    } else if (v.tier === 'unverified_listing') {
      score += 2;
      diag.push('unverified:+2');
    }

    if (lead.kusum_lead_tier === 'HOT' && v.tier === 'premium') {
      score += 20;
      diag.push('hot_premium:+20');
    } else if (lead.kusum_lead_tier === 'HOT') {
      score += 8;
      diag.push('hot:+8');
    }

    if (isDroughtDistrict) {
      const bundelkhandCoverage = (v.coverage_districts || []).filter(d => bundelkhand.includes(d)).length;
      if (bundelkhandCoverage >= 3) {
        score += 10;
        diag.push('bundelkhand_specialist:+10');
      }
    }

    if (v.avg_response_time_minutes != null) {
      if (v.avg_response_time_minutes < 120) { score += 8; diag.push('fast_resp:+8'); }
      else if (v.avg_response_time_minutes < 360) { score += 4; diag.push('mid_resp:+4'); }
      else if (v.avg_response_time_minutes > 1440) { score -= 8; diag.push('slow_resp:-8'); }
    }

    if (v.leads_received >= 5) {
      const closeRate = v.leads_received > 0 ? (v.leads_closed / v.leads_received) : 0;
      if (closeRate >= 0.3) { score += 12; diag.push(`close_rate_high:+12`); }
      else if (closeRate >= 0.15) { score += 6; diag.push(`close_rate_mid:+6`); }
      else if (closeRate < 0.05 && v.leads_received >= 10) { score -= 8; diag.push(`close_rate_low:-8`); }
    }

    // KUSUM-specific capacity (10 leads/month default, lenient vs rooftop)
    const since = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
    const activeUrl = `${supabaseUrl}/rest/v1/kusum_lead_assignments?` +
      `vendor_id=eq.${v.id}&created_at=gte.${since}` +
      `&outcome=in.(pending,contacted,site_survey_done,application_submitted)` +
      `&select=id`;
    const activeRes = await fetch(activeUrl, { headers: { ...headers, 'Prefer': 'count=exact' } });
    const activeCount = parseInt(activeRes.headers.get('content-range')?.split('/')[1] || '0', 10);

    const monthlyCapacity = v.lead_capacity_per_week ? v.lead_capacity_per_week * 4 : 10;
    if (activeCount >= monthlyCapacity) { score -= 30; diag.push('overloaded:-30'); }
    else if (activeCount >= monthlyCapacity * 0.75) { score -= 10; diag.push('near_capacity:-10'); }

    v._score = score;
    v._diagnostic = diag;
    v._activeKusumLeads = activeCount;
  }

  candidates.sort((a, b) => b._score - a._score);
  const winner = candidates[0];

  // ===== 5. Create assignment + notify vendor =====
  const now = new Date();
  const expiresAt = new Date(now.getTime() + 48 * 60 * 60 * 1000);

  const benchmarkCost = lead.estimated_gross_cost || 305000;
  // v0.9.0 FIX: KUSUM commission ALWAYS 5%, ignore rooftop commission_rate
  const commissionRate = KUSUM_COMMISSION_PCT;
  const commissionAmount = Math.round(benchmarkCost * commissionRate / 100);

  const assignmentBody = {
    kusum_lead_id: kusumLeadId,
    vendor_id: winner.id,
    assigned_at: now.toISOString(),
    expires_at: expiresAt.toISOString(),
    component: component,
    estimated_system_kw: lead.estimated_system_kw || null,
    estimated_commission: commissionAmount,
    commission_rate: commissionRate,
    commission_amount: commissionAmount,
    commission_status: 'pending',
    outcome: 'pending'
  };

  const assignmentRes = await fetch(`${supabaseUrl}/rest/v1/kusum_lead_assignments`, {
    method: 'POST',
    headers: { ...headers, 'Content-Type': 'application/json', 'Prefer': 'return=representation' },
    body: JSON.stringify(assignmentBody)
  });

  if (!assignmentRes.ok) {
    const err = await assignmentRes.text();
    console.error('KUSUM assignment insert failed:', err);
    return { matched: false, reason: 'assignment_insert_failed', detail: err };
  }

  const assignment = (await assignmentRes.json())[0];

  await fetch(`${supabaseUrl}/rest/v1/kusum_leads?id=eq.${kusumLeadId}`, {
    method: 'PATCH',
    headers: { ...headers, 'Content-Type': 'application/json' },
    body: JSON.stringify({ status: 'assigned' })
  });

  await notifyKusumVendor({
    provider: process.env.WHATSAPP_PROVIDER || 'webhook',
    apiKey: process.env.WHATSAPP_API_KEY,
    vendor: winner,
    lead,
    assignment,
    component,
    commissionAmount,
    commissionRate,  // v0.9.0: pass rate explicitly to WhatsApp template
    portalBaseUrl: process.env.PORTAL_BASE_URL || 'https://solarsubsidies.com'
  });

  return {
    matched: true,
    assignmentId: assignment.id,
    vendorId: winner.id,
    vendorName: winner.company_name,
    vendorPhone: winner.phone,
    component,
    score: winner._score,
    diagnostic: winner._diagnostic,
    commissionAmount,
    commissionRate,
    expiresAt: expiresAt.toISOString(),
    candidatesConsidered: candidates.length,
    assignmentMethod: excludeVendorIds.length > 0 ? 'reassignment' : 'auto_match'
  };
}

// ============================================================
// VENDOR WHATSAPP NOTIFICATION
// ============================================================
async function notifyKusumVendor({ provider, apiKey, vendor, lead, assignment, component, commissionAmount, commissionRate, portalBaseUrl }) {
  if (!apiKey) return;
  const vendorPhone = vendor.phone;
  if (!vendorPhone) {
    console.warn('[match-kusum] Vendor has no phone:', vendor.id);
    return;
  }

  const tierEmoji = lead.kusum_lead_tier === 'HOT' ? '🔥' : lead.kusum_lead_tier === 'WARM' ? '🟡' : '⚪';

  const componentLabel = {
    'A': `🏛️ Component A · Solar Plant${lead.estimated_system_kw ? ` (~${Math.round(lead.estimated_system_kw/1000)} MW)` : ''}`,
    'B': `💧 Component B · ${lead.pump_hp || '?'} HP Standalone Pump`,
    'C1': '⚡ Component C1 · Grid-Pump Solarisation',
    'C2': '⚡ Component C2 · Feeder-Level Solarisation'
  }[component] || component;

  const districtName = lead.district_slug
    ? lead.district_slug.charAt(0).toUpperCase() + lead.district_slug.slice(1).replace(/-/g, ' ')
    : '—';

  const subsidy = (lead.estimated_subsidy_central || 0) + (lead.estimated_subsidy_state || 0);

  const message = `${tierEmoji} NEW KUSUM LEAD ASSIGNED (${lead.kusum_lead_tier})

🌾 ${lead.name}
📞 ${lead.phone}
📍 ${districtName}${lead.village_or_tehsil ? ', ' + lead.village_or_tehsil : ''}

✨ ${componentLabel}

🌾 Land: ${lead.land_owned_acres || '—'} acres
💧 Water: ${lead.water_source || '—'}${lead.water_depth_ft ? ` · ${lead.water_depth_ft}ft depth` : ''}
🌺 Crops: ${lead.primary_crops || '—'}
⚡ Current pump: ${lead.pump_situation || '—'}

💰 System cost: ₹${(lead.estimated_gross_cost || 0).toLocaleString('en-IN')}
   Subsidy: ₹${subsidy.toLocaleString('en-IN')}
   Farmer share: ₹${(lead.estimated_farmer_contribution || 0).toLocaleString('en-IN')}

💵 Your commission on close: ₹${commissionAmount.toLocaleString('en-IN')} (${commissionRate}% KUSUM rate)

⏰ Respond within 48h or this lead reassigns.

👉 Claim/decline: ${portalBaseUrl}/vendors/portal.html?kusum=${assignment.id}

⚠️ KUSUM requires MNRE pump empanellment + UPNEDA application (different from rooftop).
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
            templateParams: [message]
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
              template: { name: 'kusum_lead_assigned', body_text: [message] }
            }
          })
        });
      default:
        if (apiKey.startsWith('http')) {
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
