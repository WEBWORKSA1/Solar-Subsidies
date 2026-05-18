-- ============================================================
-- SolarSubsidies.com — Supabase Schema v0.2
-- Run this in Supabase SQL Editor (one-time setup)
-- ============================================================

-- Enable extensions
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- ============================================================
-- 1. STATES
-- ============================================================
CREATE TABLE IF NOT EXISTS states (
  code text PRIMARY KEY,
  name text NOT NULL,
  name_hi text,
  per_kw_subsidy integer DEFAULT 0,
  subsidy_cap integer DEFAULT 0,
  subsidy_cap_kw numeric DEFAULT 0,
  flat_rate boolean DEFAULT false,
  notes text
);

INSERT INTO states (code, name, name_hi, per_kw_subsidy, subsidy_cap, subsidy_cap_kw, flat_rate, notes) VALUES
('up', 'Uttar Pradesh', 'उत्तर प्रदेश', 15000, 30000, 2, false, 'UPNEDA state subsidy ₹15k/kW up to 2 kW'),
('gj', 'Gujarat', 'ગુજરાત', 0, 40000, 0, true, 'Surya Urja Rooftop Yojana flat ₹40k'),
('dl', 'Delhi', 'दिल्ली', 0, 10000, 0, true, 'Delhi Solar Energy Policy 2023 capital subsidy'),
('mh', 'Maharashtra', 'महाराष्ट्र', 0, 0, 0, false, 'No state stack — net metering only'),
('rj', 'Rajasthan', 'राजस्थान', 0, 0, 0, false, 'Net metering only'),
('hr', 'Haryana', 'हरियाणा', 0, 0, 0, false, 'Net metering only'),
('pb', 'Punjab', 'ਪੰਜਾਬ', 0, 0, 0, false, 'KUSUM focus'),
('ka', 'Karnataka', 'ಕರ್ನಾಟಕ', 0, 0, 0, false, 'Net metering only'),
('tn', 'Tamil Nadu', 'தமிழ்நாடு', 0, 0, 0, false, 'Net metering only')
ON CONFLICT (code) DO NOTHING;

-- ============================================================
-- 2. DISCOMS
-- ============================================================
CREATE TABLE IF NOT EXISTS discoms (
  id serial PRIMARY KEY,
  code text UNIQUE NOT NULL,
  state_code text REFERENCES states(code),
  name text NOT NULL,
  name_hi text,
  coverage text,
  residential_tariff_per_unit numeric DEFAULT 6.50,
  commercial_tariff_per_unit numeric DEFAULT 9.00,
  agricultural_tariff_per_unit numeric DEFAULT 2.00,
  net_metering_active boolean DEFAULT true,
  helpline text,
  portal_url text
);

INSERT INTO discoms (code, state_code, name, name_hi, coverage, residential_tariff_per_unit) VALUES
('PvVNL', 'up', 'Paschimanchal Vidyut Vitran Nigam', 'पश्चिमांचल विद्युत वितरण निगम', 'Western UP', 6.50),
('MVVNL', 'up', 'Madhyanchal Vidyut Vitran Nigam', 'मध्यांचल विद्युत वितरण निगम', 'Central UP', 6.50),
('DVVNL', 'up', 'Dakshinanchal Vidyut Vitran Nigam', 'दक्षिणांचल विद्युत वितरण निगम', 'Southern UP', 6.50),
('PuVVNL', 'up', 'Purvanchal Vidyut Vitran Nigam', 'पूर्वांचल विद्युत वितरण निगम', 'Eastern UP', 6.50),
('KESCO', 'up', 'Kanpur Electricity Supply Company', 'कानपुर विद्युत आपूर्ति', 'Kanpur Nagar', 6.50),
('NPCL', 'up', 'Noida Power Company Limited', 'नोएडा पावर कंपनी', 'Greater Noida', 5.50)
ON CONFLICT (code) DO NOTHING;

