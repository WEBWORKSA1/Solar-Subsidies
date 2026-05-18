/**
 * /api/vendor-leads.js — Vendor-side lead actions
 * 
 * Endpoints (single file, action via query param):
 *   POST /api/vendor-leads?action=list      { sessionToken, filter? }
 *     → Returns vendor's leads from vendor_inbox view.
 *       filter: 'open' | 'closed' | 'all'
 *   
 *   POST /api/vendor-leads?action=claim     { sessionToken, assignmentId }
 *     → Marks lead as 'contacted', records response time.
 *   
 *   POST /api/vendor-leads?action=decline   { sessionToken, assignmentId, reason }
 *     → Marks declined_by_vendor, triggers reassignment to next vendor.
 *   
 *   POST /api/vendor-leads?action=outcome   { sessionToken, assignmentId, outcome, notes? }
 *     → Updates outcome (site_visit_scheduled, quote_sent, contract_signed, etc.)
 *   
 *   POST /api/vendor-leads?action=stats     { sessionToken }
 *     → Returns vendor_performance view data.
 */

import { validateSession } from './vendor-auth.js';
import { matchLead } from './match-lead.js';

const ALLOWED_ORIGINS = [
  'https://solarsubsidies.com',
  'https://www.solarsubsidies.com',
  'https://solar-subsidies.vercel.app',
  'http://localhost:3000'
];

const VALID_OUTCOMES = [
  'contacted', 'site_visit_scheduled', 'quote_sent',
  'contract_signed', 'installation_complete', 'net_meter_activated',
  'declined_by_customer', 'lost_to_competitor', 'no_response'
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
    if (action === 'list')    return await handleList(req, res, vendor);
    if (action === 'claim')   return await handleClaim(req, res, vendor);
    if (action === 'decline') return await handleDecline(req, res, vendor);
    if (action === 'outcome') return await handleOutcome(req, res, vendor);
    if (action === 'stats')   return await handleStats(req, res, vendor);
    return res.status(400).json({ error: 'Unknown action' });
  } catch (err) {
    console.error('Vendor leads error:', err);
    return res.status(500).json({ error: 'Internal error', detail: err.message });
  }
}

// ============================================================
// ACTION: list — vendor's lead inbox
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
// ACTION: claim — vendor acknowledges they'll work the lead
// ============================================================
async function handleClaim(req, res, vendor) {
  const { assignmentId } = req.body;
  if (!assignmentId) return res.status(400).json({ error: 'assignmentId required' });
  
  const supabaseUrl = process.env.SUPABASE_URL;
  const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  
  // Verify this assignment belongs to this vendor
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
  
  // Calculate response time
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
  
  if (!updateRes.ok) {
    return res.status(500).json({ error: 'DB update failed' });
  }
  
  return res.status(200).json({
    success: true,
    message: 'Lead claimed',
    responseTimeMinutes: responseMinutes,
    onTimeForSLA: responseMinutes <= 240
  });
}

// ============================================================
// ACTION: decline — release lead for reassignment
// ============================================================
async function handleDecline(req, res, vendor) {
  const { assignmentId, reason } = req.body;
  if (!assignmentId) return res.status(400).json({ error: 'assignmentId required' });
  
  const supabaseUrl = process.env.SUPABASE_URL;
  const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  
  // Verify ownership
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
  
  // Mark declined
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
  
  // Find all vendors who've already had this lead (for exclusion)
  const priorUrl = `${supabaseUrl}/rest/v1/lead_assignments?lead_id=eq.${assignment.lead_id}&select=vendor_id`;
  const priorRes = await fetch(priorUrl, {
    headers: { 'apikey': supabaseKey, 'Authorization': `Bearer ${supabaseKey}` }
  });
  const priors = await priorRes.json();
  const excludeIds = priors.map(p => p.vendor_id);
  
  // Trigger reassignment to next vendor
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
// ACTION: outcome — vendor updates lead status
// ============================================================
async function handleOutcome(req, res, vendor) {
  const { assignmentId, outcome, notes } = req.body;
  
  if (!assignmentId || !outcome) return res.status(400).json({ error: 'assignmentId and outcome required' });
  if (!VALID_OUTCOMES.includes(outcome)) {
    return res.status(400).json({ error: `outcome must be one of: ${VALID_OUTCOMES.join(', ')}` });
  }
  
  const supabaseUrl = process.env.SUPABASE_URL;
  const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  
  // Verify ownership
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
  
  // Commission transitions
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
// ACTION: stats — performance dashboard data
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
      tier: vendor.tier,
      commission_rate: vendor.commission_rate,
      active: vendor.active,
      coverage_districts: vendor.coverage_districts,
      lead_capacity_per_week: vendor.lead_capacity_per_week
    }
  });
}
