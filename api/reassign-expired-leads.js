/**
 * /api/reassign-expired-leads.js — Cron-triggered expired lead reassignment (v0.9.1)
 *
 * Runs hourly via Vercel Cron (vercel.json). Sweeps:
 *   1. Rooftop: lead_assignments WHERE outcome='pending' AND expires_at < now()
 *   2. KUSUM:   kusum_lead_assignments WHERE outcome='pending' AND expires_at < now()
 *
 * For each expired assignment:
 *   - Marks current assignment outcome='no_response', commission='waived'
 *   - Notifies ghosting vendor they lost the lead (deterrent for next time)
 *   - Calls matchLead/matchKusumLead with prior-vendor exclusion to reassign
 *   - If no eligible vendor remains, marks lead status='unmatched_no_vendor'
 *
 * Auth: Vercel cron requests carry Authorization: Bearer <CRON_SECRET> header.
 * Falls back to MATCH_INTERNAL_TOKEN via ?token= for manual admin trigger.
 *
 * Safety caps:
 *   - Max 100 reassignments per invocation (prevents runaway loops)
 *   - Processes rooftop first, then KUSUM (rooftop is faster cycle)
 *
 * ENV VARS:
 *   SUPABASE_URL
 *   SUPABASE_SERVICE_ROLE_KEY
 *   CRON_SECRET             (Vercel sets this automatically when cron is configured)
 *   MATCH_INTERNAL_TOKEN    (manual admin trigger fallback)
 *   WHATSAPP_API_KEY
 *   WHATSAPP_PROVIDER
 *   PORTAL_BASE_URL
 *   MSG91_INTEGRATED_NUMBER (only if WHATSAPP_PROVIDER=msg91)
 */

import { matchLead } from './match-lead.js';
import { matchKusumLead } from './match-kusum-lead.js';

const MAX_REASSIGNMENTS_PER_RUN = 100;
const ROOFTOP_BATCH_SIZE = 50;
const KUSUM_BATCH_SIZE = 50;

