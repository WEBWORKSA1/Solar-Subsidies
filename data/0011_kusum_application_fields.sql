-- Migration 0011: v0.9.2 KUSUM application self-declaration fields
-- Adds KUSUM-related columns to vendor_applications so applicants can
-- self-declare KUSUM specialization at apply time, then admin verifies
-- before promoting to vendors table with handles_kusum=true.
-- Run in Supabase SQL Editor after 0010_preferred_vendor.sql.

-- =========================================
-- vendor_applications: KUSUM self-declaration fields
-- =========================================

ALTER TABLE vendor_applications
  ADD COLUMN IF NOT EXISTS handles_kusum_declared BOOLEAN DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS kusum_components_declared TEXT[] DEFAULT '{}',  -- A, B, C1, C2
  ADD COLUMN IF NOT EXISTS mnre_pump_empanellment_number TEXT,             -- MNRE pump-specific empanellment (separate from rooftop MNRE)
  ADD COLUMN IF NOT EXISTS upneda_kusum_id TEXT,                            -- UPNEDA KUSUM-specific vendor ID (separate from rooftop UPNEDA)
  ADD COLUMN IF NOT EXISTS kusum_installs_completed TEXT,                   -- count band: '0', '1-10', '11-50', '51-200', '>200'
  ADD COLUMN IF NOT EXISTS kusum_years_active TEXT,                         -- '<1', '1-2', '3-5', '5+'
  ADD COLUMN IF NOT EXISTS kusum_pump_brands TEXT[] DEFAULT '{}',           -- e.g. ['Shakti', 'CRI', 'Lubi', 'Texmo']
  ADD COLUMN IF NOT EXISTS kusum_admin_verified BOOLEAN DEFAULT FALSE,      -- admin manually verified MNRE pump + UPNEDA KUSUM
  ADD COLUMN IF NOT EXISTS kusum_verified_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS kusum_verified_by TEXT;

-- Constraint: if handles_kusum_declared=true, at least one component must be specified
-- (enforced in application code; SQL CHECK would be expensive across all components)

CREATE INDEX IF NOT EXISTS idx_vendor_apps_kusum_declared
  ON vendor_applications (handles_kusum_declared)
  WHERE handles_kusum_declared = TRUE;

CREATE INDEX IF NOT EXISTS idx_vendor_apps_kusum_verified
  ON vendor_applications (kusum_admin_verified)
  WHERE kusum_admin_verified = TRUE;


-- =========================================
-- VIEW: pending_kusum_applications
-- For admin to see KUSUM-declared apps that need MNRE pump + UPNEDA KUSUM verification
-- =========================================

CREATE OR REPLACE VIEW pending_kusum_applications AS
SELECT
  id,
  created_at,
  company_name,
  brand_name,
  contact_name,
  phone,
  email,
  hq,
  mnre_number,
  mnre_pump_empanellment_number,
  upneda_number,
  upneda_kusum_id,
  kusum_components_declared,
  array_length(kusum_components_declared, 1) AS component_count,
  kusum_installs_completed,
  kusum_years_active,
  kusum_pump_brands,
  coverage_districts,
  array_length(coverage_districts, 1) AS district_count,
  status,
  kusum_admin_verified,
  auto_flags
FROM vendor_applications
WHERE handles_kusum_declared = TRUE
  AND kusum_admin_verified = FALSE
  AND status IN ('pending_review', 'under_review')
ORDER BY
  (auto_flags->>'priorityReview')::boolean DESC NULLS LAST,
  created_at ASC;


COMMENT ON COLUMN vendor_applications.handles_kusum_declared IS
  'Applicant self-declared they handle KUSUM (Components A/B/C1/C2). Must be verified by admin before vendors.handles_kusum gets set to true on promotion.';
COMMENT ON COLUMN vendor_applications.kusum_admin_verified IS
  'Admin has verified MNRE pump empanellment + UPNEDA KUSUM vendor ID. Required before approving as KUSUM specialist.';
COMMENT ON VIEW pending_kusum_applications IS
  'Subset of vendor_applications that self-declared KUSUM but await admin verification of MNRE pump + UPNEDA KUSUM credentials.';
