/**
 * /api/vendor-kusum-leads.js — Vendor-side KUSUM lead actions (v0.9.0)
 *
 * Mirrors api/vendor-leads.js but operates on kusum_lead_assignments instead of
 * lead_assignments. KUSUM has different outcome states, different commission
 * trigger (commissioned, not net_meter_activated), 48hr SLA, and KUSUM-specific
 * document checklist tracking.
 *
 * Endpoints (single file, action via query param):
 *   POST /api/vendor-kusum-leads?action=list      { sessionToken, filter? }
 *     filter: 'open' | 'closed' | 'all'
 *
 *   POST /api/vendor-kusum-leads?action=claim     { sessionToken, assignmentId }
 *     → outcome='contacted', records response time
 *
 *   POST /api/vendor-kusum-leads?action=decline   { sessionToken, assignmentId, reason }
 *     → outcome='declined_by_vendor', triggers KUSUM reassignment
 *
 *   POST /api/vendor-kusum-leads?action=outcome   { sessionToken, assignmentId, outcome, notes?, docs? }
 *     KUSUM outcome enum (per 0008_kusum_and_directory.sql):
 *       pending → contacted → site_survey_done → application_submitted
 *               → sanctioned → installation_complete → commissioned
 *     Commission triggers on 'commissioned' (not 'net_meter_activated')
 *
 *   POST /api/vendor-kusum-leads?action=stats     { sessionToken }
 *     → KUSUM-specific stats for this vendor
 *
 *   POST /api/vendor-kusum-leads?action=docs      { sessionToken, assignmentId, docs }
 *     → Update document checklist (aadhaar, ror_khasra, water_photo, bank_passbook,
 *       electricity_bill — booleans)
 */

import { validateSession } from './vendor-auth.js';
import { matchKusumLead } from './match-kusum-lead.js';

const ALLOWED_ORIGINS = [
  'https://solarsubsidies.com',
  'https://www.solarsubsidies.com',
  'https://solar-subsidies.vercel.app',
  'http://localhost:3000'
];

// KUSUM outcome enum (matches 0008_kusum_and_directory.sql constraint)
const VALID_KUSUM_OUTCOMES = [
  'contacted',
  'site_survey_done',
  'application_submitted',
  'sanctioned',
  'installation_complete',
  'commissioned',
  'declined_by_vendor',
  'declined_by_farmer',
  'rejected_by_upneda',
  'no_response'
];

// Outcome that triggers commission OWED
const COMMISSION_TRIGGER_OUTCOME = 'commissioned';

// Outcomes that close the deal as dead (waive commission)
const DEAD_OUTCOMES = ['declined_by_vendor', 'declined_by_farmer', 'rejected_by_upneda', 'no_response'];

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

  // Verify this vendor is a KUSUM specialist before allowing KUSUM actions
  if (!vendor.handles_kusum && action !== 'list') {
    return res.status(403).json({
      error: 'Not a KUSUM specialist',
      detail: 'Your account is not flagged as KUSUM-capable. Contact admin to enable.'
    });
  }

  try {
    if (action === 'list')    return await handleList(req, res, vendor);
    if (action === 'claim')   return await handleClaim(req, res, vendor);
    if (action === 'decline') return await handleDecline(req, res, vendor);
    if (action === 'outcome') return await handleOutcome(req, res, vendor);
    if (action === 'docs')    return await handleDocs(req, res, vendor);
    if (action === 'stats')   return await handleStats(req, res, vendor);
    return res.status(400).json({ error: 'Unknown action' });
  } catch (err) {
    console.error('Vendor KUSUM leads error:', err);
    return res.status(500).json({ error: 'Internal error', detail: err.message });
  }
}

// ============================================================
// HELPER: Supabase config
// ============================================================
function sb() {
  return {
    url: process.env.SUPABASE_URL,
    key: process.env.SUPABASE_SERVICE_ROLE_KEY,
    headers: {
      'apikey': process.env.SUPABASE_SERVICE_ROLE_KEY,
      'Authorization': `Bearer ${process.env.SUPABASE_SERVICE_ROLE_KEY}`
    }
  };
}