export default async function handler(req, res) {
  // ===== Auth =====
  // Vercel Cron sends Authorization: Bearer ${CRON_SECRET}
  // Manual admin trigger can use ?token=<MATCH_INTERNAL_TOKEN>
  const authHeader = req.headers.authorization || '';
  const bearerToken = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : null;
  const queryToken = req.query.token;

  const cronSecret = process.env.CRON_SECRET;
  const internalToken = process.env.MATCH_INTERNAL_TOKEN;

  const isAuthorizedCron = cronSecret && bearerToken === cronSecret;
  const isAuthorizedManual = internalToken && (queryToken === internalToken || bearerToken === internalToken);

  if (!isAuthorizedCron && !isAuthorizedManual) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  // Vercel cron uses GET; allow both for manual testing
  if (req.method !== 'GET' && req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const runStartedAt = Date.now();
  const stats = {
    started_at: new Date(runStartedAt).toISOString(),
    rooftop: { found: 0, reassigned: 0, no_vendor: 0, errors: 0 },
    kusum: { found: 0, reassigned: 0, no_vendor: 0, errors: 0 },
    capped: false
  };

  try {
    // ===== 1. Sweep rooftop expired =====
    const rooftopResult = await sweepRooftopExpired(MAX_REASSIGNMENTS_PER_RUN);
    stats.rooftop = rooftopResult;

    const remainingBudget = MAX_REASSIGNMENTS_PER_RUN - rooftopResult.reassigned - rooftopResult.no_vendor;

    // ===== 2. Sweep KUSUM expired (with remaining budget) =====
    if (remainingBudget > 0) {
      const kusumResult = await sweepKusumExpired(remainingBudget);
      stats.kusum = kusumResult;
    } else {
      stats.capped = true;
    }

    stats.duration_ms = Date.now() - runStartedAt;
    stats.completed_at = new Date().toISOString();

    return res.status(200).json({ success: true, stats });
  } catch (err) {
    console.error('[reassign-expired-leads] FATAL:', err);
    stats.error = err.message;
    stats.duration_ms = Date.now() - runStartedAt;
    return res.status(500).json({ success: false, stats });
  }
}

// ============================================================
// ROOFTOP SWEEP
// ============================================================
async function sweepRooftopExpired(budget) {
  const result = { found: 0, reassigned: 0, no_vendor: 0, errors: 0, details: [] };
  const supabaseUrl = process.env.SUPABASE_URL;
  const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const headers = { 'apikey': supabaseKey, 'Authorization': `Bearer ${supabaseKey}` };

  const now = new Date().toISOString();

  // Find expired rooftop assignments
  // Pull both assignment + lead in single query via PostgREST embed
  const expiredUrl = `${supabaseUrl}/rest/v1/lead_assignments?` +
    `outcome=eq.pending&` +
    `expires_at=lt.${now}&` +
    `select=id,lead_id,vendor_id,expires_at,assigned_at,vendors:vendor_id(id,company_name,phone)&` +
    `order=expires_at.asc&` +
    `limit=${Math.min(budget, ROOFTOP_BATCH_SIZE)}`;

  const expiredRes = await fetch(expiredUrl, { headers });
  if (!expiredRes.ok) {
    const err = await expiredRes.text();
    console.error('[sweepRooftop] fetch failed:', err);
    result.errors++;
    return result;
  }

  const expired = await expiredRes.json();
  result.found = expired.length;

  for (const assignment of expired) {
    if (result.reassigned + result.no_vendor >= budget) break;

    try {
      // Step 1: Mark expired assignment as no_response, waive commission
      await fetch(`${supabaseUrl}/rest/v1/lead_assignments?id=eq.${assignment.id}`, {
        method: 'PATCH',
        headers: { ...headers, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          outcome: 'no_response',
          outcome_updated_at: new Date().toISOString(),
          commission_status: 'waived'
        })
      });

      // Step 2: Notify ghosting vendor (best-effort, fire-and-forget)
      const ghostingVendor = assignment.vendors;
      if (ghostingVendor && ghostingVendor.phone) {
        notifyGhostingVendor({
          vendor: ghostingVendor,
          assignmentId: assignment.id,
          leadType: 'rooftop'
        }).catch(e => console.error('[ghost notify rooftop]', e.message));
      }

      // Step 3: Get list of all prior vendors for this lead (exclude on reassignment)
      const priorsRes = await fetch(
        `${supabaseUrl}/rest/v1/lead_assignments?lead_id=eq.${assignment.lead_id}&select=vendor_id`,
        { headers }
      );
      const priors = await priorsRes.json();
      const excludeVendorIds = [...new Set(priors.map(p => p.vendor_id))];

      // Step 4: Call matchLead with exclusion → reassigns + notifies new vendor
      const matchResult = await matchLead(assignment.lead_id, excludeVendorIds);

      if (matchResult.matched) {
        result.reassigned++;
        result.details.push({
          lead_id: assignment.lead_id,
          old_vendor: ghostingVendor?.company_name || assignment.vendor_id,
          new_vendor: matchResult.vendorName,
          reassign_count: excludeVendorIds.length
        });
      } else {
        // No eligible vendor remains — mark lead as unmatched
        await fetch(`${supabaseUrl}/rest/v1/leads?id=eq.${assignment.lead_id}`, {
          method: 'PATCH',
          headers: { ...headers, 'Content-Type': 'application/json' },
          body: JSON.stringify({ status: 'unmatched_no_vendor' })
        });
        result.no_vendor++;
        result.details.push({
          lead_id: assignment.lead_id,
          old_vendor: ghostingVendor?.company_name || assignment.vendor_id,
          new_vendor: null,
          reason: matchResult.reason,
          excluded_count: excludeVendorIds.length
        });
      }
    } catch (e) {
      console.error('[sweepRooftop] assignment error:', assignment.id, e.message);
      result.errors++;
    }
  }

  return result;
}

