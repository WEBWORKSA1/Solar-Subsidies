/**
 * /api/match-lead.js — Lead-vendor matching engine
 * 
 * Called internally after lead capture. Picks best vendor for a lead based on:
 *   1. (v0.9 NEW) Honor customer's preferred vendor if they chose one on profile page
 *   2. Active vendors covering lead's district
 *   3. Min system size compatibility
 *   4. Property type compatibility
 *   5. Tier priority (premium > standard > probation)
 *   6. Current capacity utilization (least-loaded first)
 *   7. Avg response time (faster first)
 * 
 * Creates lead_assignments row with 24hr expiry. Notifies vendor via WhatsApp.
 * 
 * Can also be called directly to reassign:
 *   POST /api/match-lead { leadId, excludeVendorIds: [...] }
 * 
 * ENV VARS:
 *   SUPABASE_URL
 *   SUPABASE_SERVICE_ROLE_KEY
 *   WHATSAPP_API_KEY
 *   WHATSAPP_PROVIDER
 *   MATCH_INTERNAL_TOKEN     Required for internal calls (also used by cron reassignment)
 *   PORTAL_BASE_URL          e.g. 'https://solarsubsidies.com'
 */

export default async function handler(req, res) {
  // Internal calls only — protect with token
  const token = req.headers['x-internal-token'] || req.query.token;
  if (token !== process.env.MATCH_INTERNAL_TOKEN) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const { leadId, excludeVendorIds = [] } = req.body;
    if (!leadId) return res.status(400).json({ error: 'leadId required' });

    const result = await matchLead(leadId, excludeVendorIds);
    return res.status(200).json(result);
  } catch (err) {
    console.error('Match error:', err);
    return res.status(500).json({ error: 'Internal error', detail: err.message });
  }
}

/**
 * Core matching function. Exportable for direct internal calls from /api/lead.js.
 */
