-- Migration 0009: v0.8 KUSUM eligibility + lead routing
-- Run in Supabase SQL Editor after deploying KUSUM flow

-- =========================================
-- KUSUM-specific lead table
-- (Separate from rooftop leads because qualifying data is fundamentally different)
-- =========================================

CREATE TABLE IF NOT EXISTS kusum_leads (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  
  -- Customer details
  name TEXT NOT NULL,
  phone TEXT NOT NULL,
  email TEXT,
  district_slug TEXT,
  village_or_tehsil TEXT,
  consent_whatsapp BOOLEAN DEFAULT FALSE,
  
  -- Eligibility answers
  applicant_type TEXT CHECK (applicant_type IN ('individual_farmer', 'fpo', 'panchayat', 'cooperative_society', 'water_user_association', 'tenant_farmer')),
  land_owned BOOLEAN,
  land_area_acres NUMERIC(6, 2),
  land_type TEXT CHECK (land_type IN ('cultivated', 'barren_uncultivable', 'fallow', 'pastoral', 'mixed')),
  
  -- Water + electricity context
  current_irrigation_source TEXT CHECK (current_irrigation_source IN ('rain_fed', 'electric_pump_grid', 'electric_pump_unreliable', 'diesel_pump', 'manual_lift', 'canal_irrigation', 'none')),
  water_source_type TEXT,  -- 'borewell' | 'open_well' | 'pond' | 'river' | 'canal' | 'none'
  water_table_depth_ft INT,
  current_electricity_bill_inr_per_month INT,
  has_existing_pump BOOLEAN,
  existing_pump_hp NUMERIC(4, 1),
  
  -- Component A specific
  distance_to_substation_km NUMERIC(4, 1),
  
  -- Crop info
  primary_crop TEXT,  -- sugarcane | paddy | wheat | vegetables | orchard | mixed
  
  -- Eligibility outcome (computed)
  eligible_components TEXT[] DEFAULT '{}',  -- {'B', 'C'} etc
  recommended_component TEXT CHECK (recommended_component IN ('A', 'B', 'C1', 'C2', 'INELIGIBLE')),
  recommended_pump_hp NUMERIC(4, 1),
  recommended_capacity_mw NUMERIC(5, 2),
  
  -- Subsidy math snapshot
  benchmark_cost_inr NUMERIC(10, 2),
  subsidy_central_inr NUMERIC(10, 2),
  subsidy_state_inr NUMERIC(10, 2),
  farmer_share_total_inr NUMERIC(10, 2),
  farmer_loan_eligible_inr NUMERIC(10, 2),
  farmer_own_funds_inr NUMERIC(10, 2),
  estimated_annual_benefit_inr NUMERIC(10, 2),  -- only meaningful for C1/A
  payback_years NUMERIC(4, 1),
  
  -- Lead scoring (different from rooftop)
  lead_score SMALLINT,
  lead_tier TEXT CHECK (lead_tier IN ('HOT', 'WARM', 'COLD')),
  priority_quota TEXT,  -- 'SC_ST' | 'WOMEN_LED' | 'FPO' | 'DROUGHT_DISTRICT' | NULL
  
  -- Status
  status TEXT DEFAULT 'new' CHECK (status IN ('new', 'assigned', 'in_progress', 'closed_won', 'closed_lost', 'ineligible', 'unmatched_no_vendor')),
  source TEXT,
  ip TEXT,
  user_agent TEXT,
  
  -- Free-form notes from customer
  notes TEXT
);