// ============================================================
// ACTION: list — vendor's KUSUM lead inbox
// ============================================================
async function handleList(req, res, vendor) {
  const { filter = 'open' } = req.body;
  const s = sb();

  // Query kusum_lead_assignments joined with kusum_leads + filter by vendor
  // We build the query as a Supabase REST embed
  let url = `${s.url}/rest/v1/kusum_lead_assignments?` +
    `vendor_id=eq.${vendor.id}&` +
    `select=id,assigned_at,expires_at,component,outcome,commission_amount,commission_rate,commission_status,notes,` +
    `kusum_lead:kusum_lead_id(id,name,phone,email,district_slug,village_or_tehsil,` +
    `land_owned_acres,land_ownership_proof,pump_situation,pump_hp,existing_pump_age,` +
    `water_source,water_depth_ft,irrigation_acres,primary_crops,` +
    `current_electricity_bill_monthly,current_diesel_spend_monthly,` +
    `recommended_component,estimated_system_kw,estimated_gross_cost,` +
    `estimated_subsidy_central,estimated_subsidy_state,estimated_farmer_contribution,` +
    `estimated_loan_eligible,estimated_payback_years,estimated_diesel_savings_annual,` +
    `kusum_lead_score,kusum_lead_tier,status,created_at,calculator_snapshot)&` +
    `order=assigned_at.desc&limit=200`;

  if (filter === 'open') {
    url += '&outcome=eq.pending';
  } else if (filter === 'closed') {
    url += '&outcome=in.(commissioned,installation_complete)';
  } else if (filter === 'in_progress') {
    url += '&outcome=in.(contacted,site_survey_done,application_submitted,sanctioned)';
  } else if (filter === 'dead') {
    url += '&outcome=in.(declined_by_vendor,declined_by_farmer,rejected_by_upneda,no_response)';
  }

  const inboxRes = await fetch(url, { headers: s.headers });
  if (!inboxRes.ok) {
    const err = await inboxRes.text();
    console.error('KUSUM inbox query failed:', err);
    return res.status(500).json({ error: 'DB query failed', detail: err });
  }

  const rawAssignments = await inboxRes.json();

  // Compute SLA status for each + flatten kusum_lead into top-level fields
  const now = Date.now();
  const leads = rawAssignments.map(a => {
    const kl = a.kusum_lead || {};
    let slaStatus = 'open';
    if (a.outcome !== 'pending') {
      slaStatus = DEAD_OUTCOMES.includes(a.outcome) ? 'dead' :
                  a.outcome === COMMISSION_TRIGGER_OUTCOME ? 'commissioned' :
                  'in_progress';
    } else if (a.expires_at) {
      const expiresAt = new Date(a.expires_at).getTime();
      const hoursLeft = (expiresAt - now) / (1000 * 60 * 60);
      if (hoursLeft < 0) slaStatus = 'expired';
      else if (hoursLeft < 6) slaStatus = 'urgent';
      else slaStatus = 'open';
    }

    return {
      assignment_id: a.id,
      assigned_at: a.assigned_at,
      expires_at: a.expires_at,
      component: a.component,
      outcome: a.outcome,
      commission_amount: a.commission_amount,
      commission_rate: a.commission_rate,
      commission_status: a.commission_status,
      vendor_notes: a.notes,
      sla_status: slaStatus,

      kusum_lead_id: kl.id,
      farmer_name: kl.name,
      farmer_phone: kl.phone,
      farmer_email: kl.email,
      district_slug: kl.district_slug,
      village_or_tehsil: kl.village_or_tehsil,

      land_owned_acres: kl.land_owned_acres,
      land_ownership_proof: kl.land_ownership_proof,
      pump_situation: kl.pump_situation,
      pump_hp: kl.pump_hp,
      existing_pump_age: kl.existing_pump_age,

      water_source: kl.water_source,
      water_depth_ft: kl.water_depth_ft,
      irrigation_acres: kl.irrigation_acres,

      primary_crops: kl.primary_crops,
      current_electricity_bill_monthly: kl.current_electricity_bill_monthly,
      current_diesel_spend_monthly: kl.current_diesel_spend_monthly,

      recommended_component: kl.recommended_component,
      estimated_system_kw: kl.estimated_system_kw,
      estimated_gross_cost: kl.estimated_gross_cost,
      estimated_subsidy_central: kl.estimated_subsidy_central,
      estimated_subsidy_state: kl.estimated_subsidy_state,
      estimated_farmer_contribution: kl.estimated_farmer_contribution,
      estimated_loan_eligible: kl.estimated_loan_eligible,
      estimated_payback_years: kl.estimated_payback_years,
      estimated_diesel_savings_annual: kl.estimated_diesel_savings_annual,

      kusum_lead_score: kl.kusum_lead_score,
      kusum_lead_tier: kl.kusum_lead_tier,
      lead_created_at: kl.created_at,

      // Document checklist (stored in notes as JSON, parsed on read)
      docs: parseDocsFromNotes(a.notes)
    };
  });

  return res.status(200).json({ success: true, leads, count: leads.length });
}

