-- Migration 0011: v0.9.2 vendor_applications KUSUM self-declaration columns
-- Run in Supabase SQL Editor AFTER 0005 and 0008.
--
-- WHY THIS EXISTS:
-- api/vendor-apply.js v0.9.2 writes KUSUM self-declaration fields when an
-- applicant ticks "Yes, we handle KUSUM" on /vendors/apply.html Step 4.
-- Migration 0005 created vendor_applications WITHOUT these columns, and 0008
-- only added KUSUM columns to the `vendors` table (not vendor_applications).
-- Without this migration, any KUSUM-declaring application INSERT fails with
-- "column does not exist" and the whole application silently drops.
--
-- These are SELF-DECLARED at apply time. Admin must verify MNRE pump
-- empanellment + UPNEDA KUSUM ID before promoting to vendors.handles_kusum=true.

ALTER TABLE vendor_applications
  ADD COLUMN IF NOT EXISTS handles_kusum_declared BOOLEAN DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS kusum_components_declared TEXT[] DEFAULT '{}',  -- subset of {A, B, C1, C2}
  ADD COLUMN IF NOT EXISTS mnre_pump_empanellment_number TEXT,            -- pump-specific MNRE (≠ rooftop mnre_number); required for B/C1
  ADD COLUMN IF NOT EXISTS upneda_kusum_id TEXT,                          -- UPNEDA KUSUM vendor ID (≠ upneda_number)
  ADD COLUMN IF NOT EXISTS kusum_years_active TEXT,
  ADD COLUMN IF NOT EXISTS kusum_installs_completed TEXT,
  ADD COLUMN IF NOT EXISTS kusum_pump_brands TEXT[] DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS kusum_admin_verified BOOLEAN DEFAULT FALSE;    -- flips true only after manual MNRE pump + UPNEDA KUSUM check

-- Index to let admin filter the review queue down to KUSUM applicants needing verification
CREATE INDEX IF NOT EXISTS idx_vendor_apps_kusum_declared
  ON vendor_applications (handles_kusum_declared)
  WHERE handles_kusum_declared = TRUE;

CREATE INDEX IF NOT EXISTS idx_vendor_apps_kusum_unverified
  ON vendor_applications (kusum_admin_verified)
  WHERE handles_kusum_declared = TRUE AND kusum_admin_verified = FALSE;

COMMENT ON COLUMN vendor_applications.handles_kusum_declared IS 'Self-declared KUSUM specialization at apply time. NOT verified — see kusum_admin_verified.';
COMMENT ON COLUMN vendor_applications.mnre_pump_empanellment_number IS 'Pump-specific MNRE empanellment, distinct from rooftop mnre_number. Required for Components B and C1.';
COMMENT ON COLUMN vendor_applications.upneda_kusum_id IS 'UPNEDA KUSUM vendor ID, distinct from rooftop upneda_number. Required for any KUSUM declaration.';
COMMENT ON COLUMN vendor_applications.kusum_admin_verified IS 'Manual verification gate. Admin checks MNRE pump + UPNEDA KUSUM before promoting vendor to handles_kusum=true.';


-- =========================================
-- VIEW: pending_kusum_verifications
-- Admin queue: KUSUM applicants whose pump/UPNEDA credentials need verifying
-- =========================================

CREATE OR REPLACE VIEW pending_kusum_verifications AS
SELECT
  id,
  created_at,
  company_name,
  brand_name,
  contact_name,
  phone,
  email,
  hq,
  kusum_components_declared,
  mnre_pump_empanellment_number,
  upneda_kusum_id,
  kusum_years_active,
  kusum_installs_completed,
  kusum_pump_brands,
  status AS application_status,
  kusum_admin_verified,
  auto_flags->'kusumPriorityReasons' AS kusum_priority_reasons
FROM vendor_applications
WHERE handles_kusum_declared = TRUE
  AND kusum_admin_verified = FALSE
  AND status IN ('pending_review', 'under_review', 'approved')
ORDER BY
  (auto_flags->>'kusumPriorityReview')::boolean DESC NULLS LAST,
  created_at ASC;

COMMENT ON VIEW pending_kusum_verifications IS 'Admin queue of KUSUM-declaring applications awaiting MNRE pump + UPNEDA KUSUM verification.';
