/**
 * /api/vendor-leads.js — Vendor-side lead actions (rooftop + KUSUM)
 *
 * v0.8.4 — Added KUSUM support: list-kusum, claim-kusum, decline-kusum,
 * outcome-kusum, stats-kusum. All actions are session-token gated.
 *
 * Endpoints (single file, action via query param):
 *
 *   ROOFTOP ACTIONS:
 *   POST /api/vendor-leads?action=list      { sessionToken, filter? }
 *     → vendor_inbox view (rooftop only)
 *
 *   POST /api/vendor-leads?action=claim     { sessionToken, assignmentId }
 *     → Mark rooftop assignment as 'contacted', record response time
 *
 *   POST /api/vendor-leads?action=decline   { sessionToken, assignmentId, reason }
 *     → Mark declined, trigger matchLead reassignment
 *
 *   POST /api/vendor-leads?action=outcome   { sessionToken, assignmentId, outcome, notes? }
 *     → Update rooftop outcome
 *
 *   POST /api/vendor-leads?action=stats     { sessionToken }
 *     → vendor_performance view
 *
 *   KUSUM ACTIONS (v0.8.4 NEW):
 *   POST /api/vendor-leads?action=list-kusum    { sessionToken, filter? }
 *     → kusum_lead_assignments joined to kusum_leads
 *       filter: 'open' | 'closed' | 'all' | 'urgent'
 *
 *   POST /api/vendor-leads?action=claim-kusum   { sessionToken, assignmentId }
 *     → Mark KUSUM assignment as 'contacted'
 *
 *   POST /api/vendor-leads?action=decline-kusum { sessionToken, assignmentId, reason }
 *     → Mark declined, trigger matchKusumLead reassignment
 *
 *   POST /api/vendor-leads?action=outcome-kusum { sessionToken, assignmentId, outcome, notes? }
 *     → Update KUSUM outcome through 6-stage lifecycle:
 *       pending → contacted → site_survey_done → application_submitted
 *               → sanctioned → installation_complete → commissioned
 *
 *   POST /api/vendor-leads?action=stats-kusum   { sessionToken }
 *     → KUSUM-specific stats for the vendor
 */

import { validateSession } from './vendor-auth.js';
import { matchLead } from './match-lead.js';
import { matchKusumLead } from './match-kusum-lead.js';

const ALLOWED_ORIGINS = [
  'https://solarsubsidies.com',
  'https://www.solarsubsidies.com',
  'https://solar-subsidies.vercel.app',
  'http://localhost:3000'
];

const VALID_ROOFTOP_OUTCOMES = [
  'contacted', 'site_visit_scheduled', 'quote_sent',
  'contract_signed', 'installation_complete', 'net_meter_activated',
  'declined_by_customer', 'lost_to_competitor', 'no_response'
];

// KUSUM outcomes (per data/0008_kusum_and_directory.sql constraint)
const VALID_KUSUM_OUTCOMES = [
  'contacted', 'site_survey_done', 'application_submitted',
  'sanctioned', 'installation_complete', 'commissioned',
  'declined_by_farmer', 'rejected_by_upneda', 'no_response'
];

export default async function handler(req, res) {
  const origin = req.headers.origin;
  if (ALLOWED_ORIGINS.includes(origin)) {
    res.setHeader('Access-Control-Allow-Origin', origin);
  }
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const action = req.query.action;
  const { sessionToken } = req.body;

  const vendor = await validateSession(sessionToken);
  if (!vendor) return res.status(401).json({ error: 'Invalid or expired session' });

  try {
    // Rooftop actions
    if (action === 'list')    return await handleList(req, res, vendor);
    if (action === 'claim')   return await handleClaim(req, res, vendor);
    if (action === 'decline') return await handleDecline(req, res, vendor);
    if (action === 'outcome') return await handleOutcome(req, res, vendor);
    if (action === 'stats')   return await handleStats(req, res, vendor);

    // KUSUM actions (v0.8.4)
    if (action === 'list-kusum')    return await handleListKusum(req, res, vendor);
    if (action === 'claim-kusum')   return await handleClaimKusum(req, res, vendor);
    if (action === 'decline-kusum') return await handleDeclineKusum(req, res, vendor);
    if (action === 'outcome-kusum') return await handleOutcomeKusum(req, res, vendor);
    if (action === 'stats-kusum')   return await handleStatsKusum(req, res, vendor);

    return res.status(400).json({ error: 'Unknown action' });
  } catch (err) {
    console.error('Vendor leads error:', err);
    return res.status(500).json({ error: 'Internal error', detail: err.message });
  }
}