// ============================================================
// ACTION: claim — vendor acknowledges they'll work the KUSUM lead
// ============================================================
async function handleClaim(req, res, vendor) {
  const { assignmentId } = req.body;
  if (!assignmentId) return res.status(400).json({ error: 'assignmentId required' });

  const s = sb();

  // Verify assignment belongs to this vendor
  const checkUrl = `${s.url}/rest/v1/kusum_lead_assignments?id=eq.${assignmentId}&vendor_id=eq.${vendor.id}&select=*&limit=1`;
  const checkRes = await fetch(checkUrl, { headers: s.headers });
  const assignments = await checkRes.json();
  if (!assignments || assignments.length === 0) {
    return res.status(404).json({ error: 'KUSUM assignment not found or not yours' });
  }

  const assignment = assignments[0];
  if (assignment.outcome !== 'pending') {
    return res.status(400).json({ error: `Cannot claim — already ${assignment.outcome}` });
  }

  // Calculate response time
  const assignedAt = new Date(assignment.assigned_at || assignment.created_at);
  const responseMinutes = Math.round((Date.now() - assignedAt) / (1000 * 60));

  await fetch(`${s.url}/rest/v1/kusum_lead_assignments?id=eq.${assignmentId}`, {
    method: 'PATCH',
    headers: { ...s.headers, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      outcome: 'contacted',
      outcome_updated_at: new Date().toISOString()
    })
  });

  return res.status(200).json({
    success: true,
    message: 'KUSUM lead claimed',
    responseTimeMinutes: responseMinutes,
    // KUSUM SLA is 48hr (vs 4hr for rooftop)
    onTimeForSLA: responseMinutes <= (48 * 60)
  });
}

// ============================================================
// ACTION: decline — release KUSUM lead for reassignment
// ============================================================
async function handleDecline(req, res, vendor) {
  const { assignmentId, reason } = req.body;
  if (!assignmentId) return res.status(400).json({ error: 'assignmentId required' });

  const s = sb();

  // Verify ownership
  const checkUrl = `${s.url}/rest/v1/kusum_lead_assignments?id=eq.${assignmentId}&vendor_id=eq.${vendor.id}&select=*&limit=1`;
  const checkRes = await fetch(checkUrl, { headers: s.headers });
  const assignments = await checkRes.json();
  if (!assignments || assignments.length === 0) {
    return res.status(404).json({ error: 'KUSUM assignment not found or not yours' });
  }

  const assignment = assignments[0];
  if (assignment.outcome !== 'pending' && assignment.outcome !== 'contacted') {
    return res.status(400).json({ error: `Cannot decline — already ${assignment.outcome}` });
  }

  // Mark declined
  await fetch(`${s.url}/rest/v1/kusum_lead_assignments?id=eq.${assignmentId}`, {
    method: 'PATCH',
    headers: { ...s.headers, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      outcome: 'declined_by_vendor',
      outcome_updated_at: new Date().toISOString(),
      commission_status: 'waived',
      notes: reason ? `Declined: ${reason}` : 'Declined by vendor'
    })
  });

  // Find prior vendors (for exclusion in reassignment)
  const priorUrl = `${s.url}/rest/v1/kusum_lead_assignments?kusum_lead_id=eq.${assignment.kusum_lead_id}&select=vendor_id`;
  const priorRes = await fetch(priorUrl, { headers: s.headers });
  const priors = await priorRes.json();
  const excludeIds = priors.map(p => p.vendor_id);

  // Trigger KUSUM reassignment
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
    newVendorName: reassignResult?.vendorName || null,
    reassignReason: reassignResult?.matched ? null : reassignResult?.reason
  });
}

