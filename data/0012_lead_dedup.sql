-- Migration 0012: v0.9.3 lead deduplication support
-- Run in Supabase SQL Editor AFTER 0004, 0008, 0011.
--
-- WHY THIS EXISTS:
-- api/_dedup.js (used by api/lead.js + api/kusum-lead.js) writes status='duplicate'
-- and duplicate_of=<original lead id> when the same phone re-submits while an
-- earlier lead is still active. This migration:
--   1. Adds the duplicate_of self-referencing FK column to both lead tables.
--   2. Rebuilds the status CHECK constraints to include 'duplicate' (and aligns
--      them with every status value the current API code actually writes — the
--      original schema.sql constraints predate 'assigned', 'unmatched_no_vendor',
--      and 'duplicate', so we recreate them defensively).
--   3. Adds a partial UNIQUE index as a DB-level race guard: at most one ACTIVE
--      lead per phone. This backstops the app-level check against double-tap /
--      retry races that both pass the app check before either inserts.
--
-- The constraint rebuilds use DROP ... IF EXISTS then ADD, so they are safe to
-- run regardless of which base schema (legacy schema.sql vs migrations) is live.

-- =========================================
-- 1. duplicate_of columns
-- =========================================
ALTER TABLE leads
  ADD COLUMN IF NOT EXISTS duplicate_of UUID REFERENCES leads(id);

ALTER TABLE kusum_leads
  ADD COLUMN IF NOT EXISTS duplicate_of UUID REFERENCES kusum_leads(id);

CREATE INDEX IF NOT EXISTS idx_leads_duplicate_of ON leads (duplicate_of) WHERE duplicate_of IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_kusum_leads_duplicate_of ON kusum_leads (duplicate_of) WHERE duplicate_of IS NOT NULL;


-- =========================================
-- 2. Rebuild status CHECK constraints to include 'duplicate'
-- =========================================

-- leads.status — full set the API writes across its lifecycle:
--   new → assigned → (vendor outcomes tracked on lead_assignments, not here)
--   unmatched_no_vendor (set by matcher when no eligible vendor)
--   duplicate (set by dedup)
-- We keep the legacy values too (matched/contacted/quoted/won/lost/invalid) so
-- this works whether the base table came from schema.sql or the migrations.
ALTER TABLE leads DROP CONSTRAINT IF EXISTS leads_status_check;
ALTER TABLE leads ADD CONSTRAINT leads_status_check
  CHECK (status IS NULL OR status IN (
    'new',
    'assigned',
    'unmatched_no_vendor',
    'duplicate',
    -- legacy values (harmless to keep permitted)
    'matched', 'contacted', 'quoted', 'won', 'lost', 'invalid'
  ));

-- kusum_leads.status — extend the 0008 enum with 'duplicate'
ALTER TABLE kusum_leads DROP CONSTRAINT IF EXISTS kusum_leads_status_check;
ALTER TABLE kusum_leads ADD CONSTRAINT kusum_leads_status_check
  CHECK (status IS NULL OR status IN (
    'new', 'eligibility_passed', 'eligibility_failed', 'documents_pending',
    'assigned', 'site_visit_scheduled', 'application_submitted',
    'sanctioned', 'installed', 'commissioned', 'dropped',
    'duplicate'
  ));


-- =========================================
-- 3. Partial UNIQUE index — DB-level race guard
-- At most ONE active (non-terminal, non-duplicate) lead per phone.
-- This is the backstop the app-level check can't provide against two
-- simultaneous inserts. The active-status sets mirror api/_dedup.js.
-- =========================================

-- Rooftop: active = new | assigned
CREATE UNIQUE INDEX IF NOT EXISTS uniq_active_lead_per_phone
  ON leads (phone)
  WHERE status IN ('new', 'assigned');

-- KUSUM: active = new | eligibility_passed | documents_pending | assigned
--        | site_visit_scheduled | application_submitted | sanctioned
CREATE UNIQUE INDEX IF NOT EXISTS uniq_active_kusum_lead_per_phone
  ON kusum_leads (phone)
  WHERE status IN (
    'new', 'eligibility_passed', 'documents_pending', 'assigned',
    'site_visit_scheduled', 'application_submitted', 'sanctioned'
  );

-- NOTE: If the unique index insert fails on a race, the API's insert will get a
-- 409-style error and leadId stays null. The customer still receives their
-- confirmation WhatsApp (sent independent of the DB write), and the original
-- lead's assignment is unaffected. The losing row simply isn't persisted — which
-- is the correct outcome for a true simultaneous duplicate.

COMMENT ON COLUMN leads.duplicate_of IS 'If set, this lead is a re-submission of the referenced original lead. Set by api/_dedup.js. Not auto-matched.';
COMMENT ON COLUMN kusum_leads.duplicate_of IS 'If set, this KUSUM lead is a re-submission of the referenced original. Set by api/_dedup.js. Not auto-routed.';
COMMENT ON INDEX uniq_active_lead_per_phone IS 'Race guard: at most one active rooftop lead per phone. Backstops app-level dedup in api/_dedup.js.';
COMMENT ON INDEX uniq_active_kusum_lead_per_phone IS 'Race guard: at most one active KUSUM lead per phone. Backstops app-level dedup in api/_dedup.js.';
