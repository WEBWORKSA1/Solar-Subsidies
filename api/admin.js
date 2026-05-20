/**
 * /api/admin.js — Admin dashboard backend (v0.8.3)
 * 
 * Token-gated multi-action endpoint. Single shared admin token (env var ADMIN_TOKEN).
 * All actions require the token in the Authorization header OR ?token= query param.
 * 
 * GET endpoints (data fetching):
 *   GET  /api/admin?action=stats                                  → admin_dashboard_stats
 *   GET  /api/admin?action=leads&filter=&tier=&district=&limit=  → admin_leads_overview
 *   GET  /api/admin?action=kusum-leads&filter=&tier=&component=  → kusum_dashboard view (v0.8.3 NEW)
 *   GET  /api/admin?action=kusum-stats                            → KUSUM-specific stats (v0.8.3 NEW)
 *   GET  /api/admin?action=vendors&tier=&active=&kusum=           → admin_vendor_health (KUSUM filter v0.8.3)
 *   GET  /api/admin?action=applications&status=                   → vendor_applications
 *   GET  /api/admin?action=commissions&status=                    → admin_commissions
 *   GET  /api/admin?action=coverage                               → admin_coverage_map
 * 
 * POST endpoints (mutations):
 *   POST /api/admin?action=reassign-lead         { leadId, excludeVendorIds }
 *   POST /api/admin?action=force-assign          { leadId, vendorId }
 *   POST /api/admin?action=reassign-kusum-lead   { kusumLeadId, excludeVendorIds }  (v0.8.3 NEW)
 *   POST /api/admin?action=force-assign-kusum    { kusumLeadId, vendorId }          (v0.8.3 NEW)
 *   POST /api/admin?action=update-kusum-lead     { kusumLeadId, fields }            (v0.8.3 NEW)
 *   POST /api/admin?action=update-kusum-assignment { assignmentId, fields }         (v0.8.3 NEW)
 *   POST /api/admin?action=update-lead           { leadId, fields }
 *   POST /api/admin?action=update-vendor         { vendorId, fields }
 *   POST /api/admin?action=approve-app           { applicationId, notes }
 *   POST /api/admin?action=reject-app            { applicationId, reason }
 *   POST /api/admin?action=mark-invoiced         { assignmentId, invoiceNumber? }
 *   POST /api/admin?action=mark-paid             { assignmentId, paidDate? }
 *   POST /api/admin?action=waive-commission      { assignmentId, reason }
 *   POST /api/admin?action=update-assignment     { assignmentId, fields }
 * 
 * ENV VARS:
 *   ADMIN_TOKEN  (required — shared secret for dashboard auth)
 *   SUPABASE_URL
 *   SUPABASE_SERVICE_ROLE_KEY
 *   MATCH_INTERNAL_TOKEN  (for triggering reassignment)
 */

import { matchLead } from './match-lead.js';
import { matchKusumLead } from './match-kusum-lead.js';

const ALLOWED_ORIGINS = [
  'https://solarsubsidies.com',
  'https://www.solarsubsidies.com',
  'https://solar-subsidies.vercel.app',
  'http://localhost:3000'
];