// ============================================================
// ROOFTOP ACTION: list
// ============================================================
async function handleList(req, res, vendor) {
  const { filter = 'open' } = req.body;
  const supabaseUrl = process.env.SUPABASE_URL;
  const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  let url = `${supabaseUrl}/rest/v1/vendor_inbox?vendor_id=eq.${vendor.id}&select=*&order=assigned_at.desc&limit=200`;
  if (filter === 'open') {
    url += '&outcome=eq.pending';
  } else if (filter === 'closed') {
    url += '&outcome=in.(net_meter_activated,installation_complete)';
  }

  const inboxRes = await fetch(url, {
    headers: { 'apikey': supabaseKey, 'Authorization': `Bearer ${supabaseKey}` }
  });
  const leads = await inboxRes.json();

  return res.status(200).json({ success: true, leads, count: leads.length });
}

// ============================================================
// ROOFTOP ACTION: claim
// ============================================================
async function handleClaim(req, res, vendor) {
  const { assignmentId } = req.body;
  if (!assignmentId) return res.status(400).json({ error: 'assignmentId required' });

  const supabaseUrl = process.env.SUPABASE_URL;
  const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  const checkUrl = `${supabaseUrl}/rest/v1/lead_assignments?id=eq.${assignmentId}&vendor_id=eq.${vendor.id}&select=*&limit=1`;
  const checkRes = await fetch(checkUrl, {
    headers: { 'apikey': supabaseKey, 'Authorization': `Bearer ${supabaseKey}` }
  });
  const assignments = await checkRes.json();
  if (!assignments || assignments.length === 0) {
    return res.status(404).json({ error: 'Assignment not found or not yours' });
  }

  const assignment = assignments[0];
  if (assignment.outcome !== 'pending') {
    return res.status(400).json({ error: `Cannot claim — already ${assignment.outcome}` });
  }

  const assignedAt = new Date(assignment.assigned_at || assignment.created_at);
  const responseMinutes = Math.round((Date.now() - assignedAt) / (1000 * 60));

  const updateRes = await fetch(`${supabaseUrl}/rest/v1/lead_assignments?id=eq.${assignmentId}`, {
    method: 'PATCH',
    headers: {
      'apikey': supabaseKey,
      'Authorization': `Bearer ${supabaseKey}`,
      'Content-Type': 'application/json',
      'Prefer': 'return=representation'
    },
    body: JSON.stringify({
      outcome: 'contacted',
      outcome_updated_at: new Date().toISOString(),
      vendor_responded_at: new Date().toISOString(),
      response_time_minutes: responseMinutes,
      vendor_response_method: 'portal'
    })
  });

  if (!updateRes.ok) return res.status(500).json({ error: 'DB update failed' });

  return res.status(200).json({
    success: true,
    message: 'Lead claimed',
    responseTimeMinutes: responseMinutes,
    onTimeForSLA: responseMinutes <= 240
  });
}

