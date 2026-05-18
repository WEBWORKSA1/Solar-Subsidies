-- Migration 0007: v0.6.5 admin dashboard views
-- Run in Supabase SQL Editor after deploying admin dashboard

-- =========================================
-- VIEW: admin_leads_overview
-- Every lead with its current assignment (if any) + vendor info
-- =========================================

CREATE OR REPLACE VIEW admin_leads_overview AS
SELECT
  l.id AS lead_id,
  l.created_at AS lead_created_at,
  l.name AS customer_name,
  l.phone AS customer_phone,
  l.email AS customer_email,
  l.district_slug,
  l.system_size_kw,
  l.monthly_bill,
  l.property_type,
  l.intent,
  l.timeline,
  l.lead_score,
  l.lead_tier,
  l.status AS lead_status,
  l.source,
  l.consent_whatsapp,
  l.calculator_snapshot,
  
  -- Current assignment (most recent if multiple due to reassignment)
  la.id AS assignment_id,
  la.created_at AS assigned_at,
  la.expires_at AS assignment_expires_at,
  la.outcome,
  la.response_time_minutes,
  la.commission_status,
  la.commission_amount,
  la.commission_rate,
  la.reassign_count,
  la.declined_reason,
  
  -- Vendor info
  v.id AS vendor_id,
  v.company_name AS vendor_name,
  v.phone AS vendor_phone,
  v.tier AS vendor_tier,
  
  -- Computed status
  CASE
    WHEN l.status = 'unmatched_no_vendor' THEN 'UNMATCHED'
    WHEN la.id IS NULL THEN 'NEW'
    WHEN la.outcome = 'pending' AND la.expires_at < NOW() THEN 'EXPIRED'
    WHEN la.outcome = 'pending' THEN 'AWAITING_VENDOR'
    WHEN la.outcome IN ('declined_by_vendor', 'declined_by_customer', 'lost_to_competitor', 'no_response') THEN 'DEAD'
    WHEN la.outcome = 'net_meter_activated' THEN 'CLOSED_WON'
    ELSE 'IN_PROGRESS'
  END AS computed_status
FROM leads l
LEFT JOIN LATERAL (
  SELECT * FROM lead_assignments
  WHERE lead_id = l.id
  ORDER BY created_at DESC
  LIMIT 1
) la ON true
LEFT JOIN vendors v ON la.vendor_id = v.id
ORDER BY l.created_at DESC;


-- =========================================
-- VIEW: admin_commissions
-- All commission rows with vendor + lead context
-- =========================================

CREATE OR REPLACE VIEW admin_commissions AS
SELECT
  la.id AS assignment_id,
  la.commission_status,
  la.commission_amount,
  la.commission_rate,
  la.gross_system_value,
  la.system_size_kw,
  la.net_meter_activated_at,
  la.commission_invoiced_at,
  la.commission_paid_at,
  la.outcome,
  
  l.id AS lead_id,
  l.name AS customer_name,
  l.district_slug,
  l.created_at AS lead_created_at,
  
  v.id AS vendor_id,
  v.company_name AS vendor_name,
  v.phone AS vendor_phone,
  v.tier AS vendor_tier,
  
  CASE
    WHEN la.commission_status = 'paid' THEN 0
    WHEN la.commission_status = 'owed' AND la.commission_invoiced_at IS NULL THEN 1   -- to invoice
    WHEN la.commission_status = 'invoiced' THEN
      EXTRACT(DAY FROM NOW() - la.commission_invoiced_at)::int   -- days overdue
    ELSE NULL
  END AS days_or_action
FROM lead_assignments la
JOIN leads l ON la.lead_id = l.id
JOIN vendors v ON la.vendor_id = v.id
WHERE la.commission_status IN ('owed', 'invoiced', 'paid', 'disputed')
ORDER BY 
  CASE la.commission_status 
    WHEN 'owed' THEN 1 
    WHEN 'invoiced' THEN 2 
    WHEN 'disputed' THEN 3 
    WHEN 'paid' THEN 4 
  END,
  la.net_meter_activated_at DESC;


-- =========================================
-- VIEW: admin_coverage_map
-- For each district: how many vendors cover it, total weekly capacity, recent lead volume
-- =========================================

