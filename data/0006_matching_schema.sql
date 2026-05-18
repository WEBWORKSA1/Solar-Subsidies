-- Migration 0006: v0.6 vendor portal + matching engine
-- Run in Supabase SQL Editor after deploying portal

-- =========================================
-- TABLE: vendor_sessions
-- Magic-link OTP authentication + active sessions
-- =========================================

CREATE TABLE IF NOT EXISTS vendor_sessions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  
  vendor_id UUID REFERENCES vendors(id) ON DELETE CASCADE,
  
  -- OTP request stage
  otp_code TEXT,                          -- 6-digit hashed (SHA-256)
  otp_destination TEXT,                   -- phone or email
  otp_channel TEXT CHECK (otp_channel IN ('whatsapp', 'email')),
  otp_expires_at TIMESTAMPTZ,
  otp_attempts INT DEFAULT 0,
  
  -- Active session stage
  session_token TEXT UNIQUE,              -- 32-byte random hex
  session_expires_at TIMESTAMPTZ,
  
  -- Audit
  ip TEXT,
  user_agent TEXT,
  last_used_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_vendor_sessions_token ON vendor_sessions (session_token) WHERE session_token IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_vendor_sessions_vendor ON vendor_sessions (vendor_id);
CREATE INDEX IF NOT EXISTS idx_vendor_sessions_otp_dest ON vendor_sessions (otp_destination) WHERE otp_code IS NOT NULL;

-- Auto-cleanup expired sessions (run nightly via cron)
-- DELETE FROM vendor_sessions WHERE 
--   (session_expires_at IS NOT NULL AND session_expires_at < NOW())
--   OR (otp_expires_at IS NOT NULL AND otp_expires_at < NOW() - INTERVAL '24 hours');


-- =========================================
-- LEAD ASSIGNMENT ENHANCEMENTS
-- Add expiry + reassignment tracking
-- =========================================

ALTER TABLE lead_assignments
  ADD COLUMN IF NOT EXISTS expires_at TIMESTAMPTZ,           -- when this assignment auto-reassigns
  ADD COLUMN IF NOT EXISTS reassign_count INT DEFAULT 0,    -- 0 = first vendor, 1 = second, etc.
  ADD COLUMN IF NOT EXISTS declined_reason TEXT,
  ADD COLUMN IF NOT EXISTS vendor_notes TEXT;               -- private vendor-side notes

CREATE INDEX IF NOT EXISTS idx_lead_assignments_expires 
  ON lead_assignments (expires_at) 
  WHERE outcome = 'pending';


-- =========================================
-- VENDOR PERFORMANCE METRICS UPDATE TRIGGER
-- Auto-updates vendors.leads_received etc. on assignment changes
-- =========================================

CREATE OR REPLACE FUNCTION update_vendor_metrics()
RETURNS TRIGGER AS $$
BEGIN
  -- On INSERT of new assignment
  IF (TG_OP = 'INSERT') THEN
    UPDATE vendors 
    SET leads_received = leads_received + 1
    WHERE id = NEW.vendor_id;
    RETURN NEW;
  END IF;
  
  -- On UPDATE — check outcome transitions
  IF (TG_OP = 'UPDATE') THEN
    -- If response just happened (response_time_minutes went from NULL to value)
    IF OLD.response_time_minutes IS NULL AND NEW.response_time_minutes IS NOT NULL THEN
      IF NEW.response_time_minutes <= 240 THEN  -- 4 hours
        UPDATE vendors SET leads_responded_4hr = leads_responded_4hr + 1
        WHERE id = NEW.vendor_id;
      END IF;
    END IF;
    
    -- If outcome changed to net_meter_activated, count as closed
    IF NEW.outcome = 'net_meter_activated' AND OLD.outcome != 'net_meter_activated' THEN
      UPDATE vendors 
      SET leads_closed = leads_closed + 1,
          total_commission_owed = total_commission_owed + COALESCE(NEW.commission_amount, 0)
      WHERE id = NEW.vendor_id;
    END IF;
    
    -- If commission marked paid
    IF NEW.commission_status = 'paid' AND OLD.commission_status != 'paid' THEN
      UPDATE vendors 
      SET total_commission_paid = total_commission_paid + COALESCE(NEW.commission_amount, 0)
      WHERE id = NEW.vendor_id;
    END IF;
    
    RETURN NEW;
  END IF;
  
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_vendor_metrics ON lead_assignments;
CREATE TRIGGER trg_vendor_metrics
  AFTER INSERT OR UPDATE ON lead_assignments
  FOR EACH ROW EXECUTE FUNCTION update_vendor_metrics();