CREATE INDEX IF NOT EXISTS idx_kusum_leads_created ON kusum_leads (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_kusum_leads_status ON kusum_leads (status);
CREATE INDEX IF NOT EXISTS idx_kusum_leads_tier ON kusum_leads (lead_tier);
CREATE INDEX IF NOT EXISTS idx_kusum_leads_component ON kusum_leads (recommended_component);
CREATE INDEX IF NOT EXISTS idx_kusum_leads_district ON kusum_leads (district_slug);
CREATE INDEX IF NOT EXISTS idx_kusum_leads_phone ON kusum_leads (phone);


-- =========================================
-- KUSUM vendor specialisation
-- Extends existing vendors table with KUSUM-specific flags
-- =========================================

ALTER TABLE vendors
  ADD COLUMN IF NOT EXISTS kusum_specialist BOOLEAN DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS kusum_components_supported TEXT[] DEFAULT '{}',  -- {'A','B','C'}
  ADD COLUMN IF NOT EXISTS kusum_pump_brands TEXT[] DEFAULT '{}',           -- {'Shakti Pumps', 'KSB India', 'Lubi', 'Greaves Cotton'}
  ADD COLUMN IF NOT EXISTS kusum_max_pump_hp NUMERIC(4, 1),                 -- max HP they install
  ADD COLUMN IF NOT EXISTS kusum_borewell_capability BOOLEAN DEFAULT FALSE, -- do they handle borewell drilling
  ADD COLUMN IF NOT EXISTS kusum_vfd_certified BOOLEAN DEFAULT FALSE,       -- BIS-certified VFD integration
  ADD COLUMN IF NOT EXISTS kusum_5yr_amc_offered BOOLEAN DEFAULT FALSE;     -- 5-year comprehensive maintenance

CREATE INDEX IF NOT EXISTS idx_vendors_kusum_specialist ON vendors (kusum_specialist) WHERE kusum_specialist = TRUE;


-- =========================================
-- KUSUM lead assignments (separate from rooftop lead_assignments)
-- Different lifecycle, different SLAs, different commission structure
-- =========================================

CREATE TABLE IF NOT EXISTS kusum_lead_assignments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  
  kusum_lead_id UUID NOT NULL REFERENCES kusum_leads(id),
  vendor_id UUID NOT NULL REFERENCES vendors(id),
  
  assigned_at TIMESTAMPTZ DEFAULT NOW(),
  expires_at TIMESTAMPTZ,
  assignment_method TEXT,
  
  recommended_component TEXT,
  recommended_pump_hp NUMERIC(4, 1),
  
  vendor_responded_at TIMESTAMPTZ,
  response_time_minutes INT,
  
  -- Outcome (different stages for KUSUM vs rooftop)
  outcome TEXT DEFAULT 'pending' CHECK (outcome IN (
    'pending',
    'contacted',
    'site_visit_scheduled',
    'documents_collected',
    'application_filed',
    'subsidy_sanctioned',
    'pump_delivered',
    'installation_complete',
    'amc_active',
    'declined_by_vendor',
    'declined_by_customer',
    'ineligible_post_review',
    'document_issue',
    'no_response',
    'duplicate'
  )),
  outcome_updated_at TIMESTAMPTZ,
  
  -- Commission (different structure for KUSUM)
  benchmark_cost_inr NUMERIC(10, 2),
  commission_rate NUMERIC(4, 2),  -- typically 5-7% for KUSUM
  commission_amount NUMERIC(10, 2),
  commission_status TEXT DEFAULT 'pending' CHECK (commission_status IN ('pending', 'owed', 'invoiced', 'paid', 'disputed', 'waived')),
  commission_invoiced_at TIMESTAMPTZ,
  commission_paid_at TIMESTAMPTZ,
  installation_complete_at TIMESTAMPTZ,
  
  vendor_notes TEXT,
  declined_reason TEXT
);

CREATE INDEX IF NOT EXISTS idx_kusum_assignments_lead ON kusum_lead_assignments (kusum_lead_id);
CREATE INDEX IF NOT EXISTS idx_kusum_assignments_vendor ON kusum_lead_assignments (vendor_id);
CREATE INDEX IF NOT EXISTS idx_kusum_assignments_outcome ON kusum_lead_assignments (outcome);


-- =========================================
-- VIEW: admin_kusum_leads_overview
-- Used by admin dashboard KUSUM tab
-- =========================================

