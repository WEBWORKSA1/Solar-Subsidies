# Vendor Recruitment — Operational Playbook

**Status:** Phase 1 — Manual outreach, target 5-10 signed vendors in 14 days
**Owner:** Web (solo)
**Updated:** May 19, 2026

---

## The Problem

Platform is fully built (v0.8 — calculator, KUSUM eligibility, admin dashboard, matching engine, portal). **Zero vendors signed.** Every customer lead that comes in goes to `status='unmatched_no_vendor'` until vendors are recruited.

Lead capture without vendors = wasted lead. Need to fix this before any traffic spend or SEO push.

## The Goal (14 days)

| Metric | Target |
|---|---|
| Vendors contacted | 30 |
| Demo calls held | 10 |
| Agreements signed | 5-7 |
| Districts covered (by signed vendors) | 12+ priority districts |
| KUSUM-specialist vendors signed | 2-3 |

If you hit 5 signed agreements in 14 days, you can start traffic spend.

---

## Phase 1: Build the prospect list (Day 1-2)

### Source 1: MNRE Empanelled Solar Pump Vendors (KUSUM)

**URL:** https://pmkusum.mnre.gov.in/landing.html → "Empanelled Vendors"

**What to extract per vendor:**
- Company name
- Pump brands supported
- States covered (filter: UP must be listed)
- Phone number
- Email
- Address

**Expected yield:** 30-40 vendors with UP coverage

### Source 2: UPNEDA Approved Vendor List

**URL:** https://upneda.org.in → Tender/Empanellment → Approved Vendor List PDF

**What to extract:**
- Company name
- Empanellment ID
- Specialization (rooftop / KUSUM / both)
- Districts covered
- Contact details

**Expected yield:** 200-400 entries, filter to top 100 active

### Source 3: Top National EPCs not on either list

Already have these in vendor seed:
- Tata Power Solar (1800-209-3344)
- Adani Solar
- Waaree Energies
- Vikram Solar
- Loom Solar (87-5061-7000)
- Luminous Solar
- Havells Solar (Noida HQ — easiest to reach)
- Fenice Energy
- Amplus Solar
- Freyr Energy

**Tier strategy for nationals:** These won't sign your 7-8% commission deal directly because they have their own sales channels. **Approach:** Pitch as a *lead-aggregation partner*, not a downstream vendor. They might pay flat per qualified-lead instead of revenue-share. Try later, not in Phase 1.

### Output: prospect spreadsheet columns

```
vendor_id | company_name | tier | contact_name | phone | email | 
hq_city | districts_covered | mnre_empanelled | upneda_approved | 
specialization (rooftop/kusum/both) | est_team_size | website | 
notes | contacted_date | response_status | next_followup_date | 
stage (cold/contacted/replied/demo_scheduled/demo_done/agreement_sent/signed/declined)
```

**Priority sort:**
1. Tier 1 (on both MNRE + UPNEDA lists) — 30 prospects max
2. Tier 2 (MNRE only, national) — skip until Phase 2
3. Tier 3 (UPNEDA only, regional UP) — 30 prospects max
4. KUSUM-specialist subset: anyone with "pump" or "KUSUM" in specialization

---

## Phase 2: First contact — WhatsApp + Email (Day 3-7)

### Channel choice

**Primary: WhatsApp Business.** Indian solar EPCs run on WhatsApp. Phone calls go unanswered, emails get buried. WhatsApp gets opened within 4 hours typically.

**Secondary: Email.** Send same day. Use as paper trail + for vendors that don't reply to WhatsApp in 48 hours.

### WhatsApp Template (use this — tested copy structure)

```
Hi [Name],

I'm Web, founder of SolarSubsidies.com — a UP-focused solar lead-gen 
platform that just went live.

We get inbound customer leads through SEO + paid traffic (district-level 
pages targeting "solar subsidy [district]"). Currently routing 0 leads 
because we're onboarding our first vendor cohort.

I'd like to send you 5-10 qualified leads per month in [district], on 
Pattern B (you pay us a commission only AFTER the customer signs and 
net meter activates — no upfront fees, no monthly subscription).

Quick context:
✓ Our leads come pre-qualified: bill amount, property type, timeline, 
  intent already captured
✓ Customers expect a call within 4 business hours — we measure your 
  response time
✓ Commission: 7% on rooftop installs, 5% on KUSUM (paid net-30 after 
  net meter activation)
✓ You're never locked in — you can decline any lead, leave anytime

Open to a 15-min call this week to walk you through the vendor portal?

— Web
SolarSubsidies.com
[your phone]
```

