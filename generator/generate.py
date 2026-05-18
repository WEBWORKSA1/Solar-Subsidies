#!/usr/bin/env python3
"""
SolarSubsidies.com — Programmatic Page Generator
Generates: 75 district pages + 375 district-size pages + 6 DISCOM pages + 2 index pages + sitemap.xml = 459 files

Run by Vercel at deploy time via build.sh, or manually:
  python3 generator/generate.py
"""

import json
import os
from datetime import date

BASE = os.path.dirname(os.path.abspath(__file__))
DATA_DIR = os.path.join(BASE, '..', 'data')
OUT_DIR = os.path.join(BASE, '..', 'output')

with open(os.path.join(DATA_DIR, 'districts-up.json')) as f:
    districts_data = json.load(f)
with open(os.path.join(DATA_DIR, 'subsidies.json')) as f:
    subsidies_data = json.load(f)

DISTRICTS = districts_data['districts']
DISCOMS = districts_data['discoms']

def pm_surya_ghar_subsidy(kw):
    if kw <= 0: return 0
    if kw >= 3: return 78000
    if kw <= 1: return int(kw * 30000)
    if kw <= 2: return int(30000 + (kw - 1) * 30000)
    return int(60000 + (kw - 2) * 18000)

def state_subsidy_up(kw):
    return min(int(kw * 15000), 30000)