// ============================================================
// ROOFTOP ACTION: decline
// ============================================================
async function handleDecline(req, res, vendor) {
  const { assignmentId, reason } = req.body;
  if (!assignmentId) return res.status(400).json({ error: 'assignmentId required' });

  const supabaseUrl = process.env.SUPABASE_URL;
  const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  const checkUrl = `${supabaseUrl}/rest/v1/lead_assignments?id=eq.${assignmentId}&vendor_id=eq.${vendor.id}&select=*&limit=1`;
  const checkRes = await fetch(checkUrl, {
    headers: { 'apikey': supabaseKey, 'Authorization': `Bearer ${supabaseKey}` }
  });
  const assignments = await checkRes.json();
  if (!assignments || assignments.length === 0) {
    return res.status(404).json({ error: 'Assignment not found or not yours' });
  }

  const assignment = assignments[0];
  if (assignment.outcome !== 'pending') {
    return res.status(400).json({ error: `Cannot decline — already ${assignment.outcome}` });
  }

  await fetch(`${supabaseUrl}/rest/v1/lead_assignments?id=eq.${assignmentId}`, {
    method: 'PATCH',
    headers: {
      'apikey': supabaseKey,
      'Authorization': `Bearer ${supabaseKey}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      outcome: 'declined_by_vendor',
      outcome_updated_at: new Date().toISOString(),
      declined_reason: reason || null,
      commission_status: 'waived'
    })
  });

  const priorUrl = `${supabaseUrl}/rest/v1/lead_assignments?lead_id=eq.${assignment.lead_id}&select=vendor_id`;
  const priorRes = await fetch(priorUrl, {
    headers: { 'apikey': supabaseKey, 'Authorization': `Bearer ${supabaseKey}` }
  });
  const priors = await priorRes.json();
  const excludeIds = priors.map(p => p.vendor_id);

  let reassignResult = null;
  try {
    reassignResult = await matchLead(assignment.lead_id, excludeIds);
  } catch (e) {
    console.error('Reassignment failed:', e);
  }

  return res.status(200).json({
    success: true,
    message: 'Lead declined',
    reassigned: reassignResult?.matched || false,
    newVendorName: reassignResult?.vendorName || null
  });
}

// ============================================================
// ROOFTOP ACTION: outcome
// ============================================================
async function handleOutcome(req, res, vendor) {
  const { assignmentId, outcome, notes } = req.body;

  if (!assignmentId || !outcome) return res.status(400).json({ error: 'assignmentId and outcome required' });
  if (!VALID_ROOFTOP_OUTCOMES.includes(outcome)) {
    return res.status(400).json({ error: `outcome must be one of: ${VALID_ROOFTOP_OUTCOMES.join(', ')}` });
  }

  const supabaseUrl = process.env.SUPABASE_URL;
  const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  const checkUrl = `${supabaseUrl}/rest/v1/lead_assignments?id=eq.${assignmentId}&vendor_id=eq.${vendor.id}&select=*&limit=1`;
  const checkRes = await fetch(checkUrl, {
    headers: { 'apikey': supabaseKey, 'Authorization': `Bearer ${supabaseKey}` }
  });
  const assignments = await checkRes.json();
  if (!assignments || assignments.length === 0) {
    return res.status(404).json({ error: 'Assignment not found or not yours' });
  }

  const update = {
    outcome,
    outcome_updated_at: new Date().toISOString()
  };
  if (notes) update.vendor_notes = notes;

  if (outcome === 'net_meter_activated') {
    update.commission_status = 'owed';
    update.net_meter_activated_at = new Date().toISOString();
  } else if (outcome === 'declined_by_customer' || outcome === 'lost_to_competitor' || outcome === 'no_response') {
    update.commission_status = 'waived';
  }

  await fetch(`${supabaseUrl}/rest/v1/lead_assignments?id=eq.${assignmentId}`, {
    method: 'PATCH',
    headers: {
      'apikey': supabaseKey,
      'Authorization': `Bearer ${supabaseKey}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(update)
  });

  return res.status(200).json({
    success: true,
    message: `Outcome updated to ${outcome}`,
    commissionOwed: outcome === 'net_meter_activated'
  });
}

// ============================================================
// ROOFTOP ACTION: stats
// ============================================================
async function handleStats(req, res, vendor) {
  const supabaseUrl = process.env.SUPABASE_URL;
  const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  const statsRes = await fetch(
    `${supabaseUrl}/rest/v1/vendor_performance?vendor_id=eq.${vendor.id}&select=*&limit=1`,
    { headers: { 'apikey': supabaseKey, 'Authorization': `Bearer ${supabaseKey}` } }
  );
  const stats = await statsRes.json();

  return res.status(200).json({
    success: true,
    stats: stats?.[0] || null,
    vendor: {
      id: vendor.id,
      company_name: vendor.company_name,
      brand_name: vendor.brand_name,
      contact_name: vendor.contact_name,
      phone: vendor.phone,
      email: vendor.email,
      tier: vendor.tier,
      commission_rate: vendor.commission_rate,
      active: vendor.active,
      coverage_districts: vendor.coverage_districts,
      min_system_size_kw: vendor.min_system_size_kw,
      property_types: vendor.property_types,
      lead_capacity_per_week: vendor.lead_capacity_per_week,
      handles_kusum: vendor.handles_kusum,
      kusum_components: vendor.kusum_components
    }
  });
}

// ============================================================
// KUSUM ACTION: list-kusum (v0.8.4 NEW)
// Fetch KUSUM lead assignments for this vendor, joined to kusum_leads
// ============================================================
async function handleListKusum(req, res, vendor) {
  const { filter = 'open' } = req.body;
  const supabaseUrl = process.env.SUPABASE_URL;
  const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  // Reject early if vendor isn't a KUSUM specialist (UI shouldn't even call this)
  if (!vendor.handles_kusum) {
    return res.status(403).json({
      error: 'not_kusum_specialist',
      message: 'This vendor account is not marked as a KUSUM specialist. Contact admin to enable.'
    });
  }

  // Join kusum_lead_assignments with kusum_leads using PostgREST embedded resources
  // kusum_lead_assignments has FK kusum_lead_id → kusum_leads.id
  let url = `${supabaseUrl}/rest/v1/kusum_lead_assignments?` +
    `vendor_id=eq.${vendor.id}` +
    `&select=*,kusum_leads(*)` +
    `&order=assigned_at.desc&limit=200`;

  if (filter === 'open') {
    url += '&outcome=in.(pending,contacted,site_survey_done,application_submitted,sanctioned)';
  } else if (filter === 'closed') {
    url += '&outcome=in.(installation_complete,commissioned)';
  } else if (filter === 'dead') {
    url += '&outcome=in.(declined_by_vendor,declined_by_farmer,rejected_by_upneda,no_response)';
  } else if (filter === 'urgent') {
    url += `&outcome=eq.pending&expires_at=lt.${new Date(Date.now() + 6 * 60 * 60 * 1000).toISOString()}`;
  }

  const inboxRes = await fetch(url, {
    headers: { 'apikey': supabaseKey, 'Authorization': `Bearer ${supabaseKey}` }
  });

  if (!inboxRes.ok) {
    const err = await inboxRes.text();
    console.error('KUSUM list fetch failed:', err);
    return res.status(500).json({ error: 'fetch_failed', detail: err });
  }

  const rawAssignments = await inboxRes.json();

  // Flatten the embedded kusum_leads object into the assignment for easier frontend rendering
  const leads = rawAssignments.map(a => {
    const lead = a.kusum_leads || {};
    return {
      // Assignment fields
      assignment_id: a.id,
      assigned_at: a.assigned_at || a.created_at,
      expires_at: a.expires_at,
      component: a.component,
      estimated_system_kw: a.estimated_system_kw,
      commission_amount: a.commission_amount,
      commission_rate: a.commission_rate,
      commission_status: a.commission_status,
      commission_paid_at: a.commission_paid_at,
      outcome: a.outcome,
      outcome_updated_at: a.outcome_updated_at,
      vendor_notes: a.notes,

      // Lead fields (from kusum_leads JOIN)
      kusum_lead_id: lead.id,
      farmer_name: lead.name,
      farmer_phone: lead.phone,
      farmer_email: lead.email,
      district_slug: lead.district_slug,
      village_or_tehsil: lead.village_or_tehsil,
      land_owned_acres: lead.land_owned_acres,
      irrigation_acres: lead.irrigation_acres,
      land_ownership_proof: lead.land_ownership_proof,
      pump_situation: lead.pump_situation,
      pump_hp: lead.pump_hp,
      water_source: lead.water_source,
      water_depth_ft: lead.water_depth_ft,
      primary_crops: lead.primary_crops,
      current_electricity_bill_monthly: lead.current_electricity_bill_monthly,
      current_diesel_spend_monthly: lead.current_diesel_spend_monthly,
      kusum_lead_tier: lead.kusum_lead_tier,
      kusum_lead_score: lead.kusum_lead_score,
      recommended_component: lead.recommended_component,
      estimated_gross_cost: lead.estimated_gross_cost,
      estimated_subsidy_central: lead.estimated_subsidy_central,
      estimated_subsidy_state: lead.estimated_subsidy_state,
      estimated_farmer_contribution: lead.estimated_farmer_contribution,
      estimated_loan_eligible: lead.estimated_loan_eligible,
      estimated_payback_years: lead.estimated_payback_years,
      consent_whatsapp: lead.consent_whatsapp,
      lead_created_at: lead.created_at,

      // Computed SLA status
      sla_status: computeKusumSlaStatus(a)
    };
  });

  return res.status(200).json({ success: true, leads, count: leads.length });
}

function computeKusumSlaStatus(assignment) {
  if (!assignment.outcome || assignment.outcome === 'pending') {
    const expiresAt = new Date(assignment.expires_at);
    const now = Date.now();
    if (expiresAt < now) return 'expired';
    const hoursLeft = (expiresAt - now) / (1000 * 60 * 60);
    if (hoursLeft < 6) return 'urgent';
    return 'open';
  }
  if (['declined_by_vendor', 'declined_by_farmer', 'rejected_by_upneda', 'no_response'].includes(assignment.outcome)) {
    return 'dead';
  }
  if (['commissioned', 'installation_complete'].includes(assignment.outcome)) {
    return 'closed';
  }
  return 'in_progress';
}

// ============================================================
// KUSUM ACTION: claim-kusum
// ============================================================
async function handleClaimKusum(req, res, vendor) {
  const { assignmentId } = req.body;
  if (!assignmentId) return res.status(400).json({ error: 'assignmentId required' });

  if (!vendor.handles_kusum) {
    return res.status(403).json({ error: 'not_kusum_specialist' });
  }

  const supabaseUrl = process.env.SUPABASE_URL;
  const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  const checkUrl = `${supabaseUrl}/rest/v1/kusum_lead_assignments?id=eq.${assignmentId}&vendor_id=eq.${vendor.id}&select=*&limit=1`;
  const checkRes = await fetch(checkUrl, {
    headers: { 'apikey': supabaseKey, 'Authorization': `Bearer ${supabaseKey}` }
  });
  const assignments = await checkRes.json();
  if (!assignments || assignments.length === 0) {
    return res.status(404).json({ error: 'Assignment not found or not yours' });
  }

  const assignment = assignments[0];
  if (assignment.outcome !== 'pending') {
    return res.status(400).json({ error: `Cannot claim — already ${assignment.outcome}` });
  }

  const assignedAt = new Date(assignment.assigned_at || assignment.created_at);
  const responseMinutes = Math.round((Date.now() - assignedAt) / (1000 * 60));

  await fetch(`${supabaseUrl}/rest/v1/kusum_lead_assignments?id=eq.${assignmentId}`, {
    method: 'PATCH',
    headers: {
      'apikey': supabaseKey,
      'Authorization': `Bearer ${supabaseKey}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      outcome: 'contacted',
      outcome_updated_at: new Date().toISOString()
    })
  });

  return res.status(200).json({
    success: true,
    message: 'KUSUM lead claimed',
    responseTimeMinutes: responseMinutes,
    onTimeForSLA: responseMinutes <= 1440  // 24h instead of 4h for KUSUM
  });
}

// ============================================================
// KUSUM ACTION: decline-kusum
// ============================================================
async function handleDeclineKusum(req, res, vendor) {
  const { assignmentId, reason } = req.body;
  if (!assignmentId) return res.status(400).json({ error: 'assignmentId required' });

  if (!vendor.handles_kusum) {
    return res.status(403).json({ error: 'not_kusum_specialist' });
  }

  const supabaseUrl = process.env.SUPABASE_URL;
  const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  const checkUrl = `${supabaseUrl}/rest/v1/kusum_lead_assignments?id=eq.${assignmentId}&vendor_id=eq.${vendor.id}&select=*&limit=1`;
  const checkRes = await fetch(checkUrl, {
    headers: { 'apikey': supabaseKey, 'Authorization': `Bearer ${supabaseKey}` }
  });
  const assignments = await checkRes.json();
  if (!assignments || assignments.length === 0) {
    return res.status(404).json({ error: 'Assignment not found or not yours' });
  }

  const assignment = assignments[0];
  if (!['pending', 'contacted'].includes(assignment.outcome)) {
    return res.status(400).json({ error: `Cannot decline at this stage — outcome is ${assignment.outcome}` });
  }

  await fetch(`${supabaseUrl}/rest/v1/kusum_lead_assignments?id=eq.${assignmentId}`, {
    method: 'PATCH',
    headers: {
      'apikey': supabaseKey,
      'Authorization': `Bearer ${supabaseKey}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      outcome: 'declined_by_vendor',
      outcome_updated_at: new Date().toISOString(),
      commission_status: 'waived',
      notes: reason ? `Vendor declined: ${reason}` : 'Vendor declined'
    })
  });

  // Find all prior vendors for exclusion in reassignment
  const priorUrl = `${supabaseUrl}/rest/v1/kusum_lead_assignments?kusum_lead_id=eq.${assignment.kusum_lead_id}&select=vendor_id`;
  const priorRes = await fetch(priorUrl, {
    headers: { 'apikey': supabaseKey, 'Authorization': `Bearer ${supabaseKey}` }
  });
  const priors = await priorRes.json();
  const excludeIds = priors.map(p => p.vendor_id);

  let reassignResult = null;
  try {
    reassignResult = await matchKusumLead(assignment.kusum_lead_id, excludeIds);
  } catch (e) {
    console.error('KUSUM reassignment failed:', e);
  }

  return res.status(200).json({
    success: true,
    message: 'KUSUM lead declined',
    reassigned: reassignResult?.matched || false,
    newVendorName: reassignResult?.vendorName || null
  });
}