**Why this works:**
- Specific district mention (do research per vendor before sending)
- Specific lead volume (5-10/month — not "lots of leads")
- Commission structure stated upfront (no surprises later)
- Pattern B explicit (no upfront cost = lowest friction yes)
- 15-min call ask (not "30-min strategy session" — vendors hate that)
- No exclusivity ask (they keep all their other channels)

### Email Template

Subject: `Pre-qualified solar leads for [Vendor Name] — 5-10/month, [district], Pattern B`

```
Hi [Name],

Following up by email in case WhatsApp goes unread.

SolarSubsidies.com launched this month — a UP-focused solar lead-gen 
platform with 459 SEO-indexed district pages, a calculator that scores 
leads HOT/WARM/COLD, and a vendor portal that lets you accept/decline 
leads with full customer context.

What I'd like to offer [Vendor Name]:

→ 5-10 qualified leads per month in your active districts
→ 7% commission on rooftop installs (5% on KUSUM)
→ Paid net-30 AFTER net meter activation — no upfront cost ever
→ You see every lead BEFORE accepting — decline anything that doesn't fit
→ No exclusivity — you keep all your existing channels

We're onboarding our first 5-10 vendor cohort now. I'd value 15 minutes 
to show you the portal and answer questions.

When works this week? Or reply with your preferred time.

— Web
Founder, SolarSubsidies.com
[phone] | [email]

PS — A short video tour of the vendor portal is at [your tour link] 
if you want to see it before calling.
```

### Daily outreach rhythm