CREATE OR REPLACE VIEW admin_kusum_leads_overview AS
SELECT
  l.id AS lead_id,
  l.created_at AS lead_created_at,
  l.name AS customer_name,
  l.phone AS customer_phone,
  l.district_slug,
  l.land_area_acres,
  l.current_irrigation_source,
  l.recommended_component,
  l.recommended_pump_hp,
  l.lead_score,
  l.lead_tier,
  l.priority_quota,
  l.status AS lead_status,
  l.benchmark_cost_inr,
  l.subsidy_central_inr + l.subsidy_state_inr AS total_subsidy_inr,
  l.farmer_share_total_inr,
  l.estimated_annual_benefit_inr,
  
  la.id AS assignment_id,
  la.outcome,
  la.commission_status,
  la.commission_amount,
  
  v.company_name AS vendor_name,
  v.phone AS vendor_phone,
  
  CASE
    WHEN l.recommended_component = 'INELIGIBLE' THEN 'INELIGIBLE'
    WHEN l.status = 'unmatched_no_vendor' THEN 'UNMATCHED'
    WHEN la.id IS NULL THEN 'NEW'
    WHEN la.outcome = 'pending' THEN 'AWAITING_VENDOR'
    WHEN la.outcome IN ('declined_by_vendor', 'declined_by_customer', 'ineligible_post_review', 'no_response') THEN 'DEAD'
    WHEN la.outcome = 'installation_complete' THEN 'CLOSED_WON'
    ELSE 'IN_PROGRESS'
  END AS computed_status
FROM kusum_leads l
LEFT JOIN LATERAL (
  SELECT * FROM kusum_lead_assignments
  WHERE kusum_lead_id = l.id
  ORDER BY created_at DESC
  LIMIT 1
) la ON true
LEFT JOIN vendors v ON la.vendor_id = v.id
ORDER BY l.created_at DESC;


-- =========================================
-- VIEW: kusum_vendor_directory
-- KUSUM-specialist vendors for matching engine
-- =========================================

CREATE OR REPLACE VIEW kusum_vendor_directory AS
SELECT
  id,
  company_name,
  brand_name,
  phone,
  email,
  coverage_districts,
  kusum_components_supported,
  kusum_pump_brands,
  kusum_max_pump_hp,
  kusum_borewell_capability,
  kusum_vfd_certified,
  kusum_5yr_amc_offered,
  tier,
  commission_rate,
  active,
  CASE
    WHEN tier = 'premium' THEN 1
    WHEN tier = 'standard' THEN 2
    WHEN tier = 'probation' THEN 3
    ELSE 4
  END AS tier_sort
FROM vendors
WHERE kusum_specialist = TRUE AND active = TRUE
ORDER BY tier_sort, company_name;


-- =========================================
-- TRIGGER: Update vendor metrics on KUSUM assignment changes
-- (Mirrors the existing rooftop trigger but tracks KUSUM separately)
-- =========================================

CREATE OR REPLACE FUNCTION update_vendor_kusum_metrics()
RETURNS TRIGGER AS $$
BEGIN
  -- For now, we just log via standard performance — full KUSUM metrics deferred to v0.9
  -- This is a placeholder trigger that ensures FK integrity
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_vendor_kusum_metrics ON kusum_lead_assignments;
CREATE TRIGGER trg_vendor_kusum_metrics
  AFTER INSERT OR UPDATE ON kusum_lead_assignments
  FOR EACH ROW EXECUTE FUNCTION update_vendor_kusum_metrics();


COMMENT ON TABLE kusum_leads IS 'Separate from rooftop leads. Qualifying data is structurally different (land/water/grid context vs bill/property).';
COMMENT ON TABLE kusum_lead_assignments IS 'KUSUM has longer sales cycle than rooftop (4 months typical vs 1-2 months). Outcome stages reflect KUSUM-specific milestones.';
COMMENT ON COLUMN vendors.kusum_specialist IS 'Set TRUE only for vendors with MNRE pump empanellment + UPNEDA KUSUM-approved status. Most rooftop installers are NOT KUSUM-capable.';