// ============================================================
// ACTION: outcome — vendor updates KUSUM lead status
// ============================================================
async function handleOutcome(req, res, vendor) {
  const { assignmentId, outcome, notes } = req.body;

  if (!assignmentId || !outcome) return res.status(400).json({ error: 'assignmentId and outcome required' });
  if (!VALID_KUSUM_OUTCOMES.includes(outcome)) {
    return res.status(400).json({
      error: `outcome must be one of: ${VALID_KUSUM_OUTCOMES.join(', ')}`
    });
  }

  const s = sb();

  // Verify ownership + get current state (preserve docs in notes JSON)
  const checkUrl = `${s.url}/rest/v1/kusum_lead_assignments?id=eq.${assignmentId}&vendor_id=eq.${vendor.id}&select=*&limit=1`;
  const checkRes = await fetch(checkUrl, { headers: s.headers });
  const assignments = await checkRes.json();
  if (!assignments || assignments.length === 0) {
    return res.status(404).json({ error: 'KUSUM assignment not found or not yours' });
  }

  const current = assignments[0];
  const update = {
    outcome,
    outcome_updated_at: new Date().toISOString()
  };

  // Append vendor notes while preserving existing docs JSON
  if (notes) {
    const existingDocs = parseDocsFromNotes(current.notes);
    update.notes = serializeNotesWithDocs(notes, existingDocs);
  }

  // Commission transitions specific to KUSUM
  if (outcome === COMMISSION_TRIGGER_OUTCOME) {
    update.commission_status = 'owed';
  } else if (DEAD_OUTCOMES.includes(outcome)) {
    update.commission_status = 'waived';
  }

  await fetch(`${s.url}/rest/v1/kusum_lead_assignments?id=eq.${assignmentId}`, {
    method: 'PATCH',
    headers: { ...s.headers, 'Content-Type': 'application/json' },
    body: JSON.stringify(update)
  });

  // Update kusum_leads.status to match (for admin visibility)
  const leadStatusMap = {
    'site_survey_done': 'site_visit_scheduled',
    'application_submitted': 'application_submitted',
    'sanctioned': 'sanctioned',
    'installation_complete': 'installed',
    'commissioned': 'commissioned'
  };
  if (leadStatusMap[outcome]) {
    await fetch(`${s.url}/rest/v1/kusum_leads?id=eq.${current.kusum_lead_id}`, {
      method: 'PATCH',
      headers: { ...s.headers, 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: leadStatusMap[outcome] })
    });
  }

  return res.status(200).json({
    success: true,
    message: `KUSUM outcome updated to ${outcome}`,
    commissionOwed: outcome === COMMISSION_TRIGGER_OUTCOME,
    commissionWaived: DEAD_OUTCOMES.includes(outcome)
  });
}

// ============================================================
// ACTION: docs — update KUSUM document checklist
// ============================================================
async function handleDocs(req, res, vendor) {
  const { assignmentId, docs } = req.body;
  if (!assignmentId || !docs || typeof docs !== 'object') {
    return res.status(400).json({ error: 'assignmentId and docs (object) required' });
  }

  // Whitelist the document keys we accept
  const allowedDocKeys = ['aadhaar', 'ror_khasra', 'water_photo', 'bank_passbook', 'electricity_bill'];
  const cleanedDocs = {};
  for (const k of allowedDocKeys) {
    if (typeof docs[k] === 'boolean') cleanedDocs[k] = docs[k];
  }

  const s = sb();

  // Verify ownership
  const checkUrl = `${s.url}/rest/v1/kusum_lead_assignments?id=eq.${assignmentId}&vendor_id=eq.${vendor.id}&select=notes&limit=1`;
  const checkRes = await fetch(checkUrl, { headers: s.headers });
  const assignments = await checkRes.json();
  if (!assignments || assignments.length === 0) {
    return res.status(404).json({ error: 'KUSUM assignment not found or not yours' });
  }

  const currentNotes = assignments[0].notes;
  const existingDocs = parseDocsFromNotes(currentNotes);
  const mergedDocs = { ...existingDocs, ...cleanedDocs };

  // Strip the existing __DOCS__ block and re-serialize
  const cleanNotes = (currentNotes || '').replace(/\n?__DOCS__\{.*?\}__/s, '').trim();
  const newNotes = serializeNotesWithDocs(cleanNotes, mergedDocs);

  await fetch(`${s.url}/rest/v1/kusum_lead_assignments?id=eq.${assignmentId}`, {
    method: 'PATCH',
    headers: { ...s.headers, 'Content-Type': 'application/json' },
    body: JSON.stringify({ notes: newNotes })
  });

  return res.status(200).json({
    success: true,
    docs: mergedDocs,
    allCollected: Object.values(mergedDocs).filter(Boolean).length === allowedDocKeys.length
  });
}