export default async function handler(req, res) {
  const origin = req.headers.origin;
  if (ALLOWED_ORIGINS.includes(origin)) {
    res.setHeader('Access-Control-Allow-Origin', origin);
  }
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  
  if (req.method === 'OPTIONS') return res.status(200).end();
  
  // Auth check
  const token = req.headers.authorization?.replace('Bearer ', '') || req.query.token;
  if (!token || token !== process.env.ADMIN_TOKEN) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  
  const action = req.query.action;
  
  try {
    // GET actions
    if (req.method === 'GET') {
      if (action === 'stats')           return await getStats(req, res);
      if (action === 'leads')           return await getLeads(req, res);
      if (action === 'kusum-leads')     return await getKusumLeads(req, res);
      if (action === 'kusum-stats')     return await getKusumStats(req, res);
      if (action === 'vendors')         return await getVendors(req, res);
      if (action === 'applications')    return await getApplications(req, res);
      if (action === 'commissions')     return await getCommissions(req, res);
      if (action === 'coverage')        return await getCoverage(req, res);
      return res.status(400).json({ error: 'Unknown GET action' });
    }
    
    // POST actions
    if (req.method === 'POST') {
      if (action === 'reassign-lead')         return await reassignLead(req, res);
      if (action === 'force-assign')          return await forceAssign(req, res);
      if (action === 'reassign-kusum-lead')   return await reassignKusumLead(req, res);
      if (action === 'force-assign-kusum')    return await forceAssignKusum(req, res);
      if (action === 'update-kusum-lead')     return await updateKusumLead(req, res);
      if (action === 'update-kusum-assignment') return await updateKusumAssignment(req, res);
      if (action === 'update-lead')           return await updateLead(req, res);
      if (action === 'update-vendor')         return await updateVendor(req, res);
      if (action === 'approve-app')           return await approveApp(req, res);
      if (action === 'reject-app')            return await rejectApp(req, res);
      if (action === 'mark-invoiced')         return await markInvoiced(req, res);
      if (action === 'mark-paid')             return await markPaid(req, res);
      if (action === 'waive-commission')      return await waiveCommission(req, res);
      if (action === 'update-assignment')     return await updateAssignment(req, res);
      return res.status(400).json({ error: 'Unknown POST action' });
    }
    
    return res.status(405).json({ error: 'Method not allowed' });
  } catch (err) {
    console.error('Admin API error:', err);
    return res.status(500).json({ error: 'Internal error', detail: err.message });
  }
}

// ============================================================
// HELPERS
// ============================================================

function supabase() {
  return {
    url: process.env.SUPABASE_URL,
    key: process.env.SUPABASE_SERVICE_ROLE_KEY,
    headers: {
      'apikey': process.env.SUPABASE_SERVICE_ROLE_KEY,
      'Authorization': `Bearer ${process.env.SUPABASE_SERVICE_ROLE_KEY}`
    }
  };
}

async function sbGet(path) {
  const s = supabase();
  const res = await fetch(`${s.url}/rest/v1/${path}`, { headers: s.headers });
  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Supabase GET ${path} failed: ${err}`);
  }
  return await res.json();
}

async function sbPatch(path, body) {
  const s = supabase();
  const res = await fetch(`${s.url}/rest/v1/${path}`, {
    method: 'PATCH',
    headers: { ...s.headers, 'Content-Type': 'application/json', 'Prefer': 'return=representation' },
    body: JSON.stringify(body)
  });
  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Supabase PATCH ${path} failed: ${err}`);
  }
  return await res.json();
}