-- ============================================================
-- 3. DISTRICTS (75 UP districts)
-- ============================================================
CREATE TABLE IF NOT EXISTS districts (
  id integer PRIMARY KEY,
  state_code text REFERENCES states(code),
  name text NOT NULL,
  name_hi text,
  slug text UNIQUE NOT NULL,
  division text,
  discom_code text REFERENCES discoms(code),
  irradiance_kwh_m2 numeric DEFAULT 5.0,
  population integer,
  rural_pct numeric,
  primary_crop text,
  created_at timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_districts_slug ON districts(slug);
CREATE INDEX IF NOT EXISTS idx_districts_state ON districts(state_code);
CREATE INDEX IF NOT EXISTS idx_districts_discom ON districts(discom_code);

-- District seed data is loaded via seed-districts.sql (separate file, 75 INSERTs)

-- ============================================================
-- 4. VENDORS
-- ============================================================
CREATE TABLE IF NOT EXISTS vendors (
  id serial PRIMARY KEY,
  name text NOT NULL,
  slug text UNIQUE NOT NULL,
  type text CHECK (type IN ('manufacturer', 'epc', 'channel_partner', 'aggregator')),
  hq_city text,
  hq_state_code text REFERENCES states(code),
  founded_year integer,
  mnre_empanelled boolean DEFAULT false,
  almm_listed boolean DEFAULT false,
  systems_installed integer,
  warranty_years integer DEFAULT 25,
  helpline text,
  website text,
  email text,
  rural_focus_score integer DEFAULT 5 CHECK (rural_focus_score BETWEEN 1 AND 10),
  kusum_expert boolean DEFAULT false,
  hindi_support boolean DEFAULT false,
  logo_url text,
  tier text CHECK (tier IN ('tier1', 'tier2', 'tier3')),
  description text,
  created_at timestamptz DEFAULT now()
);

INSERT INTO vendors (name, slug, type, hq_city, hq_state_code, founded_year, mnre_empanelled, warranty_years, helpline, website, rural_focus_score, kusum_expert, hindi_support, tier, description) VALUES
('Ujala Solar', 'ujala-solar', 'epc', 'Lucknow', 'up', 2015, true, 25, NULL, 'https://ujalasolar.com', 10, true, true, 'tier2', 'Rural electrification specialist with deep PM-KUSUM execution experience. Same-state service response across UP.'),
('Tata Power Solar', 'tata-power-solar', 'manufacturer', 'Bangalore', 'ka', 1989, true, 25, '1800 25 7777', 'https://tatapowersolar.com', 8, false, true, 'tier1', 'India''s oldest solar company. "Ghar Ghar Solar" UP campaign. Full EPC with 25-year service.'),
('Waaree Energies', 'waaree-energies', 'manufacturer', 'Mumbai', 'mh', 1989, true, 25, NULL, 'https://waaree.com', 7, false, false, 'tier1', 'India''s largest module manufacturer by volume. 1,000+ retail touchpoints — deepest Tier-3 UP penetration.'),
('Adani Solar', 'adani-solar', 'manufacturer', 'Mundra', 'gj', 2015, true, 25, NULL, 'https://adanisolar.com', 5, false, false, 'tier1', 'India''s largest vertically integrated solar manufacturer. Strong in commercial/utility scale.'),
('SolarSquare', 'solarsquare', 'epc', 'Mumbai', 'mh', 2015, true, 25, NULL, 'https://solarsquare.in', 6, false, false, 'tier2', 'India''s fastest-growing residential solar pure-play. Backed by Zerodha Rainmatter. 5-year guaranteed savings.'),
('Vikram Solar', 'vikram-solar', 'manufacturer', 'Kolkata', NULL, 2006, true, 25, NULL, 'https://vikramsolar.com', 6, false, false, 'tier1', '275+ projects, 1.03 GW installed across India. Strong mid-size commercial/residential.'),
('Jakson Group', 'jakson-group', 'epc', 'Noida', 'up', 1947, true, 25, NULL, 'https://jakson.com', 6, false, true, 'tier2', 'UP-headquartered. Full EPC + manufacturing + microgrids. Strong in industrial/commercial UP.'),
('Loom Solar', 'loom-solar', 'manufacturer', 'Faridabad', 'hr', 2018, true, 25, NULL, 'https://loomsolar.com', 7, false, true, 'tier2', '10,000+ dealer network, 50,000+ customers. Strong for component-level retail and small DIY systems.'),
('Enkay Solar Power', 'enkay-solar', 'epc', 'Lucknow', 'up', 2010, true, 25, NULL, NULL, 9, false, true, 'tier3', 'Lucknow-based EPC. Turnkey solutions for schools, hospitals, factories, government buildings.'),
('Roofsol Energy', 'roofsol-energy', 'epc', 'Lucknow', 'up', 2014, true, 25, NULL, NULL, 8, false, true, 'tier3', 'Lucknow-based residential/small commercial EPC. Strong after-sales focus.')
ON CONFLICT (slug) DO NOTHING;

-- ============================================================
-- 5. VENDOR-DISTRICT COVERAGE (M2M)
-- ============================================================
CREATE TABLE IF NOT EXISTS vendor_districts (
  vendor_id integer REFERENCES vendors(id) ON DELETE CASCADE,
  district_id integer REFERENCES districts(id) ON DELETE CASCADE,
  is_preferred boolean DEFAULT false,
  PRIMARY KEY (vendor_id, district_id)
);

-- ============================================================
-- 6. LEADS — THE MONEY TABLE
-- ============================================================
CREATE TABLE IF NOT EXISTS leads (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text,
  phone text,
  email text,
  state_code text REFERENCES states(code),
  district_slug text,
  district_id integer REFERENCES districts(id),
  system_size_kw numeric,
  monthly_bill integer,
  property_type text,
  consent_whatsapp boolean DEFAULT false,
  source text DEFAULT 'calculator',
  status text DEFAULT 'new' CHECK (status IN ('new', 'matched', 'contacted', 'quoted', 'won', 'lost', 'invalid')),
  matched_vendor_ids integer[],
  calculator_snapshot jsonb,
  ip text,
  user_agent text,
  utm_source text,
  utm_medium text,
  utm_campaign text,
  notes text,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now(),
  won_at timestamptz,
  payout_inr integer
);

CREATE INDEX IF NOT EXISTS idx_leads_state ON leads(state_code);
CREATE INDEX IF NOT EXISTS idx_leads_district ON leads(district_slug);
CREATE INDEX IF NOT EXISTS idx_leads_status ON leads(status);
CREATE INDEX IF NOT EXISTS idx_leads_created ON leads(created_at DESC);

-- ============================================================
-- 7. KUSUM LEADS (separate flow for farmers)
-- ============================================================
CREATE TABLE IF NOT EXISTS kusum_leads (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  farmer_name text,
  mobile text,
  email text,
  state_code text REFERENCES states(code) DEFAULT 'up',
  district_slug text,
  district_id integer REFERENCES districts(id),
  land_acres numeric,
  crop_type text,
  water_source text,
  current_pump text CHECK (current_pump IN ('diesel', 'grid', 'none')),
  pump_hp_required numeric,
  kusum_component text CHECK (kusum_component IN ('A', 'B', 'C1', 'C2')),
  estimated_subsidy integer,
  estimated_farmer_share integer,
  status text DEFAULT 'new',
  notes text,
  created_at timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_kusum_district ON kusum_leads(district_slug);

-- ============================================================
-- 8. ANALYTICS EVENTS
-- ============================================================
CREATE TABLE IF NOT EXISTS events (
  id bigserial PRIMARY KEY,
  session_id text,
  event_type text NOT NULL,
  page_path text,
  district_slug text,
  state_code text,
  payload jsonb,
  ip text,
  user_agent text,
  referrer text,
  ts timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_events_type ON events(event_type);
CREATE INDEX IF NOT EXISTS idx_events_ts ON events(ts DESC);

-- ============================================================
-- 9. ROW LEVEL SECURITY
-- ============================================================
ALTER TABLE leads ENABLE ROW LEVEL SECURITY;
ALTER TABLE kusum_leads ENABLE ROW LEVEL SECURITY;
ALTER TABLE events ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Anyone can submit leads" ON leads;
CREATE POLICY "Anyone can submit leads" ON leads FOR INSERT WITH CHECK (true);

DROP POLICY IF EXISTS "Admin read leads" ON leads;
CREATE POLICY "Admin read leads" ON leads FOR SELECT USING (auth.role() = 'service_role');

DROP POLICY IF EXISTS "Admin update leads" ON leads;
CREATE POLICY "Admin update leads" ON leads FOR UPDATE USING (auth.role() = 'service_role');

DROP POLICY IF EXISTS "Anyone can submit kusum leads" ON kusum_leads;
CREATE POLICY "Anyone can submit kusum leads" ON kusum_leads FOR INSERT WITH CHECK (true);

DROP POLICY IF EXISTS "Admin read kusum" ON kusum_leads;
CREATE POLICY "Admin read kusum" ON kusum_leads FOR SELECT USING (auth.role() = 'service_role');

DROP POLICY IF EXISTS "Anyone can submit events" ON events;
CREATE POLICY "Anyone can submit events" ON events FOR INSERT WITH CHECK (true);

DROP POLICY IF EXISTS "Admin read events" ON events;
CREATE POLICY "Admin read events" ON events FOR SELECT USING (auth.role() = 'service_role');

-- ============================================================
-- 10. UPDATE TRIGGER for leads.updated_at
-- ============================================================
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
   NEW.updated_at = now();
   RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS update_leads_updated_at ON leads;
CREATE TRIGGER update_leads_updated_at
  BEFORE UPDATE ON leads
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();
