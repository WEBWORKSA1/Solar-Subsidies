-- Migration 0004: v0.5 lead scoring fields
-- Adds intent, timeline, lead_score, lead_tier to leads table
-- Run in Supabase SQL Editor after v0.5 deploy

ALTER TABLE leads
  ADD COLUMN IF NOT EXISTS intent TEXT,
  ADD COLUMN IF NOT EXISTS timeline TEXT,
  ADD COLUMN IF NOT EXISTS lead_score SMALLINT,
  ADD COLUMN IF NOT EXISTS lead_tier TEXT;

-- Index for filtering hot leads in admin export + vendor portal queries
CREATE INDEX IF NOT EXISTS idx_leads_tier ON leads (lead_tier);
CREATE INDEX IF NOT EXISTS idx_leads_score ON leads (lead_score);
CREATE INDEX IF NOT EXISTS idx_leads_district_tier ON leads (district_slug, lead_tier);
CREATE INDEX IF NOT EXISTS idx_leads_status_tier ON leads (status, lead_tier);

-- Add a constraint to make sure tier is one of the valid values
ALTER TABLE leads DROP CONSTRAINT IF EXISTS leads_tier_check;
ALTER TABLE leads ADD CONSTRAINT leads_tier_check 
  CHECK (lead_tier IS NULL OR lead_tier IN ('HOT', 'WARM', 'COLD'));

-- Add constraint to ensure score is in valid range  
ALTER TABLE leads DROP CONSTRAINT IF EXISTS leads_score_check;
ALTER TABLE leads ADD CONSTRAINT leads_score_check
  CHECK (lead_score IS NULL OR (lead_score >= 1 AND lead_score <= 10));

-- Helpful view for vendor portal (will use in v0.6)
CREATE OR REPLACE VIEW leads_dashboard AS
SELECT
  id,
  created_at,
  lead_tier,
  lead_score,
  name,
  phone,
  email,
  state_code,
  district_slug,
  system_size_kw,
  monthly_bill,
  property_type,
  intent,
  timeline,
  status,
  source
FROM leads
ORDER BY created_at DESC;

-- Add comment so future maintainers understand the scoring
COMMENT ON COLUMN leads.lead_score IS 'Algorithmic score 1-10 based on bill, timeline, property, intent. See api/lead.js scoreLead()';
COMMENT ON COLUMN leads.lead_tier IS 'HOT (>=8), WARM (5-7), COLD (<5). Drives admin alerting + vendor routing priority';
COMMENT ON COLUMN leads.intent IS 'User-selected goal: reduce_bill | independence | property_value | environment | subsidy | researching';
COMMENT ON COLUMN leads.timeline IS 'When they want to install: this_month | 1_3_months | 3_6_months | just_researching';
