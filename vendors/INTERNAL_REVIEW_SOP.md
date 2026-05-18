# Internal: Vendor Application Review SOP

**For SolarSubsidies.com admin team only. Not customer-facing.**

This document defines the manual workflow for reviewing vendor applications submitted via `/vendors/apply.html`.

---

## When you receive a vendor application alert

You'll get a WhatsApp message from `api/vendor-apply.js` formatted like:

```
⭐⭐⭐ PRIORITY 📋 NEW VENDOR APPLICATION

🏢 [Company Name]
👤 [Contact] ([Role])
📞 [Phone]
📧 [Email]
🌐 [Website]
📍 [HQ]

═══ APPROVALS ═══
MNRE: ...
UPNEDA: ...
GSTIN: ...
PAN: ...
...
App ID: [UUID]
```

---

## Step 1: Open the application in Supabase

```sql
SELECT * FROM pending_applications WHERE id = '[APP_ID]';
```

Or browse all pending:
```sql
SELECT * FROM pending_applications LIMIT 20;
```

---

## Step 2: Verify MNRE empanellment

1. Open https://mnre.gov.in
2. Search for the vendor's MNRE number
3. Confirm: name matches, status = active, expiry > 6 months away
4. **If MNRE doesn't list them → REJECT**

```sql
UPDATE vendor_applications 
SET status='rejected', reviewer_notes='MNRE empanellment not verifiable on mnre.gov.in. Vendor claims: [MNRE_NUMBER]', 
    reviewed_at=NOW(), reviewed_by='[YOUR_NAME]'
WHERE id='[APP_ID]';
```

---

## Step 3: Verify UPNEDA approved-vendor status

1. Open https://upneda.org.in (approved vendor list)
2. Search by company name AND UPNEDA number
3. Confirm: name matches, status = approved, category includes residential rooftop
4. **If UPNEDA doesn't list them → REJECT** (state subsidy disbursal will fail without this)

---

## Step 4: Verify GST status

1. Open https://services.gst.gov.in/services/searchtp (Search Taxpayer)
2. Enter GSTIN
3. Confirm:
   - Legal name matches application
   - Status = Active
   - State = Uttar Pradesh (or near-UP for border districts)
   - Business activity includes solar/electrical

**Red flags:** Cancelled GSTIN, mismatched legal name, completely unrelated business (e.g., GST under "Retail" with no solar history).

---

## Step 5: Check for consumer complaints

1. Search NCDRC: https://confonet.nic.in (Consumer Forum case search)
2. Search by vendor name and "solar"
3. UPNEDA helpdesk: call the consumer helpline and ask about the vendor's complaint record

Acceptable: 0-2 complaints with documented resolution. **Red flag:** 3+ active complaints, or any complaints involving fraud or non-installation after payment.

---

## Step 6: Cross-check install volume

Vendor claims X installs in 24 months. Verify by:

1. UPNEDA service portal — count installations linked to this vendor's UPNEDA ID
2. PM Surya Ghar portal — search for vendor's subsidies disbursed
3. Manual sanity check: if vendor claims 500+ but has team size of 4-10, that's inconsistent

**Red flag:** Discrepancy >50% between claimed and verified installs.

---

## Step 7: Lookup website (if provided)

1. Visit their website
2. Check: real address, real photos, customer testimonials with verifiable details, certifications shown
3. Run their domain through https://whois.com — domain age <6 months = caution
4. Check Google reviews of their physical address

---

## Step 8: Make the decision

### APPROVE if:
- ✓ MNRE verified
- ✓ UPNEDA verified
- ✓ GST active and matches
- ✓ ≥25 installs verifiable
- ✓ No major consumer complaints
- ✓ In-house team ≥4 people (or strong evidence of execution capacity)
- ✓ Website/online presence consistent with claims

### REJECT if:
- ✗ Cannot verify MNRE OR UPNEDA
- ✗ Install volume <25 OR cannot be verified
- ✗ Active fraud complaints
- ✗ Inconsistent claims (e.g., 500 installs but team of 2)
- ✗ Cancelled GSTIN
- ✗ Suspected reseller (no actual installation capacity)

### REQUEST MORE INFO if:
- Borderline volume (25-30 installs claimed but only 18 verifiable)
- Website unclear
- Specific district claim seems too broad
- Notes mention unusual circumstance worth clarifying

---

## Step 9A: To APPROVE — promote to vendors table

