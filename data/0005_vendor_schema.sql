-- Migration 0005: v0.5.5 vendor onboarding tables
-- Run in Supabase SQL Editor after deploying vendor application form

-- =========================================
-- TABLE: vendor_applications
-- Raw applications from /vendors/apply.html
-- Reviewed manually, then promoted to vendors table
-- =========================================

CREATE TABLE IF NOT EXISTS vendor_applications (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  
  -- Company basics
  company_name TEXT NOT NULL,
  brand_name TEXT,
  contact_name TEXT NOT NULL,
  contact_role TEXT,
  phone TEXT NOT NULL,
  email TEXT NOT NULL,
  website TEXT,
  hq TEXT NOT NULL,
  
  -- Approvals
  mnre_number TEXT NOT NULL,
  upneda_number TEXT NOT NULL,
  gstin TEXT NOT NULL,
  pan TEXT NOT NULL,
  
  -- Experience
  years_active TEXT,
  installs_completed TEXT,
  team_size TEXT,
  
  -- Coverage
  coverage_districts TEXT[] DEFAULT '{}',
  min_system_size_kw NUMERIC(4, 2),
  property_types TEXT[] DEFAULT '{}',
  lead_capacity_per_week TEXT,
  
  -- Misc
  notes TEXT,
  agreed JSONB,
  auto_flags JSONB,
  
  -- Review workflow
  status TEXT DEFAULT 'pending_review' CHECK (status IN (
    'pending_review',
    'auto_rejected',
    'under_review',
    'approved',
    'rejected',
    'duplicate'
  )),
  reviewer_notes TEXT,
  reviewed_at TIMESTAMPTZ,
  reviewed_by TEXT,
  
  -- Tracking
  source TEXT,
  ip TEXT,
  user_agent TEXT
);

CREATE INDEX IF NOT EXISTS idx_vendor_apps_status ON vendor_applications (status);
CREATE INDEX IF NOT EXISTS idx_vendor_apps_created ON vendor_applications (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_vendor_apps_email ON vendor_applications (email);
CREATE INDEX IF NOT EXISTS idx_vendor_apps_mnre ON vendor_applications (mnre_number);


-- =========================================
-- TABLE: vendors
-- Approved vendors (promoted from applications)
-- These are the ones who actually receive leads
-- =========================================

CREATE TABLE IF NOT EXISTS vendors (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  application_id UUID REFERENCES vendor_applications(id),
  
  -- Profile (carried over from application, but editable)
  company_name TEXT NOT NULL,
  brand_name TEXT,
  contact_name TEXT,
  phone TEXT NOT NULL,
  email TEXT,
  website TEXT,
  hq TEXT,
  
  -- Approvals
  mnre_number TEXT,
  upneda_number TEXT,
  gstin TEXT,
  pan TEXT,
  
  -- Commission tier
  commission_rate NUMERIC(4, 2) DEFAULT 7.0, -- 7% during probation
  tier TEXT DEFAULT 'probation' CHECK (tier IN ('probation', 'standard', 'premium', 'suspended')),
  
  -- Operational config
  active BOOLEAN DEFAULT TRUE,
  coverage_districts TEXT[] DEFAULT '{}',
  min_system_size_kw NUMERIC(4, 2) DEFAULT 3.0,
  property_types TEXT[] DEFAULT '{independent_home}',
  lead_capacity_per_week INT DEFAULT 5,
  
  -- Performance metrics (updated by triggers/cron)
  leads_received INT DEFAULT 0,
  leads_responded_4hr INT DEFAULT 0,
  leads_closed INT DEFAULT 0,
  total_commission_owed NUMERIC(12, 2) DEFAULT 0,
  total_commission_paid NUMERIC(12, 2) DEFAULT 0,
  avg_response_time_minutes INT,
  customer_satisfaction NUMERIC(3, 2), -- 0-5 stars
  
  -- Agreement
  agreement_signed_at TIMESTAMPTZ,
  agreement_version TEXT,
  onboarding_call_at TIMESTAMPTZ,
  
  notes TEXT
);

CREATE INDEX IF NOT EXISTS idx_vendors_active ON vendors (active) WHERE active = TRUE;
CREATE INDEX IF NOT EXISTS idx_vendors_tier ON vendors (tier);
CREATE INDEX IF NOT EXISTS idx_vendors_districts ON vendors USING GIN (coverage_districts);


-- =========================================
-- TABLE: lead_assignments
-- Tracks which vendor got which lead, response/close status, commission tracking
-- =========================================

CREATE TABLE IF NOT EXISTS lead_assignments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  
  lead_id UUID NOT NULL REFERENCES leads(id),
  vendor_id UUID NOT NULL REFERENCES vendors(id),
  
  -- Assignment metadata
  assigned_at TIMESTAMPTZ DEFAULT NOW(),
  assignment_method TEXT, -- 'auto' | 'manual' | 'reassign'
  district_slug TEXT,
  lead_tier TEXT,
  lead_score SMALLINT,
  
  -- Vendor response tracking
  vendor_responded_at TIMESTAMPTZ,
  response_time_minutes INT,
  vendor_response_method TEXT, -- 'whatsapp' | 'call' | 'email'
  
  -- Outcome
  outcome TEXT DEFAULT 'pending' CHECK (outcome IN (
    'pending',
    'contacted',
    'site_visit_scheduled',
    'quote_sent',
    'contract_signed',
    'installation_complete',
    'net_meter_activated',
    'declined_by_vendor',
    'declined_by_customer',
    'lost_to_competitor',
    'no_response',
    'duplicate'
  )),
  outcome_updated_at TIMESTAMPTZ,
  
  -- Commission tracking
  system_size_kw NUMERIC(4, 2),
  gross_system_value NUMERIC(10, 2),
  commission_rate NUMERIC(4, 2),
  commission_amount NUMERIC(10, 2),
  commission_status TEXT DEFAULT 'pending' CHECK (commission_status IN (
    'pending',     -- deal not closed
    'owed',        -- deal closed, awaiting payment
    'invoiced',    -- invoice issued to vendor
    'paid',        -- vendor paid commission
    'disputed',    -- under arbitration
    'waived'       -- written off
  )),
  commission_invoiced_at TIMESTAMPTZ,
  commission_paid_at TIMESTAMPTZ,
  
  -- Verification
  net_meter_activated_at TIMESTAMPTZ,
  customer_confirmation TEXT, -- WhatsApp/SMS confirmation text
  
  notes TEXT
);