def calc_for_size(kw, irradiance):
    central = pm_surya_ghar_subsidy(kw)
    state = state_subsidy_up(kw)
    total_subsidy = central + state
    gross_cost = kw * 70000
    net_cost = max(0, gross_cost - total_subsidy)
    monthly_units = round(kw * irradiance * 30 * 0.75)
    annual_units = monthly_units * 12
    monthly_savings = round(monthly_units * 7.0)
    annual_savings = monthly_savings * 12
    payback = round(net_cost / annual_savings, 1) if annual_savings > 0 else 99
    cumulative = 0
    for year in range(25):
        cumulative += annual_savings * (1.04 ** year)
    lifetime_savings = round(cumulative - net_cost)
    co2_year_kg = round(annual_units * 0.82)
    panels = -(-int(kw * 1000) // 400)
    return {
        'central': central, 'state': state, 'total_subsidy': total_subsidy,
        'gross_cost': gross_cost, 'net_cost': net_cost,
        'discount_pct': round((total_subsidy / gross_cost) * 100),
        'monthly_units': monthly_units, 'annual_units': annual_units,
        'monthly_savings': monthly_savings, 'annual_savings': annual_savings,
        'payback': payback, 'lifetime_savings': lifetime_savings,
        'co2_year_kg': co2_year_kg, 'co2_lifetime_tons': round(co2_year_kg * 25 / 1000),
        'panels': panels, 'roof_sqft': round(kw * 100)
    }

def fmt_inr(n):
    if n >= 10000000: return f'₹{n/10000000:.2f} Cr'.replace('.00', '')
    if n >= 100000: return f'₹{n/100000:.2f} L'.replace('.00', '')
    return f'₹{n:,}'

def fmt_inr_full(n):
    s = str(int(n))
    if len(s) <= 3: return f'₹{s}'
    last3 = s[-3:]
    rest = s[:-3]
    groups = []
    while len(rest) > 2:
        groups.insert(0, rest[-2:])
        rest = rest[:-2]
    if rest: groups.insert(0, rest)
    return '₹' + ','.join(groups) + ',' + last3

def fmt_num(n):
    s = str(int(n))
    if len(s) <= 3: return s
    last3 = s[-3:]
    rest = s[:-3]
    groups = []
    while len(rest) > 2:
        groups.insert(0, rest[-2:])
        rest = rest[:-2]
    if rest: groups.insert(0, rest)
    return ','.join(groups) + ',' + last3

SHARED_CSS = '''<style>
:root { --ink:#0a0a0a; --paper:#faf7f2; --paper-2:#f3ede2; --sun:#ff6b1a; --sun-deep:#d94a00; --sun-light:#ffd166; --leaf:#2d5016; --muted:#5a5a5a; }
* { margin:0; padding:0; box-sizing:border-box; }
html { scroll-behavior:smooth; }
body { font-family:'Fraunces',Georgia,serif; background:var(--paper); color:var(--ink); font-size:18px; line-height:1.6; }
.mono { font-family:'JetBrains Mono',monospace; }
.topbar { border-bottom:1.5px solid var(--ink); background:var(--paper); position:sticky; top:0; z-index:100; }
.topbar-inner { max-width:1200px; margin:0 auto; display:flex; justify-content:space-between; align-items:center; padding:14px 28px; }
.logo { font-weight:900; font-size:22px; letter-spacing:-0.02em; display:flex; align-items:center; gap:8px; text-decoration:none; color:var(--ink); }
.logo-sun { width:24px; height:24px; background:var(--sun); border-radius:50%; box-shadow:0 0 0 3px var(--paper),0 0 0 4px var(--ink); }
.nav { display:flex; gap:28px; align-items:center; }
.nav a { color:var(--ink); text-decoration:none; font-size:15px; font-weight:500; }
.nav a:hover { color:var(--sun-deep); }
.crumbs { font-family:'JetBrains Mono',monospace; font-size:12px; text-transform:uppercase; letter-spacing:0.1em; padding:16px 28px; max-width:1200px; margin:0 auto; }
.crumbs a { color:var(--muted); text-decoration:none; }
.crumbs a:hover { color:var(--sun-deep); }
.crumbs .sep { margin:0 8px; color:var(--muted); }
.hero { padding:40px 28px 56px; border-bottom:1.5px solid var(--ink); }
.hero-inner { max-width:1200px; margin:0 auto; }
.hero-kicker { font-family:'JetBrains Mono',monospace; font-size:12px; text-transform:uppercase; letter-spacing:0.15em; color:var(--sun-deep); margin-bottom:14px; }
.hero h1 { font-size:clamp(36px,4.5vw,64px); font-weight:900; letter-spacing:-0.03em; line-height:1.05; margin-bottom:18px; font-variation-settings:'opsz' 144; }
.hero h1 em { font-style:italic; font-weight:400; color:var(--sun-deep); }
.hero p { font-size:19px; color:var(--muted); max-width:760px; }
.hero-stats { display:grid; grid-template-columns:repeat(4,1fr); margin-top:32px; border-top:1.5px solid var(--ink); border-bottom:1.5px solid var(--ink); }
.hero-stat { padding:18px 16px; border-right:1px solid #d4cfc4; }
.hero-stat:last-child { border-right:none; }
.hero-stat .lbl { font-family:'JetBrains Mono',monospace; font-size:10px; text-transform:uppercase; letter-spacing:0.1em; color:var(--muted); margin-bottom:4px; }
.hero-stat .val { font-size:26px; font-weight:700; letter-spacing:-0.02em; }
.hero-stat .val.green { color:var(--leaf); }
.hero-stat .val.orange { color:var(--sun-deep); }
.section { padding:56px 28px; border-bottom:1.5px solid var(--ink); }
.section-inner { max-width:1200px; margin:0 auto; }
.section h2 { font-size:36px; font-weight:900; letter-spacing:-0.025em; margin-bottom:12px; line-height:1.1; }
.section h2 em { font-style:italic; font-weight:400; color:var(--sun-deep); }
.section h3 { font-size:22px; font-weight:700; letter-spacing:-0.015em; margin:28px 0 12px; }
.section p { margin-bottom:14px; max-width:760px; }
.section-kicker { font-family:'JetBrains Mono',monospace; font-size:12px; text-transform:uppercase; letter-spacing:0.15em; color:var(--sun-deep); margin-bottom:14px; }
.callout { padding:24px 28px; background:var(--ink); color:var(--paper); margin:28px 0; box-shadow:6px 6px 0 var(--sun); }
.callout-label { font-family:'JetBrains Mono',monospace; font-size:11px; text-transform:uppercase; letter-spacing:0.15em; color:var(--sun-light); margin-bottom:8px; }
.subsidy-table { width:100%; border-collapse:collapse; margin:24px 0; border:1.5px solid var(--ink); }
.subsidy-table th,.subsidy-table td { padding:14px 18px; text-align:left; border-bottom:1px solid #d4cfc4; }
.subsidy-table th { background:var(--paper-2); font-family:'JetBrains Mono',monospace; font-size:11px; text-transform:uppercase; letter-spacing:0.1em; font-weight:700; }
.subsidy-table tr.highlight { background:rgba(255,209,102,0.2); font-weight:700; }
.subsidy-table tr:last-child td { border-bottom:none; }
.size-grid { display:grid; grid-template-columns:repeat(auto-fit,minmax(220px,1fr)); gap:16px; margin:24px 0; }
.size-card { padding:24px; border:1.5px solid var(--ink); background:var(--paper); text-decoration:none; color:var(--ink); transition:all .15s; display:block; }
.size-card:hover { background:var(--ink); color:var(--paper); transform:translate(-2px,-2px); box-shadow:4px 4px 0 var(--sun); }
.size-card .size { font-family:'JetBrains Mono',monospace; font-size:11px; text-transform:uppercase; letter-spacing:0.1em; opacity:0.7; }
.size-card .price { font-size:32px; font-weight:900; letter-spacing:-0.02em; margin:6px 0; color:var(--sun-deep); }
.size-card:hover .price { color:var(--sun-light); }
.size-card .desc { font-size:14px; line-height:1.4; }
.cta-card { background:var(--sun); border:2px solid var(--ink); padding:32px; box-shadow:8px 8px 0 var(--ink); text-align:center; margin:32px 0; }
.cta-card h3 { font-size:28px; font-weight:900; letter-spacing:-0.02em; margin-bottom:10px; }
.cta-card p { font-size:16px; margin-bottom:20px; max-width:540px; margin:0 auto 20px; }
.cta-card a { display:inline-block; padding:14px 32px; background:var(--ink); color:var(--paper); text-decoration:none; font-weight:700; font-size:16px; border:2px solid var(--ink); }
.cta-card a:hover { background:var(--paper); color:var(--ink); }
.faq-item { border-top:1px solid #d4cfc4; padding:22px 0; }
.faq-item:last-child { border-bottom:1px solid #d4cfc4; }
.faq-item h4 { font-size:20px; font-weight:700; margin-bottom:10px; }
.faq-item p { color:var(--muted); }
.related-grid { display:grid; grid-template-columns:repeat(auto-fit,minmax(180px,1fr)); gap:10px; margin:20px 0; }
.related-grid a { padding:12px 16px; border:1px solid var(--ink); background:var(--paper); text-decoration:none; color:var(--ink); font-size:15px; }
.related-grid a:hover { background:var(--ink); color:var(--paper); }
.related-grid a .name-en { font-weight:600; }
.related-grid a .name-hi { font-size:12px; color:var(--muted); margin-left:4px; }
footer { padding:40px 28px; text-align:center; font-size:14px; color:var(--muted); }
footer a { color:var(--ink); text-decoration:none; }
@media (max-width:768px) {
  .hero-stats { grid-template-columns:repeat(2,1fr); }
  .hero-stat:nth-child(2) { border-right:none; }
  .hero-stat:nth-child(-n+2) { border-bottom:1px solid #d4cfc4; }
  .section h2 { font-size:28px; }
  .nav { display:none; }
}
</style>'''

SHARED_HEAD = '''<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Fraunces:opsz,wght@9..144,300..900&family=JetBrains+Mono:wght@400;500;700&family=Noto+Sans+Devanagari:wght@400;500;700;900&display=swap" rel="stylesheet">''' + SHARED_CSS

TOPBAR = '''<header class="topbar"><div class="topbar-inner"><a href="/" class="logo"><span class="logo-sun"></span>SolarSubsidies<span style="color:var(--sun-deep)">.com</span></a><nav class="nav"><a href="/">Home</a><a href="/calculator.html">Calculator</a><a href="/discom/">DISCOMs</a><a href="/d/">All Districts</a></nav></div></header>'''

FOOTER = '''<footer><p>© 2026 SolarSubsidies.com · Independent solar subsidy research, not affiliated with any government or vendor.<br><a href="/privacy.html">Privacy</a> · <a href="/terms.html">Terms</a> · Built with 🌞 for Indian solar adoption.</p></footer>'''

def render_district_page(d):
    calc3 = calc_for_size(3, d['irradiance'])
    calc5 = calc_for_size(5, d['irradiance'])
    title = f"Solar Subsidy in {d['name']}, UP — ₹1,08,000 Subsidy 2026 | SolarSubsidies.com"
    desc = f"Solar subsidy in {d['name']}, Uttar Pradesh. PM Surya Ghar + UPNEDA combined gives ₹1.08 L on a 3 kW system. {d['discom']} DISCOM. {d['irradiance']} kWh/m²/day local sun."
    size_cards = ''
    for kw in [1, 2, 3, 5, 10]:
        c = calc_for_size(kw, d['irradiance'])
        size_cards += f'<a href="/d/{d["slug"]}/{kw}kw.html" class="size-card"><div class="size">{kw} kW system</div><div class="price">{fmt_inr(c["net_cost"])}</div><div class="desc">After ₹{c["total_subsidy"]:,} subsidy. {c["payback"]} yr payback. {c["monthly_units"]} units/month.</div></a>'
    discom_info = next((dc for dc in DISCOMS if dc['code'] == d['discom']), None)
    discom_name = discom_info['name'] if discom_info else d['discom']
    discom_hi = discom_info['name_hi'] if discom_info else ''
    sister_districts = [s for s in DISTRICTS if s['division'] == d['division'] and s['slug'] != d['slug']][:6]
    sister_html = ''.join([f'<a href="/d/{s["slug"]}.html"><span class="name-en">{s["name"]}</span><span class="name-hi">{s["name_hi"]}</span></a>' for s in sister_districts])
    crops = d['primary_crop']
    if d['rural_pct'] >= 85:
        agri_angle = f"With {d['rural_pct']}% rural population in {d['name']} and {crops} as major crops, PM-KUSUM solar pump subsidies (60% of cost) are an equally compelling parallel opportunity for farmers."
    elif d['rural_pct'] >= 60:
        agri_angle = f"With a balanced {d['rural_pct']}% rural / {100-d['rural_pct']}% urban mix and {crops} dominant crops, {d['name']} suits both rooftop solar (homes) and PM-KUSUM pumps (farms)."
    else:
        agri_angle = f"As one of UP's more urbanized districts ({100-d['rural_pct']}% urban), {d['name']} sees most demand from residential rooftops and RWA group installations rather than farm pumps."
    bundelkhand = ['jhansi', 'jalaun', 'lalitpur', 'banda', 'hamirpur', 'mahoba', 'chitrakoot']
    bundelkhand_note = ''
    if d['slug'] in bundelkhand:
        bundelkhand_note = f'<div class="callout"><div class="callout-label">★ BUNDELKHAND SOLAR CORRIDOR</div><p style="margin:8px 0 0; font-size:17px;">{d["name"]} is part of UP\\'s Bundelkhand Solar Corridor — priority development zone with {d["irradiance"]} kWh/m²/day (UP\\'s highest irradiance).</p></div>'
    return f'''<!DOCTYPE html>
<html lang="en"><head>{SHARED_HEAD}
<title>{title}</title>
<meta name="description" content="{desc}">
<link rel="canonical" href="https://solarsubsidies.com/d/{d['slug']}.html">
</head><body>{TOPBAR}
<div class="crumbs mono"><a href="/">Home</a><span class="sep">/</span><a href="/d/">UP Districts</a><span class="sep">/</span>{d['name']}</div>
<section class="hero"><div class="hero-inner">
<div class="hero-kicker mono">§ {d['division']} Division · {d['discom']} DISCOM</div>
<h1>Solar Subsidy in {d['name']}, UP<br><em>Up to ₹1,08,000 in 2026</em></h1>
<p>A 3 kW rooftop solar system in {d['name']} ({d['name_hi']}) qualifies for ₹78,000 PM Surya Ghar central subsidy plus ₹30,000 UPNEDA state top-up. Your net cost: {fmt_inr(calc3['net_cost'])}, with a {calc3['payback']}-year payback.</p>
<div class="hero-stats">
<div class="hero-stat"><div class="lbl">Max Subsidy (3 kW)</div><div class="val orange">{fmt_inr_full(calc3['total_subsidy'])}</div></div>
<div class="hero-stat"><div class="lbl">Net Cost After Subsidy</div><div class="val">{fmt_inr_full(calc3['net_cost'])}</div></div>
<div class="hero-stat"><div class="lbl">Payback Period</div><div class="val green">{calc3['payback']} yrs</div></div>
<div class="hero-stat"><div class="lbl">25-Yr Lifetime Savings</div><div class="val green">{fmt_inr(calc3['lifetime_savings'])}</div></div>
</div></div></section>
<section class="section"><div class="section-inner">
<div class="section-kicker mono">§ Why {d['name']} works for solar</div>
<h2>{d['name']} gets <em>{d['irradiance']} kWh/m²/day</em> of solar irradiance.</h2>
<p>That generates roughly <strong>{calc3['monthly_units']} units of electricity per month</strong> from a 3 kW rooftop system in {d['name']}. With grid tariffs at ₹6.50/unit on {d['discom']}, that translates to {fmt_inr_full(calc3['monthly_savings'])} in monthly bill savings.</p>
<p>{agri_angle}</p>{bundelkhand_note}
<h3>{d['name']} district at a glance</h3>
<table class="subsidy-table">
<tr><td><strong>Division</strong></td><td>{d['division']}</td></tr>
<tr><td><strong>DISCOM</strong></td><td>{discom_name} ({discom_hi})</td></tr>
<tr><td><strong>Solar Irradiance</strong></td><td>{d['irradiance']} kWh/m²/day</td></tr>
<tr><td><strong>Population (2011)</strong></td><td>{fmt_num(d['population'])}</td></tr>
<tr><td><strong>Rural Population</strong></td><td>{d['rural_pct']}%</td></tr>
<tr><td><strong>Major Crops</strong></td><td>{d['primary_crop']}</td></tr>
<tr><td><strong>Avg Grid Tariff</strong></td><td>₹6.50/unit</td></tr>
</table></div></section>
<section class="section" style="background:var(--paper-2)"><div class="section-inner">
<div class="section-kicker mono">§ Subsidy Breakdown — {d['name']}</div>
<h2>How <em>₹1,08,000</em> works for a 3 kW system.</h2>
<table class="subsidy-table">
<thead><tr><th>Component</th><th>Amount</th><th>Notes</th></tr></thead>
<tbody>
<tr><td><strong>Gross System Cost</strong></td><td><strong>{fmt_inr_full(calc3['gross_cost'])}</strong></td><td>3 kW @ ₹70,000/kW</td></tr>
<tr><td>PM Surya Ghar (Central)</td><td style="color:var(--leaf)"><strong>− {fmt_inr_full(calc3['central'])}</strong></td><td>Capped ₹78k</td></tr>
<tr><td>UPNEDA State Top-up</td><td style="color:var(--leaf)"><strong>− {fmt_inr_full(calc3['state'])}</strong></td><td>₹15k/kW × 2 = ₹30k cap</td></tr>
<tr class="highlight"><td><strong>Your Net Cost</strong></td><td><strong>{fmt_inr_full(calc3['net_cost'])}</strong></td><td>{calc3['discount_pct']}% discount</td></tr>
</tbody></table>
<p style="margin-top:24px;">A 5 kW system in {d['name']} costs {fmt_inr_full(calc5['gross_cost'])} gross, gets same {fmt_inr_full(calc5['total_subsidy'])} subsidy (capped above 3 kW), netting {fmt_inr_full(calc5['net_cost'])}.</p>
</div></section>
<section class="section"><div class="section-inner">
<div class="section-kicker mono">§ System sizes for {d['name']}</div>
<h2>Pick the right size <em>for your bill.</em></h2>
<div class="size-grid">{size_cards}</div>
</div></section>
<section class="section" style="background:var(--paper-2)"><div class="section-inner">
<div class="section-kicker mono">§ Apply for the Subsidy</div>
<h2>The 4-step subsidy process in {d['name']}.</h2>
<div style="display:grid; grid-template-columns:repeat(auto-fit,minmax(250px,1fr)); gap:24px; margin-top:24px;">
<div><h3 style="color:var(--sun-deep);">1. Register</h3><p>Sign up at <strong>pmsuryaghar.gov.in</strong> with your Aadhaar and {d['discom']} bill.</p></div>
<div><h3 style="color:var(--sun-deep);">2. Get Quotes</h3><p>Compare 3 MNRE-empanelled vendors serving {d['name']}.</p></div>
<div><h3 style="color:var(--sun-deep);">3. Install + Net Meter</h3><p>{d['discom']} installs bi-directional net meter free.</p></div>
<div><h3 style="color:var(--sun-deep);">4. Receive Subsidy</h3><p>Bank transfer within 30 days of net meter activation.</p></div>
</div></div></section>
<div class="cta-card" style="max-width:1200px; margin:32px auto;"><h3>Get 3 free quotes for {d['name']}</h3><p>MNRE-empanelled installers serving your district. No spam.</p><a href="/calculator.html?district={d['slug']}">Use the calculator →</a></div>
<section class="section"><div class="section-inner">
<div class="section-kicker mono">§ FAQ — {d['name']}</div>
<h2>Common questions, <em>direct answers.</em></h2>
<div class="faq-item"><h4>How much subsidy do I get for a 3 kW solar system in {d['name']}?</h4><p>{fmt_inr_full(calc3['total_subsidy'])} total — ₹78,000 PM Surya Ghar + ₹30,000 UPNEDA. Both auto-disbursed. Net cost: {fmt_inr_full(calc3['net_cost'])}.</p></div>
<div class="faq-item"><h4>How long is the payback period in {d['name']}?</h4><p>{calc3['payback']} years for a 3 kW system. Generates ~{calc3['monthly_units']} units/month, saving {fmt_inr_full(calc3['monthly_savings'])}/month.</p></div>
<div class="faq-item"><h4>Which DISCOM serves {d['name']}?</h4><p>{discom_name} ({d['discom']}). Manages net metering and bi-directional meters for {d['name']}.</p></div>
<div class="faq-item"><h4>What roof area do I need?</h4><p>{calc3['roof_sqft']} sqft of unshaded roof. {calc3['panels']} panels at 400W each.</p></div>
<div class="faq-item"><h4>How much do I generate over 25 years?</h4><p>{fmt_num(calc3['annual_units']*25)} units. Net lifetime savings: {fmt_inr(calc3['lifetime_savings'])}.</p></div>
<div class="faq-item"><h4>Are PM-KUSUM solar pumps available in {d['name']}?</h4><p>Yes. Farmers with {d['primary_crop'].lower()} qualify for Component B (off-grid) or C (grid-connected). 60% subsidy.</p></div>
</div></section>
<section class="section" style="background:var(--paper-2)"><div class="section-inner">
<div class="section-kicker mono">§ More from {d['division']} Division</div>
<h2>Sister districts in <em>{d['division']}</em>.</h2>
<div class="related-grid">{sister_html}</div>
<p style="margin-top:24px;"><a href="/d/" style="color:var(--sun-deep); font-weight:600;">See all 75 UP districts →</a></p>
</div></section>{FOOTER}</body></html>'''

def render_district_size_page(d, kw):
    c = calc_for_size(kw, d['irradiance'])
    title = f"{kw} kW Solar Subsidy in {d['name']} — ₹{c['total_subsidy']:,} 2026 | SolarSubsidies.com"
    desc = f"{kw} kW solar in {d['name']}. After ₹{c['total_subsidy']:,} subsidy: {fmt_inr(c['net_cost'])} net cost, {c['payback']}-year payback."
    ctx_map = {
        1: ("Smallest qualifying system — good for 1BHK or low-consumption homes.", "Best fit: low-consumption households, supplemental backup."),
        2: ("Sweet spot for 2BHK / small family homes (~₹2,500-3,500 monthly bill).", "Best fit: 2BHK independent homes, retirees."),
        3: ("Maximum subsidy zone — full ₹1.08L stacking.", "Best fit: 3BHK homes, ₹3,500-5,500 monthly bills."),
        5: ("Above the subsidy cap but generates substantial excess.", "Best fit: large homes, ₹6,000+ bills, joint families."),
        10: ("Maximum residential size without commercial classification.", "Best fit: very large homes, RWAs, home offices.")
    }
    ctx = ctx_map.get(kw, ("", ""))
    other_sizes = ''
    for other_kw in [1, 2, 3, 5, 10]:
        if other_kw == kw: continue
        oc = calc_for_size(other_kw, d['irradiance'])
        other_sizes += f'<tr><td><a href="/d/{d["slug"]}/{other_kw}kw.html" style="color:var(--sun-deep); font-weight:600;">{other_kw} kW</a></td><td>{fmt_inr_full(oc["gross_cost"])}</td><td>{fmt_inr_full(oc["total_subsidy"])}</td><td><strong>{fmt_inr_full(oc["net_cost"])}</strong></td><td>{oc["monthly_units"]} units</td><td>{oc["payback"]} yrs</td></tr>'
    extra_note = ''
    if kw > 3:
        c3 = calc_for_size(3, d['irradiance'])
        extra_note = f'<div class="callout"><div class="callout-label">★ Subsidy capped at 3 kW</div><p style="margin:8px 0 0; font-size:16px;">Your {kw} kW gets same ₹{c["total_subsidy"]:,} as 3 kW, but generates ~{c["monthly_units"]-c3["monthly_units"]} extra units/month.</p></div>'
    return f'''<!DOCTYPE html>
<html lang="en"><head>{SHARED_HEAD}
<title>{title}</title>
<meta name="description" content="{desc}">
<link rel="canonical" href="https://solarsubsidies.com/d/{d['slug']}/{kw}kw.html">
</head><body>{TOPBAR}
<div class="crumbs mono"><a href="/">Home</a><span class="sep">/</span><a href="/d/">UP Districts</a><span class="sep">/</span><a href="/d/{d['slug']}.html">{d['name']}</a><span class="sep">/</span>{kw} kW</div>
<section class="hero"><div class="hero-inner">
<div class="hero-kicker mono">§ {d['name']} · {kw} kW System</div>
<h1>{kw} kW Solar in {d['name']}<br><em>Net cost: {fmt_inr(c['net_cost'])}</em></h1>
<p>A {kw} kW system in {d['name']} ({d['name_hi']}) qualifies for {fmt_inr(c['total_subsidy'])} subsidy. Generates {c['monthly_units']} units/month. Payback: {c['payback']} years.</p>
<div class="hero-stats">
<div class="hero-stat"><div class="lbl">Gross Cost</div><div class="val">{fmt_inr(c['gross_cost'])}</div></div>
<div class="hero-stat"><div class="lbl">Total Subsidy</div><div class="val orange">{fmt_inr(c['total_subsidy'])}</div></div>
<div class="hero-stat"><div class="lbl">Net Cost</div><div class="val">{fmt_inr(c['net_cost'])}</div></div>
<div class="hero-stat"><div class="lbl">Payback</div><div class="val green">{c['payback']} yrs</div></div>
</div></div></section>
<section class="section"><div class="section-inner">
<div class="section-kicker mono">§ Is {kw} kW right for you?</div>
<h2>{ctx[0]}</h2><p>{ctx[1]}</p>{extra_note}
<h3>Generation for {kw} kW in {d['name']}</h3>
<table class="subsidy-table">
<tr><td><strong>Daily generation</strong></td><td>~{round(c['monthly_units']/30)} units/day</td></tr>
<tr><td><strong>Monthly</strong></td><td>{c['monthly_units']} units</td></tr>
<tr><td><strong>Annual</strong></td><td>{fmt_num(c['annual_units'])} units</td></tr>
<tr><td><strong>25-year total</strong></td><td>{fmt_num(c['annual_units']*25)} units</td></tr>
<tr><td><strong>Panels (400W)</strong></td><td>{c['panels']} panels</td></tr>
<tr><td><strong>Roof area</strong></td><td>~{c['roof_sqft']} sqft</td></tr>
</table></div></section>
<section class="section" style="background:var(--paper-2)"><div class="section-inner">
<div class="section-kicker mono">§ The Math</div>
<h2>Cost breakdown for <em>{kw} kW in {d['name']}.</em></h2>
<table class="subsidy-table">
<thead><tr><th>Line Item</th><th>Amount</th></tr></thead>
<tbody>
<tr><td>{kw} kW @ ₹70,000/kW</td><td>{fmt_inr_full(c['gross_cost'])}</td></tr>
<tr><td>PM Surya Ghar</td><td style="color:var(--leaf)">− {fmt_inr_full(c['central'])}</td></tr>
<tr><td>UPNEDA state</td><td style="color:var(--leaf)">− {fmt_inr_full(c['state'])}</td></tr>
<tr class="highlight"><td><strong>Net cost</strong></td><td><strong>{fmt_inr_full(c['net_cost'])}</strong></td></tr>
<tr><td>Monthly savings</td><td style="color:var(--leaf)">+{fmt_inr_full(c['monthly_savings'])}/mo</td></tr>
<tr><td>Annual savings</td><td style="color:var(--leaf)">+{fmt_inr_full(c['annual_savings'])}/yr</td></tr>
<tr><td>25-yr lifetime savings</td><td style="color:var(--leaf)"><strong>{fmt_inr(c['lifetime_savings'])}</strong></td></tr>
</tbody></table>
<h3>Environmental impact</h3><p>Offsets <strong>{fmt_num(c['co2_year_kg'])} kg CO₂/year</strong> ({c['co2_lifetime_tons']} tons lifetime), equivalent to ~{round(c['co2_lifetime_tons']*16.5)} trees.</p>
</div></section>
<section class="section"><div class="section-inner">
<div class="section-kicker mono">§ Compare other sizes</div>
<h2>Other sizes in <em>{d['name']}.</em></h2>
<table class="subsidy-table">
<thead><tr><th>Size</th><th>Gross</th><th>Subsidy</th><th>Net Cost</th><th>Monthly Gen</th><th>Payback</th></tr></thead>
<tbody>{other_sizes}</tbody></table>
</div></section>
<div class="cta-card" style="max-width:1200px; margin:32px auto;"><h3>Get 3 free quotes for {kw} kW in {d['name']}</h3><p>MNRE-empanelled installers in {d['division']} division.</p><a href="/calculator.html?district={d['slug']}&size={kw}">Match me with vendors →</a></div>
{FOOTER}</body></html>'''

def render_discom_page(discom):
    code = discom['code']
    name = discom['name']
    name_hi = discom['name_hi']
    coverage = discom['coverage']
    tariff = discom['residential_tariff']
    served = [d for d in DISTRICTS if d['discom'] == code]
    total_pop = sum(d['population'] for d in served)
    avg_irr = round(sum(d['irradiance'] for d in served) / len(served), 2) if served else 5.0
    c3 = calc_for_size(3, avg_irr)
    district_html = ''.join([f'<a href="/d/{d["slug"]}.html"><span class="name-en">{d["name"]}</span><span class="name-hi">{d["name_hi"]}</span></a>' for d in sorted(served, key=lambda x: x['name'])])
    title = f"{code} Solar Subsidy — Net Metering in {coverage} | SolarSubsidies.com"
    desc = f"Solar subsidy with {name} ({code}). Serves {len(served)} UP districts. Residential tariff: ₹{tariff}/unit."
    return f'''<!DOCTYPE html>
<html lang="en"><head>{SHARED_HEAD}
<title>{title}</title>
<meta name="description" content="{desc}">
<link rel="canonical" href="https://solarsubsidies.com/discom/{code.lower()}.html">
</head><body>{TOPBAR}
<div class="crumbs mono"><a href="/">Home</a><span class="sep">/</span><a href="/discom/">DISCOMs</a><span class="sep">/</span>{code}</div>
<section class="hero"><div class="hero-inner">
<div class="hero-kicker mono">§ DISCOM · {coverage}</div>
<h1>{code}: <em>{name}</em></h1>
<p>{name} ({name_hi}) covers {len(served)} of UP's 75 districts and {fmt_num(total_pop)} people. Net metering active.</p>
<div class="hero-stats">
<div class="hero-stat"><div class="lbl">Districts Served</div><div class="val">{len(served)}</div></div>
<div class="hero-stat"><div class="lbl">Residential Tariff</div><div class="val orange">₹{tariff}/unit</div></div>
<div class="hero-stat"><div class="lbl">Population</div><div class="val">{fmt_num(total_pop)}</div></div>
<div class="hero-stat"><div class="lbl">Net Metering</div><div class="val green">Active ✓</div></div>
</div></div></section>
<section class="section"><div class="section-inner">
<div class="section-kicker mono">§ {code} Customer Subsidy</div>
<h2>What <em>{code}</em> customers get.</h2>
<p>Residential {code} customers stack PM Surya Ghar (up to ₹78,000) + UPNEDA (up to ₹30,000) for a 3 kW system. <strong>Up to ₹1,08,000 off.</strong></p>
<table class="subsidy-table">
<tr><td>Gross system cost (3 kW)</td><td><strong>{fmt_inr_full(c3['gross_cost'])}</strong></td></tr>
<tr><td>PM Surya Ghar</td><td style="color:var(--leaf)">− {fmt_inr_full(c3['central'])}</td></tr>
<tr><td>UPNEDA</td><td style="color:var(--leaf)">− {fmt_inr_full(c3['state'])}</td></tr>
<tr class="highlight"><td><strong>Net cost</strong></td><td><strong>{fmt_inr_full(c3['net_cost'])}</strong></td></tr>
<tr><td>Monthly savings</td><td style="color:var(--leaf)">{fmt_inr_full(c3['monthly_savings'])}</td></tr>
<tr><td>Payback</td><td>{c3['payback']} years</td></tr>
</table></div></section>
<section class="section" style="background:var(--paper-2)"><div class="section-inner">
<div class="section-kicker mono">§ Net Metering with {code}</div>
<h2>How net metering works on <em>{code}.</em></h2>
<p>Excess generation flows back through a bi-directional net meter. {code} credits at prevailing tariff.</p>
<h3>The 4-step process</h3>
<ol style="margin-left:24px; line-height:2;">
<li><strong>Apply on pmsuryaghar.gov.in</strong> — select {code}, enter consumer number.</li>
<li><strong>Feasibility check</strong> — 15 days. {code} verifies connection.</li>
<li><strong>Install + inspect</strong> — vendor installs, {code} engineer approves.</li>
<li><strong>Net meter activated</strong> — free of cost. Subsidy in 30 days.</li>
</ol></div></section>
<section class="section"><div class="section-inner">
<div class="section-kicker mono">§ Districts Served</div>
<h2>{len(served)} districts under <em>{code}.</em></h2>
<div class="related-grid">{district_html}</div>
</div></section>
<div class="cta-card" style="max-width:1200px; margin:32px auto;"><h3>Calculate your {code} solar subsidy</h3><a href="/calculator.html">Open calculator →</a></div>
{FOOTER}</body></html>'''

def render_district_index():
    by_division = {}
    for d in DISTRICTS:
        by_division.setdefault(d['division'], []).append(d)
    sections_html = ''
    for division in sorted(by_division.keys()):
        district_links = ''.join([f'<a href="/d/{d["slug"]}.html"><span class="name-en">{d["name"]}</span><span class="name-hi">{d["name_hi"]}</span></a>' for d in sorted(by_division[division], key=lambda x: x['name'])])
        sections_html += f'<h3>{division} Division ({len(by_division[division])} districts)</h3><div class="related-grid">{district_links}</div>'
    return f'''<!DOCTYPE html>
<html lang="en"><head>{SHARED_HEAD}
<title>All 75 UP Districts — Solar Subsidy Guides | SolarSubsidies.com</title>
<meta name="description" content="Solar subsidy guides for all 75 Uttar Pradesh districts.">
<link rel="canonical" href="https://solarsubsidies.com/d/">
</head><body>{TOPBAR}
<div class="crumbs mono"><a href="/">Home</a><span class="sep">/</span>UP Districts</div>
<section class="hero"><div class="hero-inner">
<div class="hero-kicker mono">§ All 75 Districts of Uttar Pradesh</div>
<h1>Pick your district.<br><em>Get your exact subsidy.</em></h1>
<p>Each of UP's 75 districts has unique solar economics. Click for a guide tailored to your conditions.</p>
</div></section>
<section class="section"><div class="section-inner">{sections_html}</div></section>
{FOOTER}</body></html>'''

def render_discom_index():
    discom_cards = ''
    for dc in DISCOMS:
        served = [d for d in DISTRICTS if d['discom'] == dc['code']]
        discom_cards += f'<a href="/discom/{dc["code"].lower()}.html" class="size-card"><div class="size">{dc["code"]}</div><div class="price" style="font-size:24px;">{dc["name"]}</div><div class="desc">{dc["coverage"]} · {len(served)} districts · ₹{dc["residential_tariff"]}/unit</div></a>'
    return f'''<!DOCTYPE html>
<html lang="en"><head>{SHARED_HEAD}
<title>UP DISCOMs — Net Metering Guide | SolarSubsidies.com</title>
<meta name="description" content="All 6 Uttar Pradesh DISCOMs — net metering, tariffs, subsidy stacking.">
<link rel="canonical" href="https://solarsubsidies.com/discom/">
</head><body>{TOPBAR}
<div class="crumbs mono"><a href="/">Home</a><span class="sep">/</span>DISCOMs</div>
<section class="hero"><div class="hero-inner">
<div class="hero-kicker mono">§ 6 DISCOMs Serving Uttar Pradesh</div>
<h1>Your DISCOM = your <em>net metering rules.</em></h1>
<p>UP has 6 power distribution companies. Each handles subsidies, net meters, and excess generation credit.</p>
</div></section>
<section class="section"><div class="section-inner"><div class="size-grid">{discom_cards}</div></div></section>
{FOOTER}</body></html>'''

def render_sitemap():
    today = date.today().isoformat()
    urls = [
        ('https://solarsubsidies.com/', '1.0'),
        ('https://solarsubsidies.com/calculator.html', '0.9'),
        ('https://solarsubsidies.com/d/', '0.9'),
        ('https://solarsubsidies.com/discom/', '0.8'),
    ]
    for d in DISTRICTS:
        urls.append((f"https://solarsubsidies.com/d/{d['slug']}.html", '0.8'))
        for kw in [1, 2, 3, 5, 10]:
            urls.append((f"https://solarsubsidies.com/d/{d['slug']}/{kw}kw.html", '0.7'))
    for dc in DISCOMS:
        urls.append((f"https://solarsubsidies.com/discom/{dc['code'].lower()}.html", '0.7'))
    url_xml = '\n'.join([f'  <url>\n    <loc>{u}</loc>\n    <lastmod>{today}</lastmod>\n    <priority>{p}</priority>\n  </url>' for u, p in urls])
    return f'''<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
{url_xml}
</urlset>
'''

def main():
    print("=" * 60)
    print("SolarSubsidies.com — Programmatic Page Generator")
    print("=" * 60)
    os.makedirs(os.path.join(OUT_DIR, 'd'), exist_ok=True)
    os.makedirs(os.path.join(OUT_DIR, 'discom'), exist_ok=True)
    count = 0
    
    print(f"\n[1/4] Generating {len(DISTRICTS)} district pages...")
    for d in DISTRICTS:
        with open(os.path.join(OUT_DIR, 'd', f"{d['slug']}.html"), 'w', encoding='utf-8') as f:
            f.write(render_district_page(d))
        count += 1
    
    print(f"\n[2/4] Generating {len(DISTRICTS) * 5} district-size pages...")
    for d in DISTRICTS:
        os.makedirs(os.path.join(OUT_DIR, 'd', d['slug']), exist_ok=True)
        for kw in [1, 2, 3, 5, 10]:
            with open(os.path.join(OUT_DIR, 'd', d['slug'], f"{kw}kw.html"), 'w', encoding='utf-8') as f:
                f.write(render_district_size_page(d, kw))
            count += 1
    
    print(f"\n[3/4] Generating {len(DISCOMS)} DISCOM pages...")
    for dc in DISCOMS:
        with open(os.path.join(OUT_DIR, 'discom', f"{dc['code'].lower()}.html"), 'w', encoding='utf-8') as f:
            f.write(render_discom_page(dc))
        count += 1
    
    print(f"\n[4/4] Generating indexes + sitemap...")
    with open(os.path.join(OUT_DIR, 'd', 'index.html'), 'w', encoding='utf-8') as f:
        f.write(render_district_index())
    with open(os.path.join(OUT_DIR, 'discom', 'index.html'), 'w', encoding='utf-8') as f:
        f.write(render_discom_index())
    with open(os.path.join(OUT_DIR, 'sitemap.xml'), 'w', encoding='utf-8') as f:
        f.write(render_sitemap())
    count += 3
    
    print(f"\n{'='*60}")
    print(f"✅ TOTAL: {count} files generated")
    print(f"{'='*60}")

if __name__ == '__main__':
    main()
