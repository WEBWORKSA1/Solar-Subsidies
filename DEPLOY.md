# SolarSubsidies.com — Deployment Runbook

**Target: 90 minutes from cold start to verified-live platform.**

Follow these steps **in order**. Do not skip. Do not parallelize. If any step fails, STOP and fix before continuing.

Each step has a **verification** — do not move to the next step until verification passes.

---

## ⏱️ Time budget

| Phase | Duration | Goal |
|---|---|---|
| 1. Supabase project + migrations | 25 min | All 9 migrations applied, 32 vendor seeds visible |
| 2. WhatsApp provider setup | 15 min | One test message delivered to your phone |
| 3. Vercel env vars + redeploy | 10 min | Env vars set, deployment green |
| 4. Smoke test rooftop flow | 15 min | Test lead → admin WhatsApp fires → admin dashboard shows lead |
| 5. Smoke test KUSUM flow | 15 min | Test KUSUM lead → admin WhatsApp fires → KUSUM tab shows lead |
| 6. Activate first test vendor | 10 min | Force-assign test lead → vendor WhatsApp fires |
| **Total** | **90 min** | **Verified working platform** |

---

## Phase 1 — Supabase migrations (25 min)

### Step 1.1 — Create Supabase project (if not already done)

1. Go to https://supabase.com/dashboard
2. Click "New Project"
3. Name: `solar-subsidies-prod`
4. Database password: generate strong, save in password manager
5. Region: `ap-south-1 (Mumbai)` — lowest latency for UP users
6. Wait ~2 min for project provisioning

**Verification:** Project status shows "Active" with a green dot in dashboard.

### Step 1.2 — Get connection credentials

1. In Supabase dashboard → Project Settings → API
2. Copy these two values into a notes app:
   - **Project URL** (looks like `https://xxxxx.supabase.co`)
   - **service_role key** (NOT anon key — the service_role key is secret, do not commit anywhere)

**Verification:** Both values copied. Tab still open.

### Step 1.3 — Run migrations in order

Open SQL Editor (left sidebar in Supabase dashboard).

Run these **in this exact order**. For each one:
1. Open the file in GitHub: `https://github.com/WEBWORKSA1/Solar-Subsidies/blob/main/data/{filename}`
2. Click "Raw" to get unformatted SQL
3. Copy entire file content
4. Paste into Supabase SQL Editor
5. Click "Run"
6. Verify "Success. No rows returned" or similar — NOT a red error message

**The order:**

```
1. schema.sql
2. seed-districts.sql
3. 0004_lead_scoring.sql
4. 0005_vendor_schema.sql
5. 0006_matching_schema.sql
6. 0007_admin_views.sql
7. 0008_kusum_and_directory.sql
8. 0009_vendor_seed.sql
9. 0010_preferred_vendor.sql
```

**If any migration fails:** STOP. Most common cause: previous migration didn't complete. Re-check the previous one, fix any drift, retry.

**Verification after Phase 1.3:** Run this in SQL Editor:

```sql
-- Should return 9 numbered rows
SELECT
  (SELECT COUNT(*) FROM districts) AS districts,
  (SELECT COUNT(*) FROM leads) AS leads,
  (SELECT COUNT(*) FROM kusum_leads) AS kusum_leads,
  (SELECT COUNT(*) FROM vendors) AS vendors_total,
  (SELECT COUNT(*) FROM vendors WHERE public_listing = TRUE) AS vendors_public,
  (SELECT COUNT(*) FROM vendors WHERE active = TRUE) AS vendors_active,
  (SELECT COUNT(*) FROM vendor_applications) AS applications,
  (SELECT COUNT(*) FROM lead_assignments) AS assignments,
  (SELECT COUNT(*) FROM kusum_lead_assignments) AS kusum_assignments;
```

**Expected result:**
- `districts: 75`
- `leads: 0`
- `kusum_leads: 0`
- `vendors_total: 32`
- `vendors_public: 32`
- `vendors_active: 0` ← **This is correct.** All seed vendors are inactive until you activate them in Phase 6.
- `applications: 0`
- `assignments: 0`
- `kusum_assignments: 0`

If any count is wrong, the migration order failed. Drop the database and start over from Step 1.3.

---

## Phase 2 — WhatsApp provider setup (15 min)

Pick ONE provider. **Recommended for getting started fast: webhook (free, immediate).**

### Option A — Webhook (free, fastest setup)