- **Day 3-4:** Send 15 WhatsApp messages + matching emails. Track in spreadsheet.
- **Day 5:** Send 15 more.
- **Day 6:** Follow up Day 3 batch (those who haven't replied)
- **Day 7:** Follow up Day 5 batch

**Expected response rate:** 25-40% reply within 5 days. Of those, 50% will agree to a demo call.

So 30 prospects → 10 replies → 5 demos → 2-3 signed in Phase 2.
You'll need Phase 3 (referral push) to hit 5-7 signed.

---

## Phase 3: The Demo Call (Day 7-14)

### Pre-call prep (5 min per call)

- Look up the vendor's website, identify their specialization
- Check their LinkedIn presence (legitimacy signal)
- Have a sample lead ready to show in admin dashboard
- Open the vendor portal in a separate tab

### Call structure (15 minutes)

**Minute 0-2: Open**
"Thanks for taking the call. I'll keep this to 15 minutes. The shortest 
version: we generate solar leads through SEO and ads, customers fill out 
a calculator that scores them, and you only pay us a commission AFTER 
they sign with you and net meter activates. Sound right?"

**Minute 2-7: Show the platform**
1. Open `/d/[their district].html` → "This is the page customers see"
2. Open `/calculator.html` → fill out a sample HOT lead in their district
3. Show the WhatsApp notification template (admin side)
4. Open `/vendors/portal.html` → "This is what YOU see"
5. Show the lead inbox, the accept/decline buttons, the outcome tracking

**Minute 7-10: Address objections**
Common objections + responses:
- *"How many leads will I really get?"* → "Honest answer: zero this month, 
  because we just launched and have no vendors signed. We're aiming for 
  5-10/month per vendor in active districts within 90 days as SEO ranks."
- *"What's your customer acquisition cost?"* → "We're SEO-first to keep 
  this sustainable. Once a district page ranks, leads are essentially free 
  to us — which is why we can offer 7% commission instead of the 15-20% 
  most aggregators charge."
- *"Why exclusive matching?"* → "We don't blast leads to 5 vendors at once. 
  One lead → one vendor → 24-hour SLA. You either claim or decline. If 
  declined, it reassigns to next-best fit."
- *"What if a lead doesn't convert?"* → "You pay nothing. Commission is 
  only on net meter activation."

**Minute 10-13: The ask**
"If this sounds workable, here's what I need:
1. Your MNRE empanellment number (we verify it)
2. Your UPNEDA approval number (we verify it)
3. Districts you actively serve
4. WhatsApp number you check daily
5. Bank account for commission settlements

I'll send the agreement after we verify your numbers. Net-30 payment terms, 
no commitment beyond per-lead decisions."

**Minute 13-15: Close**
"Can I send the agreement Friday?"

Three outcomes:
- "Yes, send Friday" → mark `stage=agreement_sent`
- "Need to think about it" → mark `stage=demo_done`, schedule follow-up D+3
- "Not for us" → mark `stage=declined`, ask for referral

### Always-ask referral question

End every demo call with: 
> "Even if this isn't for you, do you know 1-2 other solar installers in UP 
> who might want pre-qualified leads? Mind making a quick intro?"

Referrals from solar EPCs convert at 3-5× cold rates.

---

## Phase 4: Agreement signing (Day 10-14)

### Pre-signing checklist (you do this)
- [ ] Verify MNRE empanellment on https://pmkusum.mnre.gov.in
- [ ] Verify UPNEDA approval on https://upneda.org.in
- [ ] Confirm GSTIN active on https://gst.gov.in
- [ ] Google search for complaints / consumer forum cases
- [ ] Check their website is live and has installation portfolio

### Agreement document
Use the existing `vendors/AGREEMENT_TEMPLATE.md` from v0.5.5.

**Reminder:** That template is NOT lawyer-reviewed. Before signing real vendors, get it reviewed by an Indian lawyer (~₹15-25K, 3-5 days). Don't skip this.

### Onboarding sequence (after signed agreement returns)
1. Create vendor record in admin dashboard
2. Set `tier='probation'`, `commission_rate=7.0`, `active=true`
3. Set `kusum_specialist=true` if applicable
4. Set their coverage districts, min/max system size, capacity
5. Send them the portal login link
6. They request OTP → log in → see empty inbox
7. Send welcome WhatsApp: "You're live in [districts]. Leads will start arriving once your area gets traffic. Expect first lead within 7-14 days."

---

## Tracking Spreadsheet Template

Recommended tool: **Google Sheets** (free, shareable, accessible from phone for in-the-field updates).

### Tab 1: Prospects

| # | Vendor | Tier | Phone | Email | HQ | Districts | MNRE | UPNEDA | Spec | Contacted | Response | Stage | Next Action | Notes |
|---|--------|------|-------|-------|----|-----------| -----|--------|------|-----------|----------|-------|-------------|-------|
| 1 | (paste from MNRE list) | T1 | | | | | ✓ | ✓ | | | | cold | send WA Day 3 | |

### Tab 2: Signed Vendors

| Vendor | District focus | Tier | Commission | Sign date | First lead date | First close date | Notes |
|--------|----------------|------|------------|-----------|-----------------|------------------|-------|

### Tab 3: Referrals

| Referrer (existing vendor) | Referred to | Phone | Status |
|----------------------------|-------------|-------|--------|

---

## Risk: What if vendors won't sign?

**Likely objections in this market:**

1. **"7% is too high"** — Counter: "Justdial charges 30-40% via paid listings. Sulekha charges per-lead even if you don't close. Our 7% is paid only AFTER you close. We're net 5× cheaper at scale."

2. **"I'll wait until you have proven leads"** — Counter: "Fair. Here's what I'll do: I'll add you to the matching engine but won't charge anything for the first 30 days. First 5 leads in your district go to you free. If they don't pan out, no commitment. If they do, we sign the agreement."  
   **(This is the "Free Tier Wedge" — use for hesitant vendors in priority districts.)**

3. **"What's your monthly volume?"** — Be honest: "Currently zero — we just launched. Our forecast is 50-100 leads/month across all UP districts within 90 days as SEO ranks. Per-vendor that's 5-10/month if we onboard 10 vendors."

4. **"Why isn't this on Tata/Adani's platform?"** — Counter: "Tata and Adani don't aggregate — they push their own brands. We're district-level matching across multiple vendor brands. Customers searching 'solar subsidy Lucknow' don't want Tata's marketing page — they want an unbiased calculator. That's our wedge."

5. **"My existing channels work fine"** — Counter: "Then add us as your 5th channel, not your only one. Cost to you is zero until we deliver a closed sale. Worst case, you ignore our leads. Best case, you get incremental volume at 5× cheaper acquisition."

---

## Phase 1 success criteria (Day 14 review)

✅ 30 prospects identified and entered in spreadsheet
✅ 30 cold WA + email sent
✅ 10 demo calls completed
✅ 5-7 agreements signed and vendors onboarded in portal
✅ 12+ priority UP districts covered

If you hit this:
- Start LinkedIn ads or Google Ads → first traffic to district pages
- Submit sitemap to Google Search Console
- Begin tracking lead-to-conversion via real data

If you miss this:
- Diagnose: was it list quality, message-market fit, or pricing?
- Adjust offer (consider the "Free Tier Wedge" objection-handler)
- Try LinkedIn cold outreach as Channel 2

---

## What NOT to do during recruitment week

- ❌ Don't add more features to the platform. It's done. v0.8 has everything you need.
- ❌ Don't refine the calculator copy. It's good enough.
- ❌ Don't redesign the vendor portal. The vendors haven't seen it yet.
- ❌ Don't spend on ads before vendors sign. You'll burn money on leads that go nowhere.
- ❌ Don't onboard vendors below T3. Lowballers waste your time.

**The only thing that matters this week: signed vendor agreements.**