```sql
-- Step 9A.1: Update application status
UPDATE vendor_applications 
SET status='approved', 
    reviewer_notes='[Your verification notes — MNRE/UPNEDA confirmed, install volume verified at X via UPNEDA portal]',
    reviewed_at=NOW(), 
    reviewed_by='[YOUR_NAME]'
WHERE id='[APP_ID]';

-- Step 9A.2: Promote to vendors table
INSERT INTO vendors (
  application_id, company_name, brand_name, contact_name, phone, email, website, hq,
  mnre_number, upneda_number, gstin, pan,
  commission_rate, tier, active,
  coverage_districts, min_system_size_kw, property_types, lead_capacity_per_week
)
SELECT 
  id, company_name, brand_name, contact_name, phone, email, website, hq,
  mnre_number, upneda_number, gstin, pan,
  7.0, 'probation', TRUE,
  coverage_districts, min_system_size_kw, property_types, 
  CASE lead_capacity_per_week
    WHEN '1-3' THEN 3
    WHEN '4-10' THEN 8
    WHEN '11-25' THEN 18
    WHEN '26-50' THEN 38
    ELSE 50 
  END
FROM vendor_applications 
WHERE id='[APP_ID]';
```

**Then:**

1. Send approval WhatsApp manually (until v0.6 vendor portal exists)
2. Email the agreement template from `vendors/AGREEMENT_TEMPLATE.md` with all [PLACEHOLDERS] filled in
3. Schedule 30-min onboarding call (Calendly link: TBD)
4. Add to vendor network WhatsApp group
5. Update agreement signed timestamp after signature received:

```sql
UPDATE vendors 
SET agreement_signed_at=NOW(), 
    agreement_version='1.0',
    onboarding_call_at='[DATE]'
WHERE application_id='[APP_ID]';
```

---

## Step 9B: To REJECT — record reason

```sql
UPDATE vendor_applications 
SET status='rejected', 
    reviewer_notes='[Specific reason — e.g., "MNRE empanellment number not found on mnre.gov.in as of [DATE]"]',
    reviewed_at=NOW(), 
    reviewed_by='[YOUR_NAME]'
WHERE id='[APP_ID]';
```

Send polite rejection WhatsApp manually:

```
Hi [contact_name],

Thank you for applying to the SolarSubsidies.com vendor network.

After reviewing your application (ID: [APP_ID]), we're unable to approve at this time. Reason: [specific verifiable reason].

You're welcome to reapply once [specific actionable item] is resolved.

— Team SolarSubsidies.com
```

---

## Step 9C: To REQUEST MORE INFO

```sql
UPDATE vendor_applications 
SET status='under_review', 
    reviewer_notes='Awaiting: [specific info needed]',
    reviewed_at=NOW(), 
    reviewed_by='[YOUR_NAME]'
WHERE id='[APP_ID]';
```

WhatsApp them specifically what you need.

---

## Time budget per application

- Quick reject (clear red flag): 5 minutes
- Standard approve: 25-35 minutes
- Complex (need to dig into UPNEDA records): 45-60 minutes
- Borderline rejection (give them benefit of doubt): 30-40 minutes

**Goal: All applications decisioned within 72 hours.**

---

## Useful Supabase queries for ops

```sql
-- Pending applications by priority
SELECT id, company_name, contact_name, phone, created_at,
       array_length(coverage_districts, 1) AS districts,
       installs_completed, auto_flags
FROM vendor_applications 
WHERE status='pending_review'
ORDER BY 
  (auto_flags->>'priorityReview')::boolean DESC NULLS LAST,
  created_at ASC;

-- All approved vendors with district counts
SELECT * FROM vendor_dashboard;

-- Vendors covering a specific district
SELECT company_name, contact_name, phone, tier, lead_capacity_per_week
FROM vendors 
WHERE 'lucknow' = ANY(coverage_districts)
  AND active = TRUE
ORDER BY tier, leads_received DESC;

-- Districts with no active vendors (coverage gaps)
SELECT d.slug, d.name
FROM (SELECT DISTINCT unnest(coverage_districts) AS slug FROM vendors WHERE active=TRUE) v
RIGHT JOIN (SELECT slug, name FROM (
  SELECT 'lucknow' AS slug, 'Lucknow' AS name UNION ALL
  SELECT 'agra', 'Agra' UNION ALL
  -- Add all 75 districts...
  SELECT 'jhansi', 'Jhansi'
) all_districts) d ON v.slug = d.slug
WHERE v.slug IS NULL;
```

---

## v0.6 plans (not built yet)

When vendor portal arrives, much of this becomes automated:
- Auto-MNRE check via web scraping mnre.gov.in
- Auto-UPNEDA check via API (if UPNEDA publishes one)
- Auto-GST verification via GSP API
- Self-service vendor onboarding for verified applications
- E-signature integration with Zoho Sign

For now: manual review keeps quality control tight while volume is low (<20 applications/week).