async function sbInsert(path, body) {
  const s = supabase();
  const res = await fetch(`${s.url}/rest/v1/${path}`, {
    method: 'POST',
    headers: { ...s.headers, 'Content-Type': 'application/json', 'Prefer': 'return=representation' },
    body: JSON.stringify(body)
  });
  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Supabase INSERT ${path} failed: ${err}`);
  }
  return await res.json();
}

// ============================================================
// GET ACTIONS — ROOFTOP
// ============================================================

async function getStats(req, res) {
  const stats = await sbGet('admin_dashboard_stats?select=*&limit=1');
  return res.status(200).json({ stats: stats?.[0] || {} });
}

async function getLeads(req, res) {
  const { filter, tier, district, limit = 100 } = req.query;
  
  let path = `admin_leads_overview?select=*&limit=${parseInt(limit, 10) || 100}`;
  
  if (filter === 'unmatched') path += '&computed_status=eq.UNMATCHED';
  else if (filter === 'open') path += '&computed_status=in.(NEW,AWAITING_VENDOR,EXPIRED,IN_PROGRESS)';
  else if (filter === 'expired') path += '&computed_status=eq.EXPIRED';
  else if (filter === 'won') path += '&computed_status=eq.CLOSED_WON';
  else if (filter === 'dead') path += '&computed_status=eq.DEAD';
  
  if (tier && tier !== 'all') path += `&lead_tier=eq.${tier}`;
  if (district) path += `&district_slug=eq.${district}`;
  
  const leads = await sbGet(path);
  return res.status(200).json({ leads, count: leads.length });
}

async function getVendors(req, res) {
  const { tier, active, kusum } = req.query;
  
  let path = `admin_vendor_health?select=*`;
  if (tier && tier !== 'all') path += `&tier=eq.${tier}`;
  if (active === 'true') path += '&active=eq.true';
  else if (active === 'false') path += '&active=eq.false';
  
  // v0.8.3: KUSUM specialist filter
  if (kusum === 'true') path += '&handles_kusum=eq.true';
  else if (kusum === 'false') path += '&handles_kusum=eq.false';
  
  const vendors = await sbGet(path);
  return res.status(200).json({ vendors, count: vendors.length });
}

async function getApplications(req, res) {
  const { status = 'pending_review' } = req.query;
  const path = `vendor_applications?select=*&status=eq.${status}&order=created_at.desc&limit=200`;
  const applications = await sbGet(path);
  return res.status(200).json({ applications, count: applications.length });
}

async function getCommissions(req, res) {
  const { status } = req.query;
  
  let path = `admin_commissions?select=*&limit=500`;
  if (status && status !== 'all') path += `&commission_status=eq.${status}`;
  
  const commissions = await sbGet(path);
  
  // Summary totals
  const summary = {
    owed: 0, invoiced: 0, paid: 0, disputed: 0,
    owed_count: 0, invoiced_count: 0, paid_count: 0, disputed_count: 0
  };
  commissions.forEach(c => {
    const amt = parseFloat(c.commission_amount) || 0;
    if (c.commission_status === 'owed')     { summary.owed += amt; summary.owed_count++; }
    else if (c.commission_status === 'invoiced') { summary.invoiced += amt; summary.invoiced_count++; }
    else if (c.commission_status === 'paid') { summary.paid += amt; summary.paid_count++; }
    else if (c.commission_status === 'disputed') { summary.disputed += amt; summary.disputed_count++; }
  });
  
  return res.status(200).json({ commissions, summary, count: commissions.length });
}

async function getCoverage(req, res) {
  const coverage = await sbGet('admin_coverage_map?select=*&limit=200');
  return res.status(200).json({ coverage, count: coverage.length });
}

// ============================================================
// GET ACTIONS — KUSUM (v0.8.3 NEW)
// ============================================================

async function getKusumLeads(req, res) {
  const { filter, tier, component, district, limit = 100 } = req.query;
  
  // Query the kusum_dashboard view (defined in 0008_kusum_and_directory.sql)
  let path = `kusum_dashboard?select=*&limit=${parseInt(limit, 10) || 100}&order=created_at.desc`;
  
  // Filter logic:
  //   filter=unmatched → status is 'documents_pending' or no assignment
  //   filter=assigned → status='assigned' with active assignment
  //   filter=ineligible → recommended_component='ineligible'
  //   filter=open → not ineligible, not commissioned/dropped
  //   filter=won → outcome='commissioned'
  //   filter=dead → outcome in declined_by_vendor, declined_by_farmer, rejected_by_upneda, no_response
  if (filter === 'unmatched') {
    path += '&assignment_id=is.null&recommended_component=neq.ineligible';
  } else if (filter === 'assigned') {
    path += '&status=eq.assigned';
  } else if (filter === 'ineligible') {
    path += '&recommended_component=eq.ineligible';
  } else if (filter === 'won') {
    path += '&outcome=eq.commissioned';
  } else if (filter === 'dead') {
    path += '&outcome=in.(declined_by_vendor,declined_by_farmer,rejected_by_upneda,no_response)';
  } else if (filter === 'open') {
    path += '&recommended_component=neq.ineligible';
  }
  
  if (tier && tier !== 'all') path += `&kusum_lead_tier=eq.${tier}`;
  if (component && component !== 'all') path += `&recommended_component=eq.${component}`;
  if (district) path += `&district_slug=eq.${district}`;
  
  const leads = await sbGet(path);
  return res.status(200).json({ leads, count: leads.length });
}

async function getKusumStats(req, res) {
  // Aggregate KUSUM-specific stats. Doesn't have its own view, so we compute here.
  const fmt = (n) => parseInt(n, 10) || 0;
  
  const allLeads = await sbGet('kusum_dashboard?select=*');
  
  const stats = {
    total_kusum_leads: allLeads.length,
    hot_kusum: allLeads.filter(l => l.kusum_lead_tier === 'HOT').length,
    warm_kusum: allLeads.filter(l => l.kusum_lead_tier === 'WARM').length,
    cold_kusum: allLeads.filter(l => l.kusum_lead_tier === 'COLD').length,
    ineligible_kusum: allLeads.filter(l => l.recommended_component === 'ineligible').length,
    component_a: allLeads.filter(l => l.recommended_component === 'A').length,
    component_b: allLeads.filter(l => l.recommended_component === 'B').length,
    component_c1: allLeads.filter(l => l.recommended_component === 'C1').length,
    component_c2: allLeads.filter(l => l.recommended_component === 'C2').length,
    unmatched: allLeads.filter(l => !l.assignment_id && l.recommended_component !== 'ineligible').length,
    assigned: allLeads.filter(l => l.assignment_id && l.outcome === 'pending').length,
    in_progress: allLeads.filter(l => ['contacted', 'site_survey_done', 'application_submitted', 'sanctioned'].includes(l.outcome)).length,
    commissioned: allLeads.filter(l => l.outcome === 'commissioned').length,
    dead: allLeads.filter(l => ['declined_by_vendor', 'declined_by_farmer', 'rejected_by_upneda', 'no_response'].includes(l.outcome)).length,
  };
  
  // 24h and 7d counts
  const day = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
  const week = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
  stats.leads_24h = allLeads.filter(l => l.created_at >= day).length;
  stats.leads_7d = allLeads.filter(l => l.created_at >= week).length;
  
  // Available KUSUM-specialist vendors
  const kusumVendors = await sbGet('vendors?handles_kusum=eq.true&active=eq.true&select=id,tier');
  stats.kusum_vendors_active = kusumVendors.length;
  stats.kusum_vendors_premium = kusumVendors.filter(v => v.tier === 'premium').length;
  stats.kusum_vendors_standard = kusumVendors.filter(v => v.tier === 'standard').length;
  stats.kusum_vendors_probation = kusumVendors.filter(v => v.tier === 'probation').length;
  
  // Commission totals (from kusum_lead_assignments)
  const commissions = await sbGet('kusum_lead_assignments?select=commission_amount,commission_status');
  stats.kusum_commission_owed = commissions.filter(c => c.commission_status === 'owed').reduce((s, c) => s + (parseFloat(c.commission_amount) || 0), 0);
  stats.kusum_commission_invoiced = commissions.filter(c => c.commission_status === 'invoiced').reduce((s, c) => s + (parseFloat(c.commission_amount) || 0), 0);
  stats.kusum_commission_paid = commissions.filter(c => c.commission_status === 'paid').reduce((s, c) => s + (parseFloat(c.commission_amount) || 0), 0);
  
  return res.status(200).json({ stats });
}

// ============================================================
// POST ACTIONS — ROOFTOP
// ============================================================

async function reassignLead(req, res) {
  const { leadId, excludeVendorIds = [] } = req.body;
  if (!leadId) return res.status(400).json({ error: 'leadId required' });
  
  const current = await sbGet(`lead_assignments?lead_id=eq.${leadId}&select=id,vendor_id&order=created_at.desc&limit=1`);
  if (current && current.length > 0 && current[0].vendor_id) {
    await sbPatch(`lead_assignments?id=eq.${current[0].id}`, {
      outcome: 'declined_by_vendor',
      outcome_updated_at: new Date().toISOString(),
      declined_reason: 'admin_reassigned',
      commission_status: 'waived'
    });
    excludeVendorIds.push(current[0].vendor_id);
  }
  
  const result = await matchLead(leadId, excludeVendorIds);
  return res.status(200).json(result);
}

async function forceAssign(req, res) {
  const { leadId, vendorId } = req.body;
  if (!leadId || !vendorId) return res.status(400).json({ error: 'leadId and vendorId required' });
  
  const leads = await sbGet(`leads?id=eq.${leadId}&select=*&limit=1`);
  const lead = leads?.[0];
  if (!lead) return res.status(404).json({ error: 'Lead not found' });
  
  const vendors = await sbGet(`vendors?id=eq.${vendorId}&select=*&limit=1`);
  const vendor = vendors?.[0];
  if (!vendor) return res.status(404).json({ error: 'Vendor not found' });
  
  const existing = await sbGet(`lead_assignments?lead_id=eq.${leadId}&outcome=eq.pending&select=id&limit=1`);
  if (existing && existing.length > 0) {
    await sbPatch(`lead_assignments?id=eq.${existing[0].id}`, {
      outcome: 'declined_by_vendor',
      outcome_updated_at: new Date().toISOString(),
      declined_reason: 'admin_force_reassign',
      commission_status: 'waived'
    });
  }
  
  const grossValue = (lead.system_size_kw || 3) * 70000;
  const commissionAmount = grossValue * (vendor.commission_rate / 100);
  const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
  
  const assignment = await sbInsert('lead_assignments', {
    lead_id: leadId,
    vendor_id: vendorId,
    assignment_method: 'manual',
    district_slug: lead.district_slug,
    lead_tier: lead.lead_tier,
    lead_score: lead.lead_score,
    system_size_kw: lead.system_size_kw,
    gross_system_value: grossValue,
    commission_rate: vendor.commission_rate,
    commission_amount: Math.round(commissionAmount * 100) / 100,
    commission_status: 'pending',
    expires_at: expiresAt
  });
  
  await sbPatch(`leads?id=eq.${leadId}`, { status: 'assigned' });
  
  return res.status(200).json({
    success: true,
    assignmentId: assignment?.[0]?.id,
    vendorName: vendor.company_name
  });
}

// ============================================================
// POST ACTIONS — KUSUM (v0.8.3 NEW)
// ============================================================

async function reassignKusumLead(req, res) {
  const { kusumLeadId, excludeVendorIds = [] } = req.body;
  if (!kusumLeadId) return res.status(400).json({ error: 'kusumLeadId required' });
  
  // Find current KUSUM assignment, mark as overridden
  const current = await sbGet(`kusum_lead_assignments?kusum_lead_id=eq.${kusumLeadId}&select=id,vendor_id&order=created_at.desc&limit=1`);
  if (current && current.length > 0 && current[0].vendor_id) {
    await sbPatch(`kusum_lead_assignments?id=eq.${current[0].id}`, {
      outcome: 'declined_by_vendor',
      outcome_updated_at: new Date().toISOString(),
      commission_status: 'waived',
      notes: 'Admin reassigned'
    });
    excludeVendorIds.push(current[0].vendor_id);
  }
  
  const result = await matchKusumLead(kusumLeadId, excludeVendorIds);
  return res.status(200).json(result);
}

async function forceAssignKusum(req, res) {
  const { kusumLeadId, vendorId } = req.body;
  if (!kusumLeadId || !vendorId) return res.status(400).json({ error: 'kusumLeadId and vendorId required' });
  
  // Fetch lead + vendor
  const leads = await sbGet(`kusum_leads?id=eq.${kusumLeadId}&select=*&limit=1`);
  const lead = leads?.[0];
  if (!lead) return res.status(404).json({ error: 'KUSUM lead not found' });
  
  const vendors = await sbGet(`vendors?id=eq.${vendorId}&select=*&limit=1`);
  const vendor = vendors?.[0];
  if (!vendor) return res.status(404).json({ error: 'Vendor not found' });
  
  // Verify vendor is KUSUM-capable (warn but allow override)
  if (!vendor.handles_kusum) {
    console.warn(`Force-assigning KUSUM lead ${kusumLeadId} to non-KUSUM-specialist vendor ${vendorId}`);
  }
  
  // Close existing assignment if any
  const existing = await sbGet(`kusum_lead_assignments?kusum_lead_id=eq.${kusumLeadId}&outcome=eq.pending&select=id&limit=1`);
  if (existing && existing.length > 0) {
    await sbPatch(`kusum_lead_assignments?id=eq.${existing[0].id}`, {
      outcome: 'declined_by_vendor',
      outcome_updated_at: new Date().toISOString(),
      commission_status: 'waived',
      notes: 'Admin force-reassigned'
    });
  }
  
  // Create new KUSUM assignment
  const benchmarkCost = lead.estimated_gross_cost || 305000;
  const commissionRate = vendor.commission_rate || 5.0;
  const commissionAmount = Math.round(benchmarkCost * commissionRate / 100);
  const expiresAt = new Date(Date.now() + 48 * 60 * 60 * 1000).toISOString();  // 48h for KUSUM
  
  const assignment = await sbInsert('kusum_lead_assignments', {
    kusum_lead_id: kusumLeadId,
    vendor_id: vendorId,
    assigned_at: new Date().toISOString(),
    expires_at: expiresAt,
    component: lead.recommended_component,
    estimated_system_kw: lead.estimated_system_kw,
    estimated_commission: commissionAmount,
    commission_rate: commissionRate,
    commission_amount: commissionAmount,
    commission_status: 'pending',
    outcome: 'pending',
    notes: 'Force-assigned by admin'
  });
  
  // Update lead status
  await sbPatch(`kusum_leads?id=eq.${kusumLeadId}`, { status: 'assigned' });
  
  return res.status(200).json({
    success: true,
    assignmentId: assignment?.[0]?.id,
    vendorName: vendor.company_name,
    kusumSpecialist: vendor.handles_kusum
  });
}

async function updateKusumLead(req, res) {
  const { kusumLeadId, fields } = req.body;
  if (!kusumLeadId || !fields) return res.status(400).json({ error: 'kusumLeadId and fields required' });
  
  // Whitelist fields admin can edit
  const allowed = ['status', 'kusum_lead_tier', 'kusum_lead_score', 'recommended_component', 'consent_whatsapp'];
  const update = {};
  for (const k of Object.keys(fields)) {
    if (allowed.includes(k)) update[k] = fields[k];
  }
  if (Object.keys(update).length === 0) return res.status(400).json({ error: 'No valid fields to update' });
  
  const result = await sbPatch(`kusum_leads?id=eq.${kusumLeadId}`, update);
  return res.status(200).json({ success: true, lead: result?.[0] });
}

async function updateKusumAssignment(req, res) {
  const { assignmentId, fields } = req.body;
  if (!assignmentId || !fields) return res.status(400).json({ error: 'assignmentId and fields required' });
  
  const allowed = ['outcome', 'commission_status', 'commission_amount', 'commission_paid_at', 'notes'];
  const update = {};
  for (const k of Object.keys(fields)) {
    if (allowed.includes(k)) update[k] = fields[k];
  }
  if (update.outcome) update.outcome_updated_at = new Date().toISOString();
  if (Object.keys(update).length === 0) return res.status(400).json({ error: 'No valid fields' });
  
  const result = await sbPatch(`kusum_lead_assignments?id=eq.${assignmentId}`, update);
  return res.status(200).json({ success: true, assignment: result?.[0] });
}

// ============================================================
// POST ACTIONS — SHARED
// ============================================================

async function updateLead(req, res) {
  const { leadId, fields } = req.body;
  if (!leadId || !fields) return res.status(400).json({ error: 'leadId and fields required' });
  
  const allowed = ['status', 'lead_tier', 'lead_score', 'consent_whatsapp'];
  const update = {};
  for (const k of Object.keys(fields)) {
    if (allowed.includes(k)) update[k] = fields[k];
  }
  if (Object.keys(update).length === 0) return res.status(400).json({ error: 'No valid fields to update' });
  
  const result = await sbPatch(`leads?id=eq.${leadId}`, update);
  return res.status(200).json({ success: true, lead: result?.[0] });
}

async function updateVendor(req, res) {
  const { vendorId, fields } = req.body;
  if (!vendorId || !fields) return res.status(400).json({ error: 'vendorId and fields required' });
  
  const allowed = [
    'tier', 'commission_rate', 'active', 'coverage_districts',
    'min_system_size_kw', 'property_types', 'lead_capacity_per_week',
    'phone', 'email', 'notes', 'agreement_signed_at', 'agreement_version',
    'handles_kusum', 'kusum_components', 'claim_status', 'public_listing'  // v0.8.3
  ];
  const update = {};
  for (const k of Object.keys(fields)) {
    if (allowed.includes(k)) update[k] = fields[k];
  }
  if (Object.keys(update).length === 0) return res.status(400).json({ error: 'No valid fields to update' });
  
  const result = await sbPatch(`vendors?id=eq.${vendorId}`, update);
  return res.status(200).json({ success: true, vendor: result?.[0] });
}

async function approveApp(req, res) {
  const { applicationId, notes } = req.body;
  if (!applicationId) return res.status(400).json({ error: 'applicationId required' });
  
  const apps = await sbGet(`vendor_applications?id=eq.${applicationId}&select=*&limit=1`);
  const app = apps?.[0];
  if (!app) return res.status(404).json({ error: 'Application not found' });
  if (app.status !== 'pending_review' && app.status !== 'under_review') {
    return res.status(400).json({ error: `Cannot approve — status is ${app.status}` });
  }
  
  await sbPatch(`vendor_applications?id=eq.${applicationId}`, {
    status: 'approved',
    reviewer_notes: notes || null,
    reviewed_at: new Date().toISOString()
  });
  
  const capacityMap = { '1-3': 3, '4-10': 8, '11-25': 18, '26-50': 38, '>50': 50 };
  const capacity = capacityMap[app.lead_capacity_per_week] || 5;
  
  const vendor = await sbInsert('vendors', {
    application_id: app.id,
    company_name: app.company_name,
    brand_name: app.brand_name,
    contact_name: app.contact_name,
    phone: app.phone,
    email: app.email,
    website: app.website,
    hq: app.hq,
    mnre_number: app.mnre_number,
    upneda_number: app.upneda_number,
    gstin: app.gstin,
    pan: app.pan,
    commission_rate: 7.0,
    tier: 'probation',
    active: true,
    coverage_districts: app.coverage_districts,
    min_system_size_kw: app.min_system_size_kw,
    property_types: app.property_types,
    lead_capacity_per_week: capacity
  });
  
  return res.status(200).json({
    success: true,
    vendorId: vendor?.[0]?.id,
    message: 'Application approved and promoted to vendor. Now send them the agreement.'
  });
}

async function rejectApp(req, res) {
  const { applicationId, reason } = req.body;
  if (!applicationId) return res.status(400).json({ error: 'applicationId required' });
  
  await sbPatch(`vendor_applications?id=eq.${applicationId}`, {
    status: 'rejected',
    reviewer_notes: reason || null,
    reviewed_at: new Date().toISOString()
  });
  
  return res.status(200).json({ success: true, message: 'Application rejected.' });
}

async function markInvoiced(req, res) {
  const { assignmentId, invoiceNumber, kusum = false } = req.body;
  if (!assignmentId) return res.status(400).json({ error: 'assignmentId required' });
  
  const update = {
    commission_status: 'invoiced',
    commission_invoiced_at: new Date().toISOString()
  };
  if (invoiceNumber) update.notes = `Invoice: ${invoiceNumber}`;
  
  // v0.8.3: support marking KUSUM commissions
  const table = kusum ? 'kusum_lead_assignments' : 'lead_assignments';
  await sbPatch(`${table}?id=eq.${assignmentId}`, update);
  return res.status(200).json({ success: true });
}

async function markPaid(req, res) {
  const { assignmentId, paidDate, kusum = false } = req.body;
  if (!assignmentId) return res.status(400).json({ error: 'assignmentId required' });
  
  const table = kusum ? 'kusum_lead_assignments' : 'lead_assignments';
  await sbPatch(`${table}?id=eq.${assignmentId}`, {
    commission_status: 'paid',
    commission_paid_at: paidDate || new Date().toISOString()
  });
  return res.status(200).json({ success: true });
}

async function waiveCommission(req, res) {
  const { assignmentId, reason, kusum = false } = req.body;
  if (!assignmentId) return res.status(400).json({ error: 'assignmentId required' });
  
  const table = kusum ? 'kusum_lead_assignments' : 'lead_assignments';
  await sbPatch(`${table}?id=eq.${assignmentId}`, {
    commission_status: 'waived',
    notes: reason ? `Waived: ${reason}` : 'Waived'
  });
  return res.status(200).json({ success: true });
}

async function updateAssignment(req, res) {
  const { assignmentId, fields } = req.body;
  if (!assignmentId || !fields) return res.status(400).json({ error: 'assignmentId and fields required' });
  
  const allowed = ['outcome', 'commission_status', 'commission_amount', 'vendor_notes', 'declined_reason', 'net_meter_activated_at'];
  const update = {};
  for (const k of Object.keys(fields)) {
    if (allowed.includes(k)) update[k] = fields[k];
  }
  if (update.outcome) update.outcome_updated_at = new Date().toISOString();
  if (Object.keys(update).length === 0) return res.status(400).json({ error: 'No valid fields' });
  
  const result = await sbPatch(`lead_assignments?id=eq.${assignmentId}`, update);
  return res.status(200).json({ success: true, assignment: result?.[0] });
}
