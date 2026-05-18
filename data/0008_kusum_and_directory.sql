-- Migration 0008: v0.7 KUSUM + vendor directory
-- KUSUM lead pipeline + vendor listing tier ("unverified_listing" for directory seeds)
-- Run in Supabase SQL Editor

-- =========================================
-- KUSUM LEADS TABLE
-- KUSUM is structurally different from rooftop:
--   - Component A: Land owner installs 0.5-2 MW solar plant on agri land, sells to DISCOM
--   - Component B: Off-grid solar pump (no existing connection)
--   - Component C1: Feeder Level Solarization (substation-level)
--   - Component C2: Individual Pump Solarization (existing grid-connected pump)
-- =========================================

CREATE TABLE IF NOT EXISTS kusum_leads (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  
  -- Contact
  name TEXT NOT NULL,
  phone TEXT NOT NULL,
  email TEXT,
  
  -- Location
  district_slug TEXT,
  village_or_tehsil TEXT,
  
  -- Land
  land_owned_acres NUMERIC(8, 2),
  land_ownership_proof TEXT CHECK (land_ownership_proof IN ('khasra_khatauni', 'patta', 'lease', 'none', 'unsure')),
  
  -- Existing pump situation
  pump_situation TEXT CHECK (pump_situation IN (
    'no_pump',              -- needs new pump
    'diesel_pump',          -- has diesel, wants solar replacement (Component B)
    'electric_grid_pump',   -- has grid-tied pump, wants solarization (Component C2)
    'wants_solar_plant',    -- wants to install 0.5-2 MW solar plant (Component A)
    'unsure'
  )),
  pump_hp NUMERIC(5, 2),    -- requested HP (only Components B and C)
  existing_pump_age INT,    -- years (only if has existing pump)
  
  -- Water situation (drives pump sizing recommendation)
  water_source TEXT CHECK (water_source IN ('borewell', 'open_well', 'canal', 'pond_river', 'unsure')),
  water_depth_ft INT,
  irrigation_acres NUMERIC(6, 2),
  
  -- Crops + economics
  primary_crops TEXT,        -- free text from user, may include local crop names
  current_electricity_bill_monthly INT,  -- if grid-connected
  current_diesel_spend_monthly INT,      -- if diesel-pumped
  
  -- Computed
  recommended_component TEXT CHECK (recommended_component IN ('A', 'B', 'C1', 'C2', 'ineligible', 'needs_review')),
  estimated_system_kw NUMERIC(6, 2),
  estimated_gross_cost INT,
  estimated_subsidy_central INT,
  estimated_subsidy_state INT,
  estimated_farmer_contribution INT,
  estimated_loan_eligible INT,
  estimated_payback_years NUMERIC(4, 1),
  estimated_diesel_savings_annual INT,
  
  -- Lead scoring (specific to KUSUM logic)
  kusum_lead_score SMALLINT,
  kusum_lead_tier TEXT CHECK (kusum_lead_tier IN ('HOT', 'WARM', 'COLD')),
  
  -- Status
  status TEXT DEFAULT 'new' CHECK (status IN (
    'new', 'eligibility_passed', 'eligibility_failed', 'documents_pending',
    'assigned', 'site_visit_scheduled', 'application_submitted', 
    'sanctioned', 'installed', 'commissioned', 'dropped'
  )),
  
  -- Consent + tracking
  consent_whatsapp BOOLEAN DEFAULT FALSE,
  consent_aadhaar_data BOOLEAN DEFAULT FALSE,
  calculator_snapshot JSONB,
  source TEXT,
  ip TEXT,
  user_agent TEXT
);