// ============================================================
// KUSUM SWEEP
// ============================================================
async function sweepKusumExpired(budget) {
  const result = { found: 0, reassigned: 0, no_vendor: 0, errors: 0, details: [] };
  const supabaseUrl = process.env.SUPABASE_URL;
  const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const headers = { 'apikey': supabaseKey, 'Authorization': `Bearer ${supabaseKey}` };

  const now = new Date().toISOString();

  // Find expired KUSUM assignments (48hr SLA vs rooftop's 24hr — expires_at already set correctly)
  const expiredUrl = `${supabaseUrl}/rest/v1/kusum_lead_assignments?` +
    `outcome=eq.pending&` +
    `expires_at=lt.${now}&` +
    `select=id,kusum_lead_id,vendor_id,expires_at,assigned_at,component,vendors:vendor_id(id,company_name,phone)&` +
    `order=expires_at.asc&` +
    `limit=${Math.min(budget, KUSUM_BATCH_SIZE)}`;

  const expiredRes = await fetch(expiredUrl, { headers });
  if (!expiredRes.ok) {
    const err = await expiredRes.text();
    console.error('[sweepKusum] fetch failed:', err);
    result.errors++;
    return result;
  }

  const expired = await expiredRes.json();
  result.found = expired.length;

  for (const assignment of expired) {
    if (result.reassigned + result.no_vendor >= budget) break;

    try {
      // Step 1: Mark expired KUSUM assignment as no_response, waive commission
      await fetch(`${supabaseUrl}/rest/v1/kusum_lead_assignments?id=eq.${assignment.id}`, {
        method: 'PATCH',
        headers: { ...headers, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          outcome: 'no_response',
          outcome_updated_at: new Date().toISOString(),
          commission_status: 'waived'
        })
      });

      // Step 2: Notify ghosting vendor
      const ghostingVendor = assignment.vendors;
      if (ghostingVendor && ghostingVendor.phone) {
        notifyGhostingVendor({
          vendor: ghostingVendor,
          assignmentId: assignment.id,
          leadType: 'kusum',
          component: assignment.component
        }).catch(e => console.error('[ghost notify kusum]', e.message));
      }

      // Step 3: Get all prior KUSUM vendors for exclusion
      const priorsRes = await fetch(
        `${supabaseUrl}/rest/v1/kusum_lead_assignments?kusum_lead_id=eq.${assignment.kusum_lead_id}&select=vendor_id`,
        { headers }
      );
      const priors = await priorsRes.json();
      const excludeVendorIds = [...new Set(priors.map(p => p.vendor_id))];

      // Step 4: Call matchKusumLead with exclusion
      const matchResult = await matchKusumLead(assignment.kusum_lead_id, excludeVendorIds);

      if (matchResult.matched) {
        result.reassigned++;
        result.details.push({
          kusum_lead_id: assignment.kusum_lead_id,
          component: assignment.component,
          old_vendor: ghostingVendor?.company_name || assignment.vendor_id,
          new_vendor: matchResult.vendorName,
          reassign_count: excludeVendorIds.length
        });
      } else {
        // No eligible KUSUM specialist remains — mark lead as documents_pending
        // (KUSUM-specific status — admin will manually broker)
        await fetch(`${supabaseUrl}/rest/v1/kusum_leads?id=eq.${assignment.kusum_lead_id}`, {
          method: 'PATCH',
          headers: { ...headers, 'Content-Type': 'application/json' },
          body: JSON.stringify({ status: 'documents_pending' })
        });
        result.no_vendor++;
        result.details.push({
          kusum_lead_id: assignment.kusum_lead_id,
          component: assignment.component,
          old_vendor: ghostingVendor?.company_name || assignment.vendor_id,
          new_vendor: null,
          reason: matchResult.reason,
          excluded_count: excludeVendorIds.length
        });
      }
    } catch (e) {
      console.error('[sweepKusum] assignment error:', assignment.id, e.message);
      result.errors++;
    }
  }

  return result;
}

// ============================================================
// NOTIFY GHOSTING VENDOR — sent when their lead expires
// Deterrent for next time + opportunity for vendor to explain
// ============================================================
async function notifyGhostingVendor({ vendor, assignmentId, leadType, component }) {
  const provider = process.env.WHATSAPP_PROVIDER || 'webhook';
  const apiKey = process.env.WHATSAPP_API_KEY;
  if (!apiKey) return;

  const portalUrl = process.env.PORTAL_BASE_URL || 'https://solarsubsidies.com';
  const leadLabel = leadType === 'kusum'
    ? `KUSUM lead${component ? ` (Component ${component})` : ''}`
    : 'rooftop lead';
  const slaHours = leadType === 'kusum' ? 48 : 24;

  const message = `⏰ Lead expired without response

The ${leadLabel} we assigned you ${slaHours}h ago did not get claimed in time and has been reassigned to another vendor.

Lead ID: ${assignmentId.slice(0, 8).toUpperCase()}

Repeated expiries lower your tier and reduce future lead flow. If you have a reason this happened (capacity, holiday, technical issue), reply here.

Portal: ${portalUrl}/vendors/portal.html`;

  try {
    switch (provider) {
      case 'aisensy':
        return await fetch('https://backend.aisensy.com/campaign/t1/api/v2', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            apiKey,
            campaignName: 'vendor_lead_expired',
            destination: vendor.phone,
            userName: vendor.company_name || 'Vendor',
            templateParams: [message]
          })
        });
      case 'interakt':
        return await fetch('https://api.interakt.ai/v1/public/message/', {
          method: 'POST',
          headers: { 'Authorization': `Basic ${apiKey}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({
            countryCode: '+91',
            phoneNumber: vendor.phone.replace('+91', ''),
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
              to: [vendor.phone],
              type: 'template',
              template: { name: 'lead_expired', body_text: [message] }
            }
          })
        });
      default:
        if (apiKey.startsWith('http')) {
          return await fetch(apiKey, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ to: vendor.phone, message })
          });
        }
    }
  } catch (e) {
    console.error('Ghost notify error:', e);
  }
}