// ============================================================
// ACTION: stats — KUSUM-specific stats for this vendor
// ============================================================
async function handleStats(req, res, vendor) {
  const s = sb();

  // Pull all this vendor's KUSUM assignments + compute stats
  const url = `${s.url}/rest/v1/kusum_lead_assignments?vendor_id=eq.${vendor.id}&select=outcome,commission_status,commission_amount,assigned_at,component`;
  const assignmentsRes = await fetch(url, { headers: s.headers });
  if (!assignmentsRes.ok) {
    return res.status(500).json({ error: 'Stats query failed' });
  }
  const all = await assignmentsRes.json();

  const now = Date.now();
  const day30 = new Date(now - 30 * 24 * 60 * 60 * 1000).getTime();

  const stats = {
    kusum_leads_received: all.length,
    kusum_leads_open: all.filter(a => a.outcome === 'pending').length,
    kusum_leads_in_progress: all.filter(a => ['contacted', 'site_survey_done', 'application_submitted', 'sanctioned'].includes(a.outcome)).length,
    kusum_leads_commissioned: all.filter(a => a.outcome === 'commissioned').length,
    kusum_leads_dead: all.filter(a => DEAD_OUTCOMES.includes(a.outcome)).length,

    kusum_close_rate_pct: all.length > 0
      ? Math.round((all.filter(a => a.outcome === 'commissioned').length / all.length) * 100 * 10) / 10
      : 0,

    // Component breakdown
    component_a: all.filter(a => a.component === 'A').length,
    component_b: all.filter(a => a.component === 'B').length,
    component_c1: all.filter(a => a.component === 'C1').length,
    component_c2: all.filter(a => a.component === 'C2').length,

    // Commission
    kusum_commission_owed: all.filter(a => a.commission_status === 'owed').reduce((s, a) => s + (parseFloat(a.commission_amount) || 0), 0),
    kusum_commission_invoiced: all.filter(a => a.commission_status === 'invoiced').reduce((s, a) => s + (parseFloat(a.commission_amount) || 0), 0),
    kusum_commission_paid: all.filter(a => a.commission_status === 'paid').reduce((s, a) => s + (parseFloat(a.commission_amount) || 0), 0),

    // Last 30 days
    kusum_received_30d: all.filter(a => new Date(a.assigned_at).getTime() >= day30).length,
    kusum_commissioned_30d: all.filter(a => a.outcome === 'commissioned' && new Date(a.assigned_at).getTime() >= day30).length
  };

  return res.status(200).json({ success: true, stats });
}

// ============================================================
// HELPERS: document checklist persistence in notes column
// (kusum_lead_assignments has no dedicated docs JSONB column;
//  we encode docs as a __DOCS__{...}__ block in the `notes` text column)
// ============================================================
function parseDocsFromNotes(notes) {
  const defaults = { aadhaar: false, ror_khasra: false, water_photo: false, bank_passbook: false, electricity_bill: false };
  if (!notes) return defaults;
  const match = notes.match(/__DOCS__(\{.*?\})__/s);
  if (!match) return defaults;
  try {
    const parsed = JSON.parse(match[1]);
    return { ...defaults, ...parsed };
  } catch {
    return defaults;
  }
}

function serializeNotesWithDocs(notes, docs) {
  const cleanNotes = (notes || '').replace(/\n?__DOCS__\{.*?\}__/s, '').trim();
  const docsBlock = `__DOCS__${JSON.stringify(docs)}__`;
  return cleanNotes ? `${cleanNotes}\n${docsBlock}` : docsBlock;
}
