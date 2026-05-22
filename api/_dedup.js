/**
 * /api/_dedup.js — Shared lead deduplication helper (v0.9.3)
 *
 * Prevents the same phone from generating duplicate vendor assignments,
 * duplicate vendor WhatsApps, and duplicate commission obligations on what
 * is really one deal.
 *
 * STRATEGY (soft dedup):
 *   - The new lead row is STILL written (preserves the record + lets us see
 *     what changed on re-submission), but flagged status='duplicate' and
 *     linked to the original via duplicate_of.
 *   - The caller skips vendor auto-matching + the vendor-facing WhatsApp when
 *     a duplicate is detected, because the original lead already has (or will
 *     get) an active assignment.
 *   - The customer/farmer still gets their confirmation WhatsApp (they don't
 *     know or care that it's a dup; we don't want to look broken to them).
 *
 * DEDUP KEY: normalized E.164 phone.
 *
 * DEDUP WINDOW: not purely time-based. A prior lead counts as an active
 *   duplicate if it has an OPEN status (not a dead/lost/closed terminal state).
 *   This correctly handles the 90-120 day KUSUM cycle AND the rooftop
 *   "comparing quotes for 2 weeks" case, while still allowing a genuinely new
 *   submission once the prior one is dead.
 *
 * There is also a hard time ceiling (DEDUP_MAX_AGE_DAYS): a prior lead older
 *   than the ceiling never blocks a new one, even if its status was never
 *   advanced to a terminal state (protects against stuck/abandoned leads
 *   permanently shadowing a real new inquiry).
 */

// Statuses that count as "still in play" — a new submission with the same
// phone while one of these is active is a duplicate.
const ROOFTOP_ACTIVE_STATUSES = ['new', 'assigned'];
const KUSUM_ACTIVE_STATUSES = [
  'new', 'eligibility_passed', 'documents_pending', 'assigned',
  'site_visit_scheduled', 'application_submitted', 'sanctioned'
];

// A prior lead older than this never blocks a new one (days).
const DEDUP_MAX_AGE_DAYS = 45;       // rooftop
const KUSUM_DEDUP_MAX_AGE_DAYS = 150; // KUSUM (longer cycle)

/**
 * Check for an existing active lead with the same phone.
 *
 * @param {string} table          'leads' | 'kusum_leads'
 * @param {string} normalizedPhone E.164 phone
 * @returns {Promise<{isDuplicate: boolean, originalLeadId: string|null, originalStatus: string|null, originalAgeHours: number|null}>}
 */
export async function checkDuplicateLead(table, normalizedPhone) {
  const supabaseUrl = process.env.SUPABASE_URL;
  const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  // If Supabase isn't configured we can't dedup — treat as not-duplicate so
  // the prototype still functions.
  if (!supabaseUrl || !supabaseKey || !normalizedPhone) {
    return { isDuplicate: false, originalLeadId: null, originalStatus: null, originalAgeHours: null };
  }

  const isKusum = table === 'kusum_leads';
  const activeStatuses = isKusum ? KUSUM_ACTIVE_STATUSES : ROOFTOP_ACTIVE_STATUSES;
  const maxAgeDays = isKusum ? KUSUM_DEDUP_MAX_AGE_DAYS : DEDUP_MAX_AGE_DAYS;
  const cutoff = new Date(Date.now() - maxAgeDays * 24 * 60 * 60 * 1000).toISOString();

  // Look for the most recent lead from this phone that is BOTH within the age
  // ceiling AND in an active status. Exclude rows already flagged duplicate.
  const statusFilter = `status=in.(${activeStatuses.join(',')})`;
  const url = `${supabaseUrl}/rest/v1/${table}?` +
    `phone=eq.${encodeURIComponent(normalizedPhone)}&` +
    `${statusFilter}&` +
    `created_at=gte.${cutoff}&` +
    `select=id,status,created_at&` +
    `order=created_at.desc&limit=1`;

  try {
    const resp = await fetch(url, {
      headers: { 'apikey': supabaseKey, 'Authorization': `Bearer ${supabaseKey}` }
    });
    if (!resp.ok) {
      console.error('[dedup] lookup failed:', await resp.text());
      // Fail open — don't block a real lead because the dedup check errored.
      return { isDuplicate: false, originalLeadId: null, originalStatus: null, originalAgeHours: null };
    }
    const rows = await resp.json();
    if (!rows || rows.length === 0) {
      return { isDuplicate: false, originalLeadId: null, originalStatus: null, originalAgeHours: null };
    }
    const original = rows[0];
    const ageHours = Math.round((Date.now() - new Date(original.created_at).getTime()) / (1000 * 60 * 60));
    return {
      isDuplicate: true,
      originalLeadId: original.id,
      originalStatus: original.status,
      originalAgeHours: ageHours
    };
  } catch (e) {
    console.error('[dedup] lookup exception:', e.message);
    return { isDuplicate: false, originalLeadId: null, originalStatus: null, originalAgeHours: null };
  }
}

/**
 * Returns the extra fields to merge into a lead's insert body when it's a
 * detected duplicate. Keeps the row (for the audit trail) but marks it so it
 * never gets auto-matched and is visually distinct in the admin dashboard.
 *
 * NOTE: 'duplicate' must be a permitted value in the table's status CHECK
 * constraint. Both leads.status and kusum_leads.status include 'duplicate'
 * after migration 0012.
 *
 * @param {string} originalLeadId
 * @returns {object}
 */
export function duplicateLeadFields(originalLeadId) {
  return {
    status: 'duplicate',
    duplicate_of: originalLeadId
  };
}
