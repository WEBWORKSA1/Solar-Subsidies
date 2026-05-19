# Database Migrations — SolarSubsidies.com

**Run order matters.** Migrations must be applied in numerical order.

## Canonical migration sequence (run in Supabase SQL Editor)

```
1. schema.sql                        Original base tables
2. seed-districts.sql                75 UP districts seeded
3. 0004_lead_scoring.sql             Lead scoring fields on leads table
4. 0005_vendor_schema.sql            vendors + vendor_applications + lead_assignments
5. 0006_matching_schema.sql          vendor_sessions + matching views + assignment expiry
6. 0007_admin_views.sql              Admin dashboard SQL views
7. 0008_kusum_and_directory.sql      KUSUM tables + vendor directory columns + listing tier
8. 0009_vendor_seed.sql              Seeds 32 UP vendors (all as 'unverified_listing', active=FALSE)
9. 0010_preferred_vendor.sql         preferred_vendor_slug column on leads
```

## Critical reminders

### `0008_kusum_and_directory.sql` is the CANONICAL KUSUM schema

This migration creates the `kusum_leads`, `kusum_lead_assignments` tables AND the
`vendors` directory columns (`slug`, `public_listing`, `claim_status`, `handles_kusum`,
`kusum_components`, `listing_description`, etc).

Three orphan migrations (0008_vendor_directory.sql, 0008_kusum_vendor_directory.sql,
0009_kusum_schema.sql) were deleted on 2026-05-19 due to schema conflicts.
DO NOT recreate them.

### `0009_vendor_seed.sql` seeds vendors as UNCLAIMED LISTINGS

All 32 seeded vendors have:
- `active = FALSE`        → not in lead matching
- `tier = 'unverified_listing'`
- `claim_status = 'unclaimed'`
- `public_listing = TRUE` → appears in /vendors/directory/

This is intentional. Real vendors must claim + verify before receiving leads.
As vendors apply via /vendors/apply.html and pass admin review, manually update
their records: `claim_status='claimed'`, `active=TRUE`, `tier='probation'`.

## API ↔ Schema mapping reference

The KUSUM lead API (`api/kusum-lead.js`) writes to `kusum_leads` using these
column mappings (frontend payload → canonical DB column):

| Frontend payload field           | DB column                          | Notes |
|----------------------------------|------------------------------------|-------|
| land_area_acres                  | land_owned_acres                   | direct |
| primary_crop                     | primary_crops                      | TEXT |
| current_irrigation_source        | pump_situation (mapped enum)       | rain_fed→no_pump, electric_pump_grid→electric_grid_pump, etc. |
| water_source_type                | water_source (mapped enum)         | pond/river→pond_river, none→unsure |
| water_table_depth_ft             | water_depth_ft                     | direct |
| existing_pump_hp                 | pump_hp                            | direct |
| current_electricity_bill_inr_per_month | current_electricity_bill_monthly | direct |
| recommended_component            | recommended_component (mapped)     | INELIGIBLE→ineligible |
| benchmark_cost_inr               | estimated_gross_cost               | rounded to INT |
| subsidy_central_inr              | estimated_subsidy_central          | rounded |
| subsidy_state_inr                | estimated_subsidy_state            | rounded |
| farmer_share_total_inr           | estimated_farmer_contribution      | rounded |
| farmer_loan_eligible_inr         | estimated_loan_eligible            | rounded |
| payback_years                    | estimated_payback_years            | direct |
| estimated_annual_benefit_inr     | estimated_diesel_savings_annual    | closest match |
| lead_score (computed in API)     | kusum_lead_score                   | distinct from rooftop |
| lead_tier (computed in API)      | kusum_lead_tier                    | distinct from rooftop |

Anything else (applicant_type, land_type, eligible_components,
recommended_pump_hp, distance_to_substation_km, priority_quota) is preserved
in `calculator_snapshot` JSONB for future analysis.

## When to run migrations 0008+

After confirming earlier migrations succeeded:

1. **Test on a staging Supabase project first if possible.** Anthropic's free
   tier allows 2 free projects.
2. Run `0008_kusum_and_directory.sql` — creates KUSUM tables + ALTERs vendors table
3. Run `0009_vendor_seed.sql` — INSERTs 32 vendor rows
4. Verify: `SELECT COUNT(*) FROM vendors WHERE public_listing = TRUE;` → should be 32
5. Run `0010_preferred_vendor.sql` — adds `preferred_vendor_slug` column to `leads`

## After all migrations run

To activate the first real vendor (after they apply + verify):

```sql
UPDATE vendors
SET active = TRUE,
    tier = 'probation',
    claim_status = 'claimed',
    phone = '+91xxxxxxxxxx',     -- real contact phone for WhatsApp routing
    commission_rate = 7.0
WHERE slug = 'vendor-slug-here';
```

Until at least one vendor is `active=TRUE` for a given district, leads in that
district will receive `status='unmatched_no_vendor'`.

## Env vars required after migrations

In Vercel project settings:

```
SUPABASE_URL                  Supabase project URL
SUPABASE_SERVICE_ROLE_KEY     Service role key (NOT anon key)
WHATSAPP_API_KEY              From your WA provider
WHATSAPP_PROVIDER             aisensy | interakt | msg91 | webhook
ADMIN_PHONE                   E.164 format (e.g. +919876543210)
ADMIN_TOKEN                   Random 32-char hex (for /admin/ dashboard)
ADMIN_EXPORT_TOKEN            Random 32-char hex (for /api/leads-export)
MATCH_INTERNAL_TOKEN          Random 32-char hex (protects /api/match-lead)
PORTAL_BASE_URL               e.g. https://solarsubsidies.com
HOT_LEAD_PHONES               (optional) Comma-separated escalation phones
KUSUM_LEAD_PHONES             (optional) Comma-separated KUSUM escalation
MSG91_INTEGRATED_NUMBER       (only if WHATSAPP_PROVIDER=msg91)
```

Generate tokens with: `openssl rand -hex 32`
