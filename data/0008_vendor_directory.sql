-- Migration 0008: v0.7 public vendor directory
-- Extends `vendors` table with public-facing display fields.
-- Then provides a seeding template (commented out — uncomment to insert seed vendors).
-- Run in Supabase SQL Editor after deploying v0.7.

-- =========================================
-- EXTEND vendors TABLE WITH DIRECTORY FIELDS
-- =========================================

ALTER TABLE vendors
  ADD COLUMN IF NOT EXISTS slug TEXT UNIQUE,                                     -- e.g. 'tata-power-solar' for URL: /vendors/tata-power-solar.html
  ADD COLUMN IF NOT EXISTS description TEXT,                                     -- public-facing description (shown on profile page)
  ADD COLUMN IF NOT EXISTS established_year INT,                                 -- year founded
  ADD COLUMN IF NOT EXISTS office_cities TEXT[] DEFAULT '{}',                    -- UP cities with physical office
  ADD COLUMN IF NOT EXISTS verified BOOLEAN DEFAULT FALSE,                       -- shown publicly only if true (filters out placeholders)
  ADD COLUMN IF NOT EXISTS verification_source TEXT,                             -- 'public_record' | 'application' | 'manual'
  ADD COLUMN IF NOT EXISTS specializations TEXT[] DEFAULT '{}',                  -- e.g. {rooftop_residential, rooftop_commercial, rwa_group_housing}
  ADD COLUMN IF NOT EXISTS max_system_size_kw NUMERIC(8,2),                      -- maximum system size they handle
  ADD COLUMN IF NOT EXISTS panel_brands TEXT[] DEFAULT '{}',                     -- e.g. {Tata Power Solar, Adani, Waaree}
  ADD COLUMN IF NOT EXISTS inverter_brands TEXT[] DEFAULT '{}',                  -- e.g. {Sungrow, SMA, Growatt}
  ADD COLUMN IF NOT EXISTS warranty_panels_years INT DEFAULT 25,
  ADD COLUMN IF NOT EXISTS warranty_inverter_years INT DEFAULT 5,
  ADD COLUMN IF NOT EXISTS warranty_workmanship_years INT DEFAULT 3,
  ADD COLUMN IF NOT EXISTS public_rating NUMERIC(2,1),                           -- 0.0 to 5.0
  ADD COLUMN IF NOT EXISTS public_rating_source TEXT,                            -- 'aggregated' | 'manual' | 'NPS_survey'
  ADD COLUMN IF NOT EXISTS public_review_count INT DEFAULT 0,
  ADD COLUMN IF NOT EXISTS years_in_solar INT,
  ADD COLUMN IF NOT EXISTS installations_completed_display TEXT,                 -- text like '50000+' for display only
  ADD COLUMN IF NOT EXISTS logo_url TEXT,                                        -- CDN URL if available
  ADD COLUMN IF NOT EXISTS hero_image_url TEXT,
  ADD COLUMN IF NOT EXISTS public_phone TEXT,                                    -- different from internal `phone` (which is admin contact)
  ADD COLUMN IF NOT EXISTS public_tags TEXT[] DEFAULT '{}',                      -- e.g. {national, OEM, premium, established} for filtering
  ADD COLUMN IF NOT EXISTS show_in_directory BOOLEAN DEFAULT FALSE;              -- master public/hidden toggle

-- Indexes for directory queries
CREATE INDEX IF NOT EXISTS idx_vendors_slug ON vendors (slug);
CREATE INDEX IF NOT EXISTS idx_vendors_show_in_directory ON vendors (show_in_directory) WHERE show_in_directory = TRUE;
CREATE INDEX IF NOT EXISTS idx_vendors_specializations ON vendors USING GIN (specializations);
CREATE INDEX IF NOT EXISTS idx_vendors_public_tags ON vendors USING GIN (public_tags);
CREATE INDEX IF NOT EXISTS idx_vendors_verified ON vendors (verified) WHERE verified = TRUE;


-- =========================================
-- VIEW: public_vendor_directory
-- Vendors safe to expose publicly via /api/vendor-directory + profile pages
-- =========================================

CREATE OR REPLACE VIEW public_vendor_directory AS
SELECT
  id,
  slug,
  company_name,
  brand_name,
  description,
  established_year,
  hq,
  office_cities,
  coverage_districts,
  specializations,
  min_system_size_kw,
  max_system_size_kw,
  panel_brands,
  inverter_brands,
  warranty_panels_years,
  warranty_inverter_years,
  warranty_workmanship_years,
  public_rating,
  public_review_count,
  years_in_solar,
  installations_completed_display,
  logo_url,
  hero_image_url,
  public_phone,
  public_tags,
  website,
  tier,
  verified,
  CASE
    WHEN verified = TRUE AND active = TRUE THEN 'verified'
    WHEN active = TRUE THEN 'unverified'
    ELSE 'inactive'
  END AS display_status,
  array_length(coverage_districts, 1) AS district_count,
  CASE
    WHEN tier = 'premium' THEN 1
    WHEN tier = 'standard' THEN 2
    WHEN tier = 'probation' THEN 3
    ELSE 4
  END AS tier_sort
FROM vendors
WHERE show_in_directory = TRUE
  AND active = TRUE