CREATE OR REPLACE VIEW admin_coverage_map AS
WITH district_list AS (
  -- Get all districts that have ever had a lead OR are explicitly covered by a vendor
  SELECT DISTINCT district_slug FROM leads WHERE district_slug IS NOT NULL
  UNION
  SELECT DISTINCT unnest(coverage_districts) FROM vendors WHERE active = TRUE
),
vendor_counts AS (
  SELECT 
    unnest(coverage_districts) AS district_slug,
    COUNT(*) AS vendor_count,
    SUM(lead_capacity_per_week) AS total_weekly_capacity,
    COUNT(*) FILTER (WHERE tier = 'premium') AS premium_count,
    COUNT(*) FILTER (WHERE tier = 'standard') AS standard_count,
    COUNT(*) FILTER (WHERE tier = 'probation') AS probation_count
  FROM vendors
  WHERE active = TRUE
  GROUP BY 1
),
lead_volume AS (
  SELECT 
    district_slug,
    COUNT(*) AS leads_total,
    COUNT(*) FILTER (WHERE created_at > NOW() - INTERVAL '30 days') AS leads_30d,
    COUNT(*) FILTER (WHERE lead_tier = 'HOT') AS hot_leads,
    COUNT(*) FILTER (WHERE status = 'unmatched_no_vendor') AS unmatched
  FROM leads
  WHERE district_slug IS NOT NULL
  GROUP BY 1
)
SELECT
  d.district_slug,
  COALESCE(vc.vendor_count, 0) AS vendor_count,
  COALESCE(vc.premium_count, 0) AS premium_count,
  COALESCE(vc.standard_count, 0) AS standard_count,
  COALESCE(vc.probation_count, 0) AS probation_count,
  COALESCE(vc.total_weekly_capacity, 0) AS weekly_capacity,
  COALESCE(lv.leads_total, 0) AS leads_total,
  COALESCE(lv.leads_30d, 0) AS leads_30d,
  COALESCE(lv.hot_leads, 0) AS hot_leads,
  COALESCE(lv.unmatched, 0) AS unmatched_count,
  CASE
    WHEN COALESCE(vc.vendor_count, 0) = 0 AND COALESCE(lv.leads_total, 0) > 0 THEN 'GAP_HOT'      -- has leads, no vendor
    WHEN COALESCE(vc.vendor_count, 0) = 0 THEN 'GAP'                                                -- no vendor, no leads yet
    WHEN COALESCE(vc.vendor_count, 0) = 1 THEN 'SINGLE'                                             -- only one vendor
    WHEN COALESCE(lv.leads_30d, 0) > COALESCE(vc.total_weekly_capacity, 0) * 4 THEN 'OVERLOADED'   -- demand exceeds supply
    ELSE 'OK'
  END AS coverage_status
FROM district_list d
LEFT JOIN vendor_counts vc ON d.district_slug = vc.district_slug
LEFT JOIN lead_volume lv ON d.district_slug = lv.district_slug
ORDER BY
  CASE 
    WHEN COALESCE(vc.vendor_count, 0) = 0 AND COALESCE(lv.leads_total, 0) > 0 THEN 1
    WHEN COALESCE(lv.leads_30d, 0) > COALESCE(vc.total_weekly_capacity, 0) * 4 THEN 2
    WHEN COALESCE(vc.vendor_count, 0) = 0 THEN 3
    WHEN COALESCE(vc.vendor_count, 0) = 1 THEN 4
    ELSE 5
  END,
  COALESCE(lv.leads_30d, 0) DESC;


-- =========================================
-- VIEW: admin_dashboard_stats
-- Top-level numbers for dashboard summary
-- =========================================

CREATE OR REPLACE VIEW admin_dashboard_stats AS
SELECT
  -- Lead stats
  (SELECT COUNT(*) FROM leads) AS total_leads,
  (SELECT COUNT(*) FROM leads WHERE created_at > NOW() - INTERVAL '24 hours') AS leads_24h,
  (SELECT COUNT(*) FROM leads WHERE created_at > NOW() - INTERVAL '7 days') AS leads_7d,
  (SELECT COUNT(*) FROM leads WHERE created_at > NOW() - INTERVAL '30 days') AS leads_30d,
  (SELECT COUNT(*) FROM leads WHERE lead_tier = 'HOT') AS hot_total,
  (SELECT COUNT(*) FROM leads WHERE status = 'unmatched_no_vendor') AS unmatched_count,
  
  -- Vendor stats
  (SELECT COUNT(*) FROM vendors WHERE active = TRUE) AS active_vendors,
  (SELECT COUNT(*) FROM vendors WHERE tier = 'premium' AND active = TRUE) AS premium_vendors,
  (SELECT COUNT(*) FROM vendors WHERE tier = 'standard' AND active = TRUE) AS standard_vendors,
  (SELECT COUNT(*) FROM vendors WHERE tier = 'probation' AND active = TRUE) AS probation_vendors,
  (SELECT COUNT(*) FROM vendor_applications WHERE status = 'pending_review') AS pending_applications,
  
  -- Assignment stats
  (SELECT COUNT(*) FROM lead_assignments WHERE outcome = 'pending' AND expires_at > NOW()) AS open_assignments,
  (SELECT COUNT(*) FROM lead_assignments WHERE outcome = 'pending' AND expires_at < NOW()) AS expired_assignments,
  (SELECT COUNT(*) FROM lead_assignments WHERE outcome = 'net_meter_activated') AS closed_won_total,
  (SELECT COUNT(*) FROM lead_assignments WHERE outcome = 'net_meter_activated' AND outcome_updated_at > NOW() - INTERVAL '30 days') AS closed_won_30d,
  
  -- Money
  (SELECT COALESCE(SUM(commission_amount), 0) FROM lead_assignments WHERE commission_status = 'owed') AS commission_owed,
  (SELECT COALESCE(SUM(commission_amount), 0) FROM lead_assignments WHERE commission_status = 'invoiced') AS commission_invoiced,
  (SELECT COALESCE(SUM(commission_amount), 0) FROM lead_assignments WHERE commission_status = 'paid') AS commission_paid,
  (SELECT COALESCE(SUM(commission_amount), 0) FROM lead_assignments WHERE commission_status = 'paid' AND commission_paid_at > NOW() - INTERVAL '30 days') AS commission_paid_30d,
  
  -- Conversion
  (SELECT 
    CASE 
      WHEN COUNT(*) > 0 THEN ROUND(100.0 * COUNT(*) FILTER (WHERE outcome = 'net_meter_activated') / COUNT(*), 2)
      ELSE 0
    END
   FROM lead_assignments) AS overall_close_rate_pct;