-- =========================================
-- VIEW: vendor_inbox
-- Each vendor's open/recent leads — used by portal
-- =========================================

CREATE OR REPLACE VIEW vendor_inbox AS
SELECT
  la.id AS assignment_id,
  la.vendor_id,
  la.created_at AS assigned_at,
  la.expires_at,
  la.outcome,
  la.lead_tier,
  la.lead_score,
  la.district_slug,
  la.system_size_kw,
  la.gross_system_value,
  la.commission_amount,
  la.commission_rate,
  la.commission_status,
  la.response_time_minutes,
  la.vendor_notes,
  
  l.id AS lead_id,
  l.name AS customer_name,
  l.phone AS customer_phone,
  l.email AS customer_email,
  l.monthly_bill,
  l.property_type,
  l.intent,
  l.timeline,
  l.calculator_snapshot,
  l.created_at AS lead_created_at,
  
  -- SLA status
  CASE 
    WHEN la.outcome != 'pending' THEN 'closed'
    WHEN la.response_time_minutes IS NOT NULL THEN 'responded'
    WHEN la.expires_at < NOW() THEN 'expired'
    WHEN la.expires_at < NOW() + INTERVAL '1 hour' THEN 'urgent'
    ELSE 'open'
  END AS sla_status
FROM lead_assignments la
JOIN leads l ON la.lead_id = l.id
ORDER BY 
  CASE la.outcome WHEN 'pending' THEN 0 ELSE 1 END,
  la.lead_tier,
  la.created_at DESC;


-- =========================================
-- VIEW: vendor_performance
-- Stats for vendor dashboard
-- =========================================

CREATE OR REPLACE VIEW vendor_performance AS
SELECT
  v.id AS vendor_id,
  v.company_name,
  v.tier,
  v.commission_rate,
  v.leads_received,
  v.leads_responded_4hr,
  v.leads_closed,
  v.total_commission_owed,
  v.total_commission_paid,
  
  -- Computed metrics
  CASE 
    WHEN v.leads_received > 0 
    THEN ROUND((v.leads_responded_4hr::numeric / v.leads_received) * 100, 1)
    ELSE 0
  END AS response_rate_pct,
  
  CASE 
    WHEN v.leads_received > 0 
    THEN ROUND((v.leads_closed::numeric / v.leads_received) * 100, 1)
    ELSE 0
  END AS close_rate_pct,
  
  -- Last 30 days
  (SELECT COUNT(*) FROM lead_assignments 
   WHERE vendor_id = v.id 
     AND created_at > NOW() - INTERVAL '30 days') AS leads_last_30d,
   
  (SELECT COUNT(*) FROM lead_assignments 
   WHERE vendor_id = v.id 
     AND outcome = 'net_meter_activated' 
     AND outcome_updated_at > NOW() - INTERVAL '30 days') AS closes_last_30d,
  
  -- Current open
  (SELECT COUNT(*) FROM lead_assignments 
   WHERE vendor_id = v.id 
     AND outcome = 'pending') AS open_leads,
  
  -- Pending commission
  (SELECT COALESCE(SUM(commission_amount), 0) FROM lead_assignments 
   WHERE vendor_id = v.id 
     AND commission_status = 'owed') AS commission_owed_now
FROM vendors v;


COMMENT ON TABLE vendor_sessions IS 'Magic-link OTP auth + active session tokens for vendor portal';
COMMENT ON VIEW vendor_inbox IS 'Per-vendor lead inbox — open + closed leads with SLA status';
COMMENT ON VIEW vendor_performance IS 'Real-time vendor stats for portal dashboard';