CREATE INDEX IF NOT EXISTS idx_lead_assignments_lead ON lead_assignments (lead_id);
CREATE INDEX IF NOT EXISTS idx_lead_assignments_vendor ON lead_assignments (vendor_id);
CREATE INDEX IF NOT EXISTS idx_lead_assignments_outcome ON lead_assignments (outcome);
CREATE INDEX IF NOT EXISTS idx_lead_assignments_commission ON lead_assignments (commission_status);
CREATE INDEX IF NOT EXISTS idx_lead_assignments_assigned ON lead_assignments (assigned_at DESC);


-- =========================================
-- VIEW: vendor_dashboard
-- Quick overview for admin manual ops
-- =========================================

CREATE OR REPLACE VIEW vendor_dashboard AS
SELECT
  v.id,
  v.company_name,
  v.brand_name,
  v.contact_name,
  v.phone,
  v.email,
  v.tier,
  v.commission_rate,
  v.active,
  v.coverage_districts,
  array_length(v.coverage_districts, 1) AS district_count,
  v.lead_capacity_per_week,
  v.leads_received,
  v.leads_closed,
  CASE 
    WHEN v.leads_received > 0 THEN ROUND((v.leads_closed::numeric / v.leads_received) * 100, 1)
    ELSE NULL 
  END AS close_rate_pct,
  v.total_commission_owed,
  v.total_commission_paid,
  v.created_at,
  v.agreement_signed_at,
  v.notes
FROM vendors v
ORDER BY 
  CASE v.tier 
    WHEN 'premium' THEN 1 
    WHEN 'standard' THEN 2 
    WHEN 'probation' THEN 3 
    WHEN 'suspended' THEN 4 
  END,
  v.created_at DESC;


-- =========================================
-- VIEW: pending_applications
-- For manual reviewer to triage
-- =========================================

CREATE OR REPLACE VIEW pending_applications AS
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
  upneda_number,
  years_active,
  installs_completed,
  team_size,
  array_length(coverage_districts, 1) AS district_count,
  coverage_districts,
  min_system_size_kw,
  lead_capacity_per_week,
  auto_flags,
  notes,
  status
FROM vendor_applications
WHERE status IN ('pending_review', 'under_review')
ORDER BY 
  -- Priority applications first (those with priorityReview=true in auto_flags)
  (auto_flags->>'priorityReview')::boolean DESC NULLS LAST,
  created_at ASC;


-- =========================================
-- HELPFUL COMMENTS
-- =========================================

COMMENT ON TABLE vendor_applications IS 'Raw applications from /vendors/apply.html. Manually reviewed, then approved → promoted to vendors table.';
COMMENT ON TABLE vendors IS 'Approved vendors who receive lead assignments. Linked to vendor_applications via application_id.';
COMMENT ON TABLE lead_assignments IS 'Tracks lead-vendor matching, response time, outcome, commission lifecycle.';

COMMENT ON COLUMN vendors.tier IS 'probation (first 6 months @ 7%) | standard (7%) | premium (top 30%, 8% + priority routing) | suspended';
COMMENT ON COLUMN lead_assignments.commission_status IS 'pending → owed (on net_meter_activated) → invoiced → paid';
