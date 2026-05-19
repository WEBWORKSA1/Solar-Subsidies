-- Migration 0008: v0.7 KUSUM scheme + vendor directory + vendor profile enhancements
-- Run in Supabase SQL Editor after deploying KUSUM flow + vendor directory

-- =========================================
-- TABLE: kusum_leads
-- Separate from rooftop leads — different qualification criteria
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
  
  -- Land & farm profile
  land_owned_acres NUMERIC(5,2),
  land_type TEXT CHECK (land_type IN ('all_cultivable', 'mostly_cultivable', 'mostly_barren', 'all_barren', NULL)),
  has_grid_connection BOOLEAN,
  current_pump TEXT CHECK (current_pump IN ('diesel', 'electric_grid', 'none', 'manual', NULL)),
  primary_crops TEXT[] DEFAULT '{}',
  
  -- Intent
  motivation TEXT,
  financing_ability TEXT CHECK (financing_ability IN ('savings', 'loan_needed', 'cannot_afford', 'unsure', NULL)),
  
  -- Recommended component (calculated by eligibility wizard)
  recommended_component TEXT CHECK (recommended_component IN ('A', 'B', 'C', 'A_OR_B', 'NOT_ELIGIBLE', NULL)),
  recommended_pump_hp NUMERIC(3,1),  -- Component B/C only
  estimated_farmer_share_inr NUMERIC(10,2),
  estimated_annual_savings_inr NUMERIC(10,2),
  
  -- Wizard snapshot
  eligibility_answers JSONB,
  
  -- Lead lifecycle
  lead_score SMALLINT,
  lead_tier TEXT CHECK (lead_tier IN ('HOT', 'WARM', 'COLD', NULL)),
  status TEXT DEFAULT 'new' CHECK (status IN ('new', 'assigned', 'contacted', 'converted', 'unmatched_no_vendor', 'dead')),
  consent_whatsapp BOOLEAN DEFAULT TRUE,
  
  -- Tracking
  source TEXT,
  ip TEXT,
  user_agent TEXT
);

CREATE INDEX IF NOT EXISTS idx_kusum_leads_created ON kusum_leads (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_kusum_leads_district ON kusum_leads (district_slug);
CREATE INDEX IF NOT EXISTS idx_kusum_leads_component ON kusum_leads (recommended_component);
CREATE INDEX IF NOT EXISTS idx_kusum_leads_tier ON kusum_leads (lead_tier);
CREATE INDEX IF NOT EXISTS idx_kusum_leads_status ON kusum_leads (status);


-- =========================================
-- VENDOR TABLE ENHANCEMENTS
-- Add KUSUM eligibility + profile fields for public directory
-- =========================================

ALTER TABLE vendors
  ADD COLUMN IF NOT EXISTS slug TEXT UNIQUE,                                  -- URL slug for /vendors/profile/{slug}
  ADD COLUMN IF NOT EXISTS category TEXT,                                      -- national_tier1 | national_tier2 | regional_specialist
  ADD COLUMN IF NOT EXISTS specialties TEXT[] DEFAULT '{}',                   -- residential_rooftop, commercial_rooftop, kusum_pumps, utility_scale
  ADD COLUMN IF NOT EXISTS kusum_components TEXT[] DEFAULT '{}',              -- ['A', 'B', 'C']
  ADD COLUMN IF NOT EXISTS founded_year INT,
  ADD COLUMN IF NOT EXISTS verification_status TEXT DEFAULT 'unverified'      -- unverified | seed_unverified | verified | rejected
    CHECK (verification_status IN ('unverified', 'seed_unverified', 'verified', 'rejected')),
  ADD COLUMN IF NOT EXISTS verification_date TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS public_listing BOOLEAN DEFAULT FALSE,              -- show on /vendors/directory.html
  ADD COLUMN IF NOT EXISTS seed_source TEXT,                                  -- where the entry came from
  ADD COLUMN IF NOT EXISTS profile_blurb TEXT,                                -- short description for profile page
  ADD COLUMN IF NOT EXISTS team_size_text TEXT;                                -- e.g. '500+', '100-200'

CREATE INDEX IF NOT EXISTS idx_vendors_slug ON vendors (slug);
CREATE INDEX IF NOT EXISTS idx_vendors_kusum ON vendors USING GIN (kusum_components);
CREATE INDEX IF NOT EXISTS idx_vendors_verification ON vendors (verification_status);
CREATE INDEX IF NOT EXISTS idx_vendors_public_listing ON vendors (public_listing) WHERE public_listing = TRUE;


-- =========================================
-- VIEW: kusum_inbox
-- Per-vendor KUSUM leads assigned to them (when implemented)
-- =========================================

CREATE OR REPLACE VIEW kusum_leads_overview AS
SELECT
  k.id AS lead_id,
  k.created_at AS lead_created_at,
  k.name AS customer_name,
  k.phone AS customer_phone,
  k.email AS customer_email,
  k.district_slug,
  k.village_or_tehsil,
  k.land_owned_acres,
  k.land_type,
  k.has_grid_connection,
  k.current_pump,
  k.primary_crops,
  k.motivation,
  k.financing_ability,
  k.recommended_component,
  k.recommended_pump_hp,
  k.estimated_farmer_share_inr,
  k.estimated_annual_savings_inr,
  k.lead_score,
  k.lead_tier,
  k.status,
  k.source
FROM kusum_leads k
ORDER BY k.created_at DESC;


-- =========================================
-- VIEW: vendor_directory_public
-- Public-facing vendor directory (only verified + public_listing=true)
-- =========================================

CREATE OR REPLACE VIEW vendor_directory_public AS
SELECT
  v.id,
  v.slug,
  v.company_name,
  v.brand_name,
  v.category,
  v.hq,
  v.website,
  v.specialties,
  v.kusum_components,
  v.tier,
  v.coverage_districts,
  array_length(v.coverage_districts, 1) AS district_count,
  v.founded_year,
  v.team_size_text,
  v.profile_blurb,
  v.leads_closed,
  CASE 
    WHEN v.leads_received > 0 THEN ROUND((v.leads_closed::numeric / v.leads_received) * 100, 1)
    ELSE NULL 
  END AS close_rate_pct
FROM vendors v
WHERE v.active = TRUE
  AND v.verification_status = 'verified'
  AND v.public_listing = TRUE
  AND v.tier != 'suspended'
ORDER BY 
  CASE v.tier WHEN 'premium' THEN 1 WHEN 'standard' THEN 2 WHEN 'probation' THEN 3 ELSE 4 END,
  v.leads_closed DESC NULLS LAST,
  v.company_name;


COMMENT ON TABLE kusum_leads IS 'Farmer-side leads for PM-KUSUM scheme (Components A/B/C). Separate from rooftop leads.';
COMMENT ON COLUMN vendors.verification_status IS 'unverified (default) | seed_unverified (from seed data, do not display) | verified (manually checked, OK for public) | rejected';
COMMENT ON COLUMN vendors.public_listing IS 'Show on public /vendors/directory.html. Only set TRUE after verification_status=verified AND agreement_signed_at IS NOT NULL.';
COMMENT ON VIEW vendor_directory_public IS 'Filtered view for public directory page. Only verified + listed vendors.';
