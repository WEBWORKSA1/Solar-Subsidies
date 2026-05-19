-- Migration 0010: v0.9 lead routing logic — preferred vendor tracking
-- Run in Supabase SQL Editor after deploying v0.9

-- =========================================
-- Add preferred_vendor_slug to leads
-- =========================================
-- Captured when customer arrives from /vendors/{slug}.html and submits via calculator.
-- Matching engine reads this field and honors customer's choice if vendor is eligible.

ALTER TABLE leads
  ADD COLUMN IF NOT EXISTS preferred_vendor_slug TEXT;

CREATE INDEX IF NOT EXISTS idx_leads_preferred_vendor 
  ON leads (preferred_vendor_slug) 
  WHERE preferred_vendor_slug IS NOT NULL;

-- =========================================
-- (Already added in 0006) lead_assignments.assignment_method 
-- now also accepts 'preferred' value.
-- 
-- If you have a CHECK constraint on assignment_method, update it:
-- =========================================
-- Check whether constraint exists and update:
DO $$ 
BEGIN
  -- Drop old constraint if it exists and rebuild with 'preferred' added
  IF EXISTS (
    SELECT 1 FROM information_schema.constraint_column_usage 
    WHERE table_name = 'lead_assignments' 
      AND constraint_name LIKE '%assignment_method%'
  ) THEN
    ALTER TABLE lead_assignments DROP CONSTRAINT IF EXISTS lead_assignments_assignment_method_check;
  END IF;
END $$;

-- Recreate constraint with all valid values
ALTER TABLE lead_assignments 
  DROP CONSTRAINT IF EXISTS lead_assignments_assignment_method_check;

ALTER TABLE lead_assignments
  ADD CONSTRAINT lead_assignments_assignment_method_check
  CHECK (assignment_method IS NULL OR assignment_method IN ('auto', 'manual', 'reassign', 'preferred'));


-- =========================================
-- VIEW: preferred_vendor_conversion
-- Track how often customer's preferred vendor was actually honored vs fallback
-- =========================================

CREATE OR REPLACE VIEW preferred_vendor_conversion AS
SELECT
  l.preferred_vendor_slug,
  v_preferred.company_name AS preferred_vendor_name,
  v_assigned.company_name AS assigned_vendor_name,
  la.assignment_method,
  CASE
    WHEN la.assignment_method = 'preferred' THEN 'honored'
    WHEN la.assignment_method = 'auto' AND l.preferred_vendor_slug IS NOT NULL THEN 'fallback'
    WHEN la.assignment_method IS NULL OR l.preferred_vendor_slug IS NULL THEN 'no_preference'
    ELSE 'other'
  END AS routing_outcome,
  l.id AS lead_id,
  l.created_at AS lead_created_at,
  l.district_slug,
  l.lead_tier,
  la.outcome,
  la.commission_status,
  la.commission_amount
FROM leads l
LEFT JOIN vendors v_preferred ON v_preferred.slug = l.preferred_vendor_slug
LEFT JOIN LATERAL (
  SELECT * FROM lead_assignments
  WHERE lead_id = l.id
  ORDER BY created_at DESC
  LIMIT 1
) la ON true
LEFT JOIN vendors v_assigned ON v_assigned.id = la.vendor_id
WHERE l.preferred_vendor_slug IS NOT NULL
ORDER BY l.created_at DESC;


COMMENT ON COLUMN leads.preferred_vendor_slug IS 'Set when customer arrives from /vendors/{slug}.html. Matching engine honors this preference if vendor is active + covers district + handles system size.';
COMMENT ON VIEW preferred_vendor_conversion IS 'Tracks preferred-vendor routing outcomes (honored vs fallback) for funnel analysis.';