export async function matchLead(leadId, excludeVendorIds = []) {
  const supabaseUrl = process.env.SUPABASE_URL;
  const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  // 1. Fetch the lead
  const leadRes = await fetch(`${supabaseUrl}/rest/v1/leads?id=eq.${leadId}&select=*`, {
    headers: { 'apikey': supabaseKey, 'Authorization': `Bearer ${supabaseKey}` }
  });
  const leads = await leadRes.json();
  const lead = leads?.[0];
  if (!lead) return { matched: false, reason: 'Lead not found' };

  // Don't auto-match cold leads (manual triage only)
  if (lead.lead_tier === 'COLD') {
    return { matched: false, reason: 'COLD leads not auto-matched — manual broker' };
  }

  // ============================================================
  // v0.9: PREFERRED VENDOR PATH
  // ============================================================
  // If the customer arrived from /vendors/{slug}.html, lead.preferred_vendor_slug is set.
  // Try that vendor first. If they pass minimum eligibility (active + covers district +
  // system size compatible), assign to them regardless of tier/capacity/performance.
  // Capacity-overloaded preferred vendor still gets the lead — customer's choice wins.
  //
  // Fall back to normal scoring ONLY if preferred vendor is:
  //   - Not in the database
  //   - Inactive or suspended
  //   - Doesn't cover this district
  //   - Doesn't handle this system size
  //   - In the excludeVendorIds list (e.g. already declined this lead)
  
  if (lead.preferred_vendor_slug && excludeVendorIds.length === 0) {
    const preferredUrl = `${supabaseUrl}/rest/v1/vendors?slug=eq.${encodeURIComponent(lead.preferred_vendor_slug)}&select=*&limit=1`;
    const preferredRes = await fetch(preferredUrl, {
      headers: { 'apikey': supabaseKey, 'Authorization': `Bearer ${supabaseKey}` }
    });
    const preferred = (await preferredRes.json())?.[0];
    
    if (preferred && 
        preferred.active === true && 
        preferred.tier !== 'suspended' &&
        (preferred.coverage_districts || []).includes(lead.district_slug) &&
        (preferred.min_system_size_kw || 0) <= (lead.system_size_kw || 3) &&
        (!preferred.property_types?.length || preferred.property_types.includes(lead.property_type)) &&
        !excludeVendorIds.includes(preferred.id)) {
      
      // Preferred vendor passes minimum eligibility → honor customer's choice
      console.log(`[match-lead] Honoring preferred vendor: ${preferred.company_name} for lead ${leadId}`);
      
      const result = await assignToVendor(lead, preferred, leadId, 'preferred', 0);
      return result;
    } else if (preferred) {
      console.log(`[match-lead] Preferred vendor ${lead.preferred_vendor_slug} failed eligibility — falling back to scoring`);
    } else {
      console.log(`[match-lead] Preferred vendor slug ${lead.preferred_vendor_slug} not found — falling back to scoring`);
    }
  }
  
  // ============================================================
  // STANDARD MATCHING PATH (no preference OR preferred vendor unavailable)
  // ============================================================
  
  // 2. Find eligible vendors
  let candidateUrl = `${supabaseUrl}/rest/v1/vendors?select=*` +
    `&active=eq.true` +
    `&tier=neq.suspended` +
    `&min_system_size_kw=lte.${lead.system_size_kw || 3}` +
    `&coverage_districts=cs.{${lead.district_slug}}`;
  
  // Exclude already-assigned vendors (for reassignment cycles)
  if (excludeVendorIds.length > 0) {
    candidateUrl += `&id=not.in.(${excludeVendorIds.join(',')})`;
  }
  
  const vendorRes = await fetch(candidateUrl, {
    headers: { 'apikey': supabaseKey, 'Authorization': `Bearer ${supabaseKey}` }
  });
  const candidates = await vendorRes.json();
  
  // 3. Filter by property type compatibility
  const eligible = candidates.filter(v => {
    if (!v.property_types || v.property_types.length === 0) return true;
    return v.property_types.includes(lead.property_type);
  });
  
  if (eligible.length === 0) {
    await fetch(`${supabaseUrl}/rest/v1/leads?id=eq.${leadId}`, {
      method: 'PATCH',
      headers: {
        'apikey': supabaseKey,
        'Authorization': `Bearer ${supabaseKey}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ status: 'unmatched_no_vendor' })
    });
    return { matched: false, reason: 'No eligible vendor for this district + property + size' };
  }
  
  // 4. Score each candidate
  for (const v of eligible) {
    let score = 0;
    
    if (v.tier === 'premium') score += 30;
    else if (v.tier === 'standard') score += 20;
    else if (v.tier === 'probation') score += 10;
    
    if (lead.lead_tier === 'HOT' && v.tier === 'premium') score += 20;
    
    const since = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
    const activeUrl = `${supabaseUrl}/rest/v1/lead_assignments?` +
      `vendor_id=eq.${v.id}&created_at=gte.${since}` +
      `&outcome=in.(pending,contacted,site_visit_scheduled,quote_sent)` +
      `&select=id`;
    const activeRes = await fetch(activeUrl, {
      headers: { 'apikey': supabaseKey, 'Authorization': `Bearer ${supabaseKey}`, 'Prefer': 'count=exact' }
    });
    const activeCount = parseInt(activeRes.headers.get('content-range')?.split('/')[1] || '0', 10);
    
    const capacity = v.lead_capacity_per_week || 5;
    const utilizationPct = (activeCount / capacity) * 100;
    
    if (utilizationPct >= 100) score -= 50;
    else if (utilizationPct >= 75) score -= 20;
    else if (utilizationPct >= 50) score -= 5;
    
    if (v.avg_response_time_minutes !== null) {
      if (v.avg_response_time_minutes < 60) score += 10;
      else if (v.avg_response_time_minutes < 120) score += 5;
      else if (v.avg_response_time_minutes > 480) score -= 10;
    }
    
    if (v.leads_closed >= 5) {
      const closeRate = v.leads_received > 0 ? (v.leads_closed / v.leads_received) : 0;
      if (closeRate >= 0.3) score += 15;
      else if (closeRate >= 0.2) score += 8;
      else if (closeRate < 0.05 && v.leads_received >= 10) score -= 10;
    }
    
    v._matchScore = score;
    v._utilizationPct = utilizationPct;
  }
  
  eligible.sort((a, b) => b._matchScore - a._matchScore);
  const winner = eligible[0];
  
  return await assignToVendor(lead, winner, leadId, 
    excludeVendorIds.length > 0 ? 'reassign' : 'auto', 
    excludeVendorIds.length,
    { matchScore: winner._matchScore, utilizationPct: winner._utilizationPct, candidatesConsidered: eligible.length }
  );
}

// ============================================================
// HELPER: Create assignment row + notify vendor
// Extracted so both "preferred" and "auto" paths share the same logic
// ============================================================
async function assignToVendor(lead, vendor, leadId, assignmentMethod, reassignCount, extra = {}) {
  const supabaseUrl = process.env.SUPABASE_URL;
  const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  
  const grossValue = (lead.system_size_kw || 3) * 70000;
  const commissionAmount = grossValue * (vendor.commission_rate / 100);
  const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
  
  const assignRes = await fetch(`${supabaseUrl}/rest/v1/lead_assignments`, {
    method: 'POST',
    headers: {
      'apikey': supabaseKey,
      'Authorization': `Bearer ${supabaseKey}`,
      'Content-Type': 'application/json',
      'Prefer': 'return=representation'
    },
    body: JSON.stringify({
      lead_id: leadId,
      vendor_id: vendor.id,
      assignment_method: assignmentMethod,
      district_slug: lead.district_slug,
      lead_tier: lead.lead_tier,
      lead_score: lead.lead_score,
      system_size_kw: lead.system_size_kw,
      gross_system_value: grossValue,
      commission_rate: vendor.commission_rate,
      commission_amount: Math.round(commissionAmount * 100) / 100,
      commission_status: 'pending',
      expires_at: expiresAt,
      reassign_count: reassignCount
    })
  });
  
  let assignmentId = null;
  if (assignRes.ok) {
    const data = await assignRes.json();
    assignmentId = data[0]?.id;
  } else {
    const err = await assignRes.text();
    console.error('Assignment write failed:', err);
    return { matched: false, reason: 'DB write failed', detail: err };
  }
  
  await fetch(`${supabaseUrl}/rest/v1/leads?id=eq.${leadId}`, {
    method: 'PATCH',
    headers: {
      'apikey': supabaseKey,
      'Authorization': `Bearer ${supabaseKey}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({ status: 'assigned' })
  });
  
  await notifyVendor({
    vendor,
    lead,
    assignmentId,
    commissionAmount,
    expiresAt,
    isPreferred: assignmentMethod === 'preferred'
  });
  
  return {
    matched: true,
    vendorId: vendor.id,
    vendorName: vendor.company_name,
    assignmentId,
    assignmentMethod,
    commissionAmount: Math.round(commissionAmount),
    ...extra
  };
}

// ============================================================
// VENDOR NOTIFICATION (with preferred-vendor flag)
// ============================================================
async function notifyVendor({ vendor, lead, assignmentId, commissionAmount, expiresAt, isPreferred = false }) {
  const provider = process.env.WHATSAPP_PROVIDER || 'webhook';
  const apiKey = process.env.WHATSAPP_API_KEY;
  if (!apiKey) return;
  
  const tierEmoji = lead.lead_tier === 'HOT' ? '🔥' : lead.lead_tier === 'WARM' ? '🟡' : '⚪';
  const portalUrl = process.env.PORTAL_BASE_URL || 'https://solarsubsidies.com';
  
  const intentMap = {
    'reduce_bill': 'Cut electricity bill',
    'independence': 'Energy independence',
    'property_value': 'Property value',
    'environment': 'Environment',
    'subsidy': 'Subsidy ₹1.08L',
    'researching': 'Researching'
  };
  const timelineMap = {
    'this_month': 'THIS MONTH ⚡',
    '1_3_months': '1-3 months',
    '3_6_months': '3-6 months',
    'just_researching': 'No firm timeline'
  };
  const propertyMap = {
    'independent_home': 'Independent home',
    'builder_floor': 'Builder floor',
    'apartment': 'Apartment / RWA',
    'farm': 'Farm',
    'commercial': 'Commercial',
    'other': 'Other'
  };
  
  const districtName = lead.district_slug 
    ? lead.district_slug.charAt(0).toUpperCase() + lead.district_slug.slice(1).replace(/-/g, ' ')
    : '—';
  
  const expiryHours = Math.round((new Date(expiresAt) - new Date()) / (1000 * 60 * 60));
  
  // v0.9: Highlight when this is a preferred-vendor match (customer picked YOU specifically)
  const preferredFlag = isPreferred 
    ? '\n⭐ CUSTOMER REQUESTED YOU SPECIFICALLY (from your vendor profile page)\n'
    : '';
  
  const message = `${tierEmoji} NEW LEAD ASSIGNED — ${lead.lead_tier}${preferredFlag}
Score: ${lead.lead_score}/10
👤 ${lead.name}
📞 ${lead.phone}
📍 ${districtName}
🏠 ${propertyMap[lead.property_type] || lead.property_type}
⚡ ${lead.system_size_kw} kW
💰 Bill: ₹${lead.monthly_bill?.toLocaleString('en-IN') || '—'}/mo

🎯 ${intentMap[lead.intent] || lead.intent || '—'}
⏱️ ${timelineMap[lead.timeline] || lead.timeline || '—'}

Est. commission on close: ₹${commissionAmount.toLocaleString('en-IN', {maximumFractionDigits: 0})}

⏰ Respond within ${expiryHours}h or this lead reassigns to another vendor.

👉 Claim/decline: ${portalUrl}/vendors/portal.html?lead=${assignmentId}`;

  try {
    switch (provider) {
      case 'aisensy':
        await fetch('https://backend.aisensy.com/campaign/t1/api/v2', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            apiKey,
            campaignName: 'vendor_lead_assigned',
            destination: vendor.phone,
            userName: 'SolarSubsidies',
            templateParams: [message]
          })
        });
        break;
      case 'interakt':
        await fetch('https://api.interakt.ai/v1/public/message/', {
          method: 'POST',
          headers: { 'Authorization': `Basic ${apiKey}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({
            countryCode: '+91',
            phoneNumber: vendor.phone.replace('+91', ''),
            type: 'Text',
            data: { message }
          })
        });
        break;
      case 'msg91':
        await fetch('https://api.msg91.com/api/v5/whatsapp/whatsapp-outbound-message/bulk/', {
          method: 'POST',
          headers: { 'authkey': apiKey, 'Content-Type': 'application/json' },
          body: JSON.stringify({
            integrated_number: process.env.MSG91_INTEGRATED_NUMBER,
            content_type: 'template',
            payload: {
              to: [vendor.phone],
              type: 'template',
              template: { name: 'lead_assigned', body_text: [message] }
            }
          })
        });
        break;
      default:
        if (apiKey.startsWith('http')) {
          await fetch(apiKey, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ to: vendor.phone, message })
          });
        }
    }
  } catch (e) {
    console.error('Vendor notify error:', e);
  }
}