Use a webhook URL that forwards to your personal WhatsApp via a service like [CallMeBot](https://www.callmebot.com/blog/free-api-whatsapp-messages/) (free, takes 5 min).

1. Add `+34 644 51 95 23` (CallMeBot's number) to your phone contacts as "CallMeBot"
2. Open WhatsApp, send: `I allow callmebot to send me messages`
3. You receive a reply with your personal API key (looks like `123456`)
4. Your webhook URL is: `https://api.callmebot.com/whatsapp.php?phone=+919XXXXXXXXX&apikey=YOUR_API_KEY&text=`

**For env vars:**
- `WHATSAPP_PROVIDER` = `webhook`
- `WHATSAPP_API_KEY` = the full URL above (yes, the entire URL goes in the API_KEY field — the system detects URLs)

**Caveat:** CallMeBot sends from a shared number, not your own business number. Fine for testing and initial launch. Migrate to AiSensy/Interakt when you sign your first paying vendor.

### Option B — AiSensy (₹2,499/mo, professional)

1. Sign up at https://www.aisensy.com
2. Onboard your own WhatsApp Business number (1-2 days approval)
3. Pre-register two templates: `vendor_lead_assigned`, `kusum_vendor_lead_assigned` (templates submitted in AiSensy dashboard, Meta approval takes 24-48 hours)
4. Get API key from AiSensy dashboard

**For env vars:**
- `WHATSAPP_PROVIDER` = `aisensy`
- `WHATSAPP_API_KEY` = AiSensy API key

### Option C — Interakt (₹2,999/mo)

Similar to AiSensy. Recommended only if you have existing Interakt account.

### Test the WhatsApp setup

Once you have credentials, send a test message via curl to verify before continuing:

**For webhook (CallMeBot):**
```bash
curl "https://api.callmebot.com/whatsapp.php?phone=+919XXXXXXXXX&apikey=YOUR_KEY&text=SolarSubsidies+test+ping"
```

**Verification:** You receive "SolarSubsidies test ping" on WhatsApp within 60 seconds.

---

## Phase 3 — Vercel env vars + redeploy (10 min)

### Step 3.1 — Generate secure tokens

Open your Mac terminal. Run:

```bash
echo "ADMIN_TOKEN=$(openssl rand -hex 32)"
echo "ADMIN_EXPORT_TOKEN=$(openssl rand -hex 32)"
echo "MATCH_INTERNAL_TOKEN=$(openssl rand -hex 32)"
```

Copy all three lines to a password manager. **You will need ADMIN_TOKEN to log into the admin dashboard.**

### Step 3.2 — Set env vars in Vercel

1. Go to https://vercel.com/dashboard
2. Open project `solar-subsidies` (or whatever you named it)
3. Settings → Environment Variables
4. Add each of the following. For each, set Environment = **Production, Preview, Development** (all three).

```
SUPABASE_URL                  = <from Phase 1.2>
SUPABASE_SERVICE_ROLE_KEY     = <from Phase 1.2>
WHATSAPP_API_KEY              = <from Phase 2>
WHATSAPP_PROVIDER             = webhook  (or aisensy/interakt)
ADMIN_PHONE                   = +91XXXXXXXXXX  (your personal phone in E.164)
ADMIN_TOKEN                   = <generated in Step 3.1>
ADMIN_EXPORT_TOKEN            = <generated in Step 3.1>
MATCH_INTERNAL_TOKEN          = <generated in Step 3.1>
PORTAL_BASE_URL               = https://solar-subsidies.vercel.app
HOT_LEAD_PHONES               = (leave blank, optional)
KUSUM_LEAD_PHONES             = (leave blank, optional)
```

### Step 3.3 — Trigger redeploy

In Vercel dashboard → Deployments → click the latest deployment → "..." menu → "Redeploy". This is required to pick up the new env vars.

**Verification:** New deployment shows green "Ready" status. Click the deployment URL — site loads.

---

## Phase 4 — Smoke test rooftop lead flow (15 min)

### Step 4.1 — Submit a test rooftop lead

1. Open `https://solar-subsidies.vercel.app/calculator.html` (or your custom domain)
2. Fill out the 4-step calculator with these HOT-tier test values:
   - **Step 1:** Monthly bill ₹5000, district `Lucknow`
   - **Step 2:** Independent home, 3-6 months timeline
   - **Step 3:** Subsidy intent
   - **Step 4:** Test Name (e.g. "Smoke Test Aman"), phone `+91XXXXXXXXXX` (use a real number you can verify), email `test@example.com`, consent both
3. Submit

**Verification 4.1:** 
- Screen shows "Thanks! Your lead is being routed..." or similar success message
- Within 30 seconds, you receive a WhatsApp on `ADMIN_PHONE` saying "🔥🔥🔥 NEW HOT LEAD (score X/10)..."

### Step 4.2 — Verify lead in Supabase

In Supabase SQL Editor:

```sql
SELECT id, name, phone, district_slug, system_size_kw, lead_score, lead_tier, status, created_at
FROM leads
ORDER BY created_at DESC
LIMIT 1;
```

**Expected:** Your test lead appears with `lead_tier = 'HOT'` (or `WARM` depending on inputs), `status = 'unmatched_no_vendor'` (since no vendor is active yet).

### Step 4.3 — Verify admin dashboard

1. Go to `https://solar-subsidies.vercel.app/admin/`
2. Paste your `ADMIN_TOKEN` (from Step 3.1)
3. Click "Authenticate →"

**Verification 4.3:**
- Dashboard loads with stats grid showing `Rooftop Leads: 1`, `Unmatched: 1`
- Click "Rooftop Leads" tab → your test lead is in the table with status `UNMATCHED`
- Click "View" on the lead → modal opens with all details
- "Force-assign" button is visible (don't click yet)

If any of these fail, check Vercel deployment logs for the `/api/admin` route.

---

## Phase 5 — Smoke test KUSUM flow (15 min)

### Step 5.1 — Submit a test KUSUM lead

1. Open `https://solar-subsidies.vercel.app/kusum/eligibility/`
2. Fill the 6-step wizard with these Component-B-eligible values:
   - **Land:** 3 acres, owned (RoR/Khasra-Khatauni)
   - **Water:** Borewell, 80 ft depth
   - **Pump:** No existing pump, no grid electricity, current irrigation rain-fed
   - **Crops:** Sugarcane
   - **Location:** District `Lucknow` (or any UP district)
   - **Contact:** Different test name, real phone you can verify, consent both
3. Submit

**Verification 5.1:**
- Screen shows "Eligible for Component B" or similar
- Within 30 seconds, WhatsApp on `ADMIN_PHONE`: "🟡 NEW KUSUM LEAD (score X/10) 🌾..."

### Step 5.2 — Verify KUSUM lead in Supabase

```sql
SELECT id, name, phone, district_slug, recommended_component, kusum_lead_tier, status, created_at
FROM kusum_leads
ORDER BY created_at DESC
LIMIT 1;
```

**Expected:** `recommended_component = 'B'`, `kusum_lead_tier` = `HOT` or `WARM`, `status = 'documents_pending'` (since no KUSUM vendor is active, the auto-router returns `no_eligible_vendors` and marks the lead for admin triage).

### Step 5.3 — Verify KUSUM tab in admin

1. In admin dashboard, click "🌾 KUSUM Leads" tab
2. KUSUM stats grid loads showing `Total KUSUM leads: 1`, `Component breakdown: B:1`
3. KUSUM lead table shows your test lead with component pill `B` and status `UNMATCHED`
4. Click "View" on the lead → KUSUM-specific modal opens (shows land, water, pump situation, recommended component, subsidy math)
5. "Auto-route to KUSUM specialist" button visible

**Verification 5.3:** All four checks pass. If the KUSUM stats grid shows zeros, check Vercel logs for `/api/admin?action=kusum-stats`.

---

## Phase 6 — Activate first test vendor + verify routing (10 min)

You'll use a seeded vendor record and modify it to point to YOUR phone, so YOU receive the test vendor WhatsApp.

### Step 6.1 — Pick a seed vendor and activate as KUSUM specialist

In Supabase SQL Editor:

```sql
-- Pick the first seed vendor for testing
SELECT id, company_name, slug, coverage_districts
FROM vendors
WHERE active = FALSE
ORDER BY company_name
LIMIT 1;
```

Note the `id` (UUID) of the first row. Then activate it as a KUSUM specialist pointing to your phone:

```sql
UPDATE vendors
SET
  active = TRUE,
  tier = 'probation',
  claim_status = 'claimed',
  phone = '+91XXXXXXXXXX',          -- YOUR phone for the test
  commission_rate = 5.0,
  handles_kusum = TRUE,
  kusum_components = ARRAY['A', 'B', 'C'],
  coverage_districts = ARRAY['lucknow', 'kanpur-nagar', 'jhansi', 'banda', 'agra']  -- include lucknow
WHERE id = '<uuid-from-above>';
```

**Verification 6.1:**

```sql
SELECT id, company_name, active, handles_kusum, phone, kusum_components
FROM vendors
WHERE id = '<uuid-from-above>';
```

Should show `active = true`, `handles_kusum = true`, your phone, components `{A,B,C}`.

### Step 6.2 — Force-assign the test KUSUM lead

1. Admin dashboard → KUSUM Leads tab
2. Click "View" on your test KUSUM lead
3. Click "Force-assign" button
4. In the modal, the test vendor you activated should appear in the KUSUM-specialist dropdown
5. Click "Assign"

**Verification 6.2:** 
- Alert shows "✅ KUSUM lead force-assigned to {VendorName}"
- Within 30 seconds, you receive WhatsApp on your phone (acting as the vendor) with the full KUSUM lead details: farmer name, land, water source, pump HP, system cost, subsidy math, commission amount, and a "Claim/decline" link

If the vendor WhatsApp does NOT fire, check:
1. Did you set the vendor's `phone` column to your real phone (with `+91` prefix)?
2. Did the assignment row get created? Run: `SELECT * FROM kusum_lead_assignments ORDER BY created_at DESC LIMIT 1;`
3. Vercel logs for `/api/admin?action=force-assign-kusum` — look for "KUSUM vendor notification error"

### Step 6.3 — Verify assignment in DB

```sql
SELECT kla.id, kla.kusum_lead_id, kla.vendor_id, v.company_name, kla.component,
       kla.commission_amount, kla.commission_status, kla.outcome, kla.expires_at
FROM kusum_lead_assignments kla
JOIN vendors v ON v.id = kla.vendor_id
ORDER BY kla.assigned_at DESC
LIMIT 1;
```

**Expected:** One row with component B (or whatever your test was), `commission_status = 'pending'`, `outcome = 'pending'`, `expires_at` 48 hours in the future.

### Step 6.4 — Roll back the test vendor

After verification passes, roll back the test vendor so it doesn't accidentally receive real leads:

```sql
UPDATE vendors
SET active = FALSE,
    handles_kusum = FALSE,
    phone = NULL,
    kusum_components = ARRAY[]::TEXT[]
WHERE id = '<uuid-from-above>';
```

---

## ✅ Deployment complete

If all 6 phases verified, your platform is **live and functional**. You can now:

1. **Move to Phase B (vendor recruitment)**: Continue the 14-day playbook in `ops/VENDOR_RECRUITMENT_PLAYBOOK.md`
2. **Onboard real vendors**: As they sign agreements, activate them in admin dashboard
3. **Drive farmer traffic**: SEO is already live; consider Google Ads on KUSUM keywords for districts where you have active vendors

---

## 🚨 Common deployment failures + fixes

### "Supabase write failed" in Vercel logs
- **Cause:** Wrong service role key (used anon key instead) OR Supabase URL has trailing slash.
- **Fix:** Re-copy from Supabase Project Settings → API. Service role key starts with `eyJ...` and is ~200 chars long.

### Admin dashboard shows 401 Unauthorized
- **Cause:** `ADMIN_TOKEN` env var not set, or different token used than what you set.
- **Fix:** Verify in Vercel env vars matches what you paste into the login screen exactly (no leading/trailing spaces).

### WhatsApp doesn't fire on lead submission
- **Cause:** Multiple possible — most common is `ADMIN_PHONE` not in E.164 format (needs `+91` prefix).
- **Fix:** Set `ADMIN_PHONE` to `+91XXXXXXXXXX` (12 digits total including the +91). Redeploy after changing env var.

### KUSUM tab is blank
- **Cause:** Migrations 0008 didn't fully apply, or `kusum_dashboard` view doesn't exist.
- **Fix:** Run `SELECT * FROM kusum_dashboard LIMIT 1;` in Supabase SQL Editor. If error "relation does not exist", re-run `0008_kusum_and_directory.sql`.

### "No KUSUM vendor available" even after activating one
- **Cause:** Vendor's `coverage_districts` array doesn't include the lead's district slug, or `kusum_components` doesn't include the lead's recommended component.
- **Fix:** Check the lead: `SELECT district_slug, recommended_component FROM kusum_leads ORDER BY created_at DESC LIMIT 1;` then check vendor matches both.

---

## After deployment: production hardening checklist

Lower priority but should be done within 7 days:

- [ ] Custom domain pointing to Vercel (currently solar-subsidies.vercel.app)
- [ ] Vercel cron job for `/api/reassign-expired-leads` (24hr / 48hr reassignment automation)
- [ ] Sentry or LogRocket for error tracking (Vercel free logs are insufficient)
- [ ] Supabase backups enabled (Project Settings → Database → Point-in-time Recovery, ₹2000/mo)
- [ ] Move WhatsApp from CallMeBot (free) to AiSensy or Interakt (₹2,499-2,999/mo) before signing 5+ real vendors
- [ ] AGREEMENT_TEMPLATE.md reviewed by Indian lawyer (~₹15-25K, 3-5 days)