CREATE INDEX IF NOT EXISTS idx_kusum_leads_district ON kusum_leads (district_slug);
CREATE INDEX IF NOT EXISTS idx_kusum_leads_component ON kusum_leads (recommended_component);
CREATE INDEX IF NOT EXISTS idx_kusum_leads_tier ON kusum_leads (kusum_lead_tier);
CREATE INDEX IF NOT EXISTS idx_kusum_leads_created ON kusum_leads (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_kusum_leads_status ON kusum_leads (status);


-- =========================================
-- VENDOR LISTING TIER (extends existing vendors table)
-- Adds 'unverified_listing' tier for directory seeds — vendors who appear
-- in the public directory but haven't been onboarded yet
-- =========================================

ALTER TABLE vendors 
  DROP CONSTRAINT IF EXISTS vendors_tier_check;

ALTER TABLE vendors 
  ADD CONSTRAINT vendors_tier_check 
    CHECK (tier IN ('probation', 'standard', 'premium', 'suspended', 'unverified_listing'));

ALTER TABLE vendors
  ADD COLUMN IF NOT EXISTS slug TEXT UNIQUE,
  ADD COLUMN IF NOT EXISTS public_listing BOOLEAN DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS handles_kusum BOOLEAN DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS kusum_components TEXT[] DEFAULT '{}',  -- which Components: A, B, C1, C2
  ADD COLUMN IF NOT EXISTS listing_description TEXT,
  ADD COLUMN IF NOT EXISTS specialties TEXT[],
  ADD COLUMN IF NOT EXISTS established_year INT,
  ADD COLUMN IF NOT EXISTS team_size_label TEXT,
  ADD COLUMN IF NOT EXISTS claim_status TEXT DEFAULT 'unclaimed' 
    CHECK (claim_status IN ('unclaimed', 'claim_pending', 'claimed', 'verified'));

CREATE UNIQUE INDEX IF NOT EXISTS idx_vendors_slug ON vendors (slug) WHERE slug IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_vendors_public ON vendors (public_listing) WHERE public_listing = TRUE;
CREATE INDEX IF NOT EXISTS idx_vendors_kusum ON vendors (handles_kusum) WHERE handles_kusum = TRUE;


-- =========================================
-- KUSUM-SPECIFIC VENDOR ASSIGNMENTS
-- KUSUM has different commission economics and longer cycles
-- =========================================

CREATE TABLE IF NOT EXISTS kusum_lead_assignments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  
  kusum_lead_id UUID NOT NULL REFERENCES kusum_leads(id),
  vendor_id UUID NOT NULL REFERENCES vendors(id),
  
  assigned_at TIMESTAMPTZ DEFAULT NOW(),
  expires_at TIMESTAMPTZ,
  
  component TEXT,  -- A | B | C1 | C2
  estimated_system_kw NUMERIC(6, 2),
  estimated_commission INT,
  commission_rate NUMERIC(4, 2),  -- KUSUM typically 4-5% (lower than rooftop due to longer cycle)
  
  -- Outcome
  outcome TEXT DEFAULT 'pending' CHECK (outcome IN (
    'pending', 'contacted', 'site_survey_done', 'application_submitted',
    'sanctioned', 'installation_complete', 'commissioned',
    'declined_by_vendor', 'declined_by_farmer', 'rejected_by_upneda', 'no_response'
  )),
  outcome_updated_at TIMESTAMPTZ,
  
  -- Commission tracking
  commission_status TEXT DEFAULT 'pending' CHECK (commission_status IN (
    'pending', 'owed', 'invoiced', 'paid', 'disputed', 'waived'
  )),
  commission_amount NUMERIC(10, 2),
  commission_paid_at TIMESTAMPTZ,
  
  notes TEXT
);

CREATE INDEX IF NOT EXISTS idx_kusum_assignments_lead ON kusum_lead_assignments (kusum_lead_id);
CREATE INDEX IF NOT EXISTS idx_kusum_assignments_vendor ON kusum_lead_assignments (vendor_id);
CREATE INDEX IF NOT EXISTS idx_kusum_assignments_outcome ON kusum_lead_assignments (outcome);


-- =========================================
-- VIEW: kusum_dashboard
-- For admin to see KUSUM lead pipeline
-- =========================================

CREATE OR REPLACE VIEW kusum_dashboard AS
SELECT
  kl.id AS kusum_lead_id,
  kl.created_at,
  kl.name,
  kl.phone,
  kl.district_slug,
  kl.recommended_component,
  kl.estimated_system_kw,
  kl.estimated_farmer_contribution,
  kl.kusum_lead_tier,
  kl.kusum_lead_score,
  kl.status,
  kl.pump_situation,
  kl.land_owned_acres,
  kl.irrigation_acres,
  kla.id AS assignment_id,
  kla.vendor_id,
  v.company_name AS vendor_name,
  kla.outcome,
  kla.commission_status,
  kla.commission_amount
FROM kusum_leads kl
LEFT JOIN LATERAL (
  SELECT * FROM kusum_lead_assignments
  WHERE kusum_lead_id = kl.id
  ORDER BY created_at DESC
  LIMIT 1
) kla ON true
LEFT JOIN vendors v ON kla.vendor_id = v.id
ORDER BY kl.created_at DESC;


-- =========================================
-- VIEW: public_vendor_directory
-- For /vendors/directory.html — only vendors with public_listing=TRUE
-- =========================================

CREATE OR REPLACE VIEW public_vendor_directory AS
SELECT
  id,
  slug,
  company_name,
  brand_name,
  hq,
  coverage_districts,
  array_length(coverage_districts, 1) AS district_count,
  tier,
  claim_status,
  handles_kusum,
  kusum_components,
  listing_description,
  specialties,
  established_year,
  team_size_label,
  website,
  leads_closed,
  CASE 
    WHEN leads_received > 0 THEN ROUND((leads_closed::numeric / leads_received) * 100, 1)
    ELSE NULL 
  END AS close_rate_pct,
  CASE
    WHEN tier = 'premium' THEN 1
    WHEN tier = 'standard' THEN 2
    WHEN tier = 'probation' THEN 3
    WHEN tier = 'unverified_listing' AND claim_status = 'claimed' THEN 4
    ELSE 5
  END AS sort_priority
FROM vendors
WHERE public_listing = TRUE
ORDER BY sort_priority, leads_closed DESC NULLS LAST;


COMMENT ON TABLE kusum_leads IS 'PM-KUSUM leads (solar pumps + agri solar plants). Separate from rooftop leads table due to different subsidy math, lead score logic, and commission structure.';
COMMENT ON TABLE kusum_lead_assignments IS 'KUSUM lead-vendor pairings. Longer cycle than rooftop (UPNEDA sanction can take 60-120 days).';
COMMENT ON COLUMN vendors.tier IS 'probation | standard | premium | suspended | unverified_listing (directory seed, not yet onboarded)';
COMMENT ON COLUMN vendors.claim_status IS 'unclaimed (directory seed) → claim_pending (someone said they own this) → claimed → verified';
COMMENT ON VIEW public_vendor_directory IS 'Public-facing vendor directory. Only shows vendors with public_listing=TRUE.';
