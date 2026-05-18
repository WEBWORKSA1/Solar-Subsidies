# SolarSubsidies.com — v0.1 Launch Package

**Status:** v0.1 single-page deployable. Production-ready frontend with working calculator. Live on Vercel.

---

## ✅ WHAT'S IN v0.1

A complete, deployable static site (`index.html`) with:

- **Hero section** — bold editorial design, ₹1,08,000 stacked subsidy showcase
- **Working subsidy calculator** — real PM Surya Ghar + state subsidy math, 10 states pre-loaded, instant results
- **4 schemes section** — PM Surya Ghar, UPNEDA, PM-KUSUM, UP Solar Policy
- **Top 3 vendors for rural UP** — Ujala Solar, Tata Power Solar, Waaree
- **Comparison table** — 1/2/3/5/10 kW with full subsidy stack math
- **Lead capture form** — UI-complete, backend hook pending
- **SEO-ready** — meta tags, semantic HTML, mobile responsive
- **Aesthetic:** Editorial/magazine meets utility — Fraunces display serif, JetBrains Mono, paper-warm palette with sun-orange accent

---

## 🚀 DEPLOYMENT

This repo auto-deploys to Vercel on push to `main`. Connect at vercel.com → Import → `WEBWORKSA1/Solar-Subsidies`.

After Vercel import:
1. **Settings → Domains** → add `solarsubsidies.com` and `www.solarsubsidies.com`
2. Point DNS A record to `76.76.21.21` at your registrar
3. SSL auto-provisions within 1-2 hours of DNS propagation

---

## 🔥 v0.2 — NEXT 7 DAYS (Build Order)

### Day 1-2: Lead capture wired up
- Create Supabase project (free tier fine for now)
- Run schema below
- Replace `captureLead()` function with actual fetch to Supabase REST
- Add MSG91 or AiSensy WhatsApp Business webhook

### Day 3-4: District pages
- Migrate to Next.js 14
- Generate 75 UP district pages programmatically
- Each page: district-specific irradiance, DISCOM mapping, local tariff, 3 nearest vendors

### Day 5-6: KUSUM flow
- Separate `/kusum` route with eligibility wizard
- Land area → pump HP → component routing
- Generate eligibility PDF (jsPDF)

### Day 7: Analytics + SEO
- PostHog setup
- Google Search Console verification
- Submit sitemap
- JSON-LD schema markup

---

## 💾 SUPABASE SCHEMA

```sql
create table states (
  code text primary key,
  name text not null,
  name_hi text,
  per_kw_subsidy int default 0,
  subsidy_cap int default 0
);

create table discoms (
  id serial primary key,
  state_code text references states(code),
  name text not null,
  coverage text,
  residential_tariff_per_unit numeric
);

create table districts (
  id serial primary key,
  state_code text references states(code),
  name text not null,
  name_hi text,
  slug text unique,
  discom_id int references discoms(id),
  irradiance_kwh_m2 numeric default 5.0,
  population int,
  rural_percent numeric
);

create table vendors (
  id serial primary key,
  name text not null,
  slug text unique,
  type text,
  hq_city text,
  founded_year int,
  mnre_empanelled boolean default false,
  systems_installed int,
  warranty_years int default 25,
  helpline text,
  website text,
  rural_focus_score int default 5
);

create table leads (
  id uuid default gen_random_uuid() primary key,
  name text,
  phone text,
  email text,
  state_code text references states(code),
  district_id int references districts(id),
  system_size_kw numeric,
  monthly_bill int,
  property_type text,
  status text default 'new',
  calculator_snapshot jsonb,
  created_at timestamptz default now()
);

create table kusum_leads (
  id uuid default gen_random_uuid() primary key,
  farmer_name text,
  mobile text,
  state_code text references states(code),
  district_id int references districts(id),
  land_acres numeric,
  current_pump text,
  pump_hp_required numeric,
  kusum_component text,
  estimated_subsidy int,
  status text default 'new',
  created_at timestamptz default now()
);

insert into states (code, name, name_hi, per_kw_subsidy, subsidy_cap) values
('up', 'Uttar Pradesh', 'उत्तर प्रदेश', 15000, 30000),
('gj', 'Gujarat', 'ગુજરાત', 0, 40000),
('dl', 'Delhi', 'दिल्ली', 0, 10000),
('mh', 'Maharashtra', 'महाराष्ट्र', 0, 0);

alter table leads enable row level security;
create policy "Anyone can submit leads" on leads for insert with check (true);
create policy "Admin read leads" on leads for select using (auth.role() = 'service_role');
```

---

## 💰 MONETIZATION HOOKS (v0.2)

### Channel partner programs to onboard:
- Tata Power Solar — tatapowersolar.com/become-a-channel-partner
- Waaree — waaree.com/dealership
- Adani Solar — adanisolar.com/partner
- SolarSquare — direct outreach via LinkedIn

### Affiliate programs:
- SBI Solar Loan
- Tata Capital
- HDFC Bank solar financing
- Aditya Birla Capital

### AdSense:
`pub-6620975821265271` only on blog/glossary pages, never calculator/result pages.

---

## 📊 TARGETS

| Metric | Day 30 | Day 90 |
|---|---|---|
| Unique visitors | 500 | 5,000 |
| Calculator completions | 50 | 1,000 |
| Lead submissions | 5 | 150 |
| Indexed pages | 50 | 800 |
| Revenue | ₹0 | ₹15-40k |

---

**Owned by Webworks Media Network · Built May 2026**