-- =========================================
-- VIEW: admin_vendor_health
-- Each vendor with computed health flags
-- =========================================

CREATE OR REPLACE VIEW admin_vendor_health AS
SELECT
  v.id,
  v.company_name,
  v.contact_name,
  v.phone,
  v.email,
  v.tier,
  v.commission_rate,
  v.active,
  v.created_at,
  v.agreement_signed_at,
  array_length(v.coverage_districts, 1) AS district_count,
  v.coverage_districts,
  v.lead_capacity_per_week,
  v.leads_received,
  v.leads_responded_4hr,
  v.leads_closed,
  v.total_commission_owed,
  v.total_commission_paid,
  
  CASE 
    WHEN v.leads_received > 0 THEN ROUND((v.leads_responded_4hr::numeric / v.leads_received) * 100, 1)
    ELSE NULL 
  END AS response_rate_pct,
  
  CASE 
    WHEN v.leads_received > 0 THEN ROUND((v.leads_closed::numeric / v.leads_received) * 100, 1)
    ELSE NULL 
  END AS close_rate_pct,
  
  -- Health flags
  CASE
    WHEN v.active = FALSE THEN 'INACTIVE'
    WHEN v.agreement_signed_at IS NULL THEN 'NO_AGREEMENT'
    WHEN v.leads_received = 0 AND v.created_at < NOW() - INTERVAL '14 days' THEN 'ZERO_LEADS_14D'
    WHEN v.leads_received >= 10 AND (v.leads_responded_4hr::numeric / v.leads_received) < 0.5 THEN 'POOR_RESPONSE'
    WHEN v.leads_received >= 10 AND (v.leads_closed::numeric / v.leads_received) < 0.05 THEN 'POOR_CLOSE'
    WHEN v.tier = 'probation' AND v.created_at < NOW() - INTERVAL '6 months' THEN 'TIER_REVIEW_DUE'
    ELSE 'OK'
  END AS health_flag,
  
  -- Current open leads
  (SELECT COUNT(*) FROM lead_assignments 
   WHERE vendor_id = v.id AND outcome = 'pending') AS open_leads_now,
  
  -- Stale leads (assigned but no response in 12+ hours)
  (SELECT COUNT(*) FROM lead_assignments 
   WHERE vendor_id = v.id 
     AND outcome = 'pending'
     AND response_time_minutes IS NULL
     AND created_at < NOW() - INTERVAL '12 hours') AS stale_leads
FROM vendors v
ORDER BY 
  CASE 
    WHEN v.active = FALSE THEN 4
    WHEN v.tier = 'premium' THEN 1
    WHEN v.tier = 'standard' THEN 2
    WHEN v.tier = 'probation' THEN 3
  END,
  v.created_at DESC;


COMMENT ON VIEW admin_leads_overview IS 'All leads with current assignment + vendor + computed status. Powers admin /leads tab.';
COMMENT ON VIEW admin_commissions IS 'Commission ledger across all assignments. Powers admin /commissions tab.';
COMMENT ON VIEW admin_coverage_map IS 'Per-district vendor coverage + lead volume. Identifies gaps and overload.';
COMMENT ON VIEW admin_dashboard_stats IS 'Top-of-dashboard summary numbers.';
COMMENT ON VIEW admin_vendor_health IS 'Per-vendor health flags. Identifies vendors needing intervention.';