ORDER BY tier_sort, verified DESC, public_rating DESC NULLS LAST, company_name ASC;


-- =========================================
-- VIEW: vendors_by_district
-- For district-page "trusted local installers" sections
-- =========================================

CREATE OR REPLACE VIEW vendors_by_district AS
SELECT
  unnest(coverage_districts) AS district_slug,
  id,
  slug,
  company_name,
  brand_name,
  description,
  specializations,
  min_system_size_kw,
  max_system_size_kw,
  public_rating,
  tier,
  verified,
  public_tags,
  CASE
    WHEN tier = 'premium' THEN 1
    WHEN tier = 'standard' THEN 2
    WHEN tier = 'probation' THEN 3
    ELSE 4
  END AS tier_sort
FROM vendors
WHERE show_in_directory = TRUE
  AND active = TRUE;


-- =========================================
-- SEEDING TEMPLATE
-- =========================================
-- 
-- Below is the seed INSERT statement for the 32 vendors in data/vendors-seed.json.
-- 
-- IMPORTANT — before running:
-- 1. The 10 VERIFIED vendors use real public-record company names. They are
--    structurally safe to display (publicly-known solar companies, factually
--    documented as operating in UP). Set show_in_directory=TRUE only after
--    you have personally verified each via MNRE empanellment list and UPNEDA
--    approved vendor list. Until then, keep show_in_directory=FALSE.
-- 
-- 2. The 22 PLACEHOLDER vendors are fictional. They exist to populate the
--    directory shell so the UI doesn't look empty. They should NEVER have
--    show_in_directory=TRUE in production. As real vendors apply via
--    /vendors/apply.html and get approved through admin dashboard, replace
--    these placeholders one-by-one with real applications.
-- 
-- 3. Phone numbers shown for verified vendors are real public corporate
--    numbers. Customers should not be routed to these — they are display only.
--    Internal `phone` (used for SolarSubsidies → vendor WhatsApp routing) must
--    be set during actual vendor onboarding to a real contact person at that vendor.
-- 
-- 4. Run this manually after reviewing each row. Do not bulk-execute blindly.
-- 
-- VERIFIED VENDORS (set show_in_directory=TRUE only after MNRE/UPNEDA verification):

-- Example for one verified vendor — copy/adapt for the rest from data/vendors-seed.json
/*
INSERT INTO vendors (
  slug, company_name, brand_name, description, established_year,
  hq, office_cities, phone, public_phone, website,
  coverage_districts, specializations, min_system_size_kw, max_system_size_kw,
  panel_brands, inverter_brands,
  warranty_panels_years, warranty_inverter_years, warranty_workmanship_years,
  years_in_solar, installations_completed_display,
  tier, commission_rate, active, verified, verification_source, show_in_directory,
  public_rating, public_rating_source, public_tags,
  mnre_number, upneda_number
) VALUES (
  'tata-power-solar',
  'Tata Power Solar Systems Ltd',
  'Tata Power Solar',
  'India''s largest integrated solar player and original equipment manufacturer. Active across all 75 UP districts via authorized installer network. Premium positioning, longer warranty terms, higher pricing.',
  1989,
  'Bengaluru, with UP regional offices',
  ARRAY['Lucknow', 'Noida', 'Kanpur'],
  '+91-1800-209-3344',                                    -- internal contact (replace before going live)
  '1800-209-3344',                                         -- public display number
  'https://www.tatapowersolar.com',
  ARRAY['lucknow', 'kanpur-nagar', 'agra', 'varanasi', 'prayagraj', 'meerut', 'ghaziabad', 'gautam-buddha-nagar', 'bareilly', 'moradabad'],  -- expand to all 75 for display
  ARRAY['rooftop_residential', 'rooftop_commercial', 'rooftop_industrial', 'rwa_group_housing'],
  1, 1000,
  ARRAY['Tata Power Solar (in-house manufacturing)'],
  ARRAY['Sungrow', 'SMA', 'Tata Power Solar'],
  25, 10, 5,
  35, '50000+',
  'premium', 8.0, TRUE, TRUE, 'public_record', FALSE,  -- show_in_directory=FALSE until you verify
  4.4, 'aggregated public reviews', ARRAY['national', 'OEM', 'premium', 'established'],
  NULL, NULL                                              -- MNRE/UPNEDA numbers — fill from official lists before show_in_directory=TRUE
) ON CONFLICT (slug) DO NOTHING;
*/

-- For bulk seeding from data/vendors-seed.json, the recommended pattern is a Python script
-- that reads the JSON and emits parameterized INSERTs. See generator/seed-vendors.py.

COMMENT ON COLUMN vendors.slug IS 'URL-safe identifier for public vendor profile page. e.g. /vendors/tata-power-solar.html';
COMMENT ON COLUMN vendors.show_in_directory IS 'Master toggle for public visibility. Verified=true alone is NOT enough — must also be show_in_directory=true.';
COMMENT ON COLUMN vendors.verified IS 'Indicates whether MNRE/UPNEDA status has been confirmed. Placeholders MUST have verified=false.';
COMMENT ON VIEW public_vendor_directory IS 'Filters to vendors with show_in_directory=TRUE AND active=TRUE. Safe to expose to public via API.';