// ============================================================
// KUSUM ACTION: outcome-kusum
// Updates outcome through the 6-stage KUSUM lifecycle
// ============================================================
async function handleOutcomeKusum(req, res, vendor) {
  const { assignmentId, outcome, notes } = req.body;

  if (!assignmentId || !outcome) return res.status(400).json({ error: 'assignmentId and outcome required' });
  if (!VALID_KUSUM_OUTCOMES.includes(outcome)) {
    return res.status(400).json({ error: `outcome must be one of: ${VALID_KUSUM_OUTCOMES.join(', ')}` });
  }

  if (!vendor.handles_kusum) {
    return res.status(403).json({ error: 'not_kusum_specialist' });
  }

  const supabaseUrl = process.env.SUPABASE_URL;
  const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  const checkUrl = `${supabaseUrl}/rest/v1/kusum_lead_assignments?id=eq.${assignmentId}&vendor_id=eq.${vendor.id}&select=*&limit=1`;
  const checkRes = await fetch(checkUrl, {
    headers: { 'apikey': supabaseKey, 'Authorization': `Bearer ${supabaseKey}` }
  });
  const assignments = await checkRes.json();
  if (!assignments || assignments.length === 0) {
    return res.status(404).json({ error: 'Assignment not found or not yours' });
  }

  const update = {
    outcome,
    outcome_updated_at: new Date().toISOString()
  };
  if (notes) {
    const existing = assignments[0].notes || '';
    update.notes = existing ? `${existing}\n\n[${new Date().toISOString().slice(0, 10)}] ${notes}` : notes;
  }

  // Commission transitions per KUSUM lifecycle
  // - commissioned = subsidy paid, install done, net meter active → commission OWED
  // - installation_complete = system installed but not yet commissioned (UPPCL net meter pending)
  // - declined_by_farmer / rejected_by_upneda / no_response = no commission
  if (outcome === 'commissioned') {
    update.commission_status = 'owed';
  } else if (['declined_by_farmer', 'rejected_by_upneda', 'no_response'].includes(outcome)) {
    update.commission_status = 'waived';
  }

  await fetch(`${supabaseUrl}/rest/v1/kusum_lead_assignments?id=eq.${assignmentId}`, {
    method: 'PATCH',
    headers: {
      'apikey': supabaseKey,
      'Authorization': `Bearer ${supabaseKey}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(update)
  });

  return res.status(200).json({
    success: true,
    message: `KUSUM outcome updated to ${outcome}`,
    commissionOwed: outcome === 'commissioned'
  });
}

// ============================================================
// KUSUM ACTION: stats-kusum
// ============================================================
async function handleStatsKusum(req, res, vendor) {
  const supabaseUrl = process.env.SUPABASE_URL;
  const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!vendor.handles_kusum) {
    return res.status(200).json({
      success: true,
      stats: null,
      message: 'Vendor is not a KUSUM specialist'
    });
  }

  // Fetch all KUSUM assignments for this vendor
  const assignmentsRes = await fetch(
    `${supabaseUrl}/rest/v1/kusum_lead_assignments?vendor_id=eq.${vendor.id}&select=*`,
    { headers: { 'apikey': supabaseKey, 'Authorization': `Bearer ${supabaseKey}` } }
  );
  const assignments = await assignmentsRes.json();

  // Compute stats locally
  const now = Date.now();
  const last30d = now - 30 * 24 * 60 * 60 * 1000;

  const stats = {
    kusum_received: assignments.length,
    kusum_received_30d: assignments.filter(a => new Date(a.assigned_at || a.created_at).getTime() >= last30d).length,
    kusum_open: assignments.filter(a => ['pending', 'contacted', 'site_survey_done', 'application_submitted', 'sanctioned'].includes(a.outcome)).length,
    kusum_commissioned: assignments.filter(a => a.outcome === 'commissioned').length,
    kusum_commissioned_30d: assignments.filter(a => a.outcome === 'commissioned' && a.outcome_updated_at && new Date(a.outcome_updated_at).getTime() >= last30d).length,
    kusum_dead: assignments.filter(a => ['declined_by_vendor', 'declined_by_farmer', 'rejected_by_upneda', 'no_response'].includes(a.outcome)).length,

    // Component breakdown
    component_a: assignments.filter(a => a.component === 'A').length,
    component_b: assignments.filter(a => a.component === 'B').length,
    component_c: assignments.filter(a => ['C1', 'C2'].includes(a.component)).length,

    // Commission totals
    kusum_commission_owed: assignments
      .filter(a => a.commission_status === 'owed')
      .reduce((s, a) => s + (parseFloat(a.commission_amount) || 0), 0),
    kusum_commission_invoiced: assignments
      .filter(a => a.commission_status === 'invoiced')
      .reduce((s, a) => s + (parseFloat(a.commission_amount) || 0), 0),
    kusum_commission_paid: assignments
      .filter(a => a.commission_status === 'paid')
      .reduce((s, a) => s + (parseFloat(a.commission_amount) || 0), 0),
  };

  // Computed metrics
  stats.kusum_close_rate_pct = stats.kusum_received > 0
    ? Math.round((stats.kusum_commissioned / stats.kusum_received) * 100 * 10) / 10
    : 0;

  return res.status(200).json({ success: true, stats });
}
