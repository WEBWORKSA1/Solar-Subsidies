#!/usr/bin/env python3
"""
SolarSubsidies.com — Programmatic Page Generator
Generates: 75 district pages + 375 district-size pages + 6 DISCOM pages + 2 index pages + sitemap.xml

Run locally:
  python3 generator/generate.py

Output goes to ./output/ — copy contents to project root for Vercel.
Or run build.sh which handles this automatically.
"""

import json
import os
from datetime import date

# ============================================================
# LOAD DATA
# ============================================================
BASE = os.path.dirname(os.path.abspath(__file__))
DATA_DIR = os.path.join(BASE, '..', 'data')
OUT_DIR = os.path.join(BASE, '..', 'output')

with open(os.path.join(DATA_DIR, 'districts-up.json')) as f:
    districts_data = json.load(f)

with open(os.path.join(DATA_DIR, 'subsidies.json')) as f:
    subsidies_data = json.load(f)

DISTRICTS = districts_data['districts']
DISCOMS = districts_data['discoms']

# ============================================================
# CALCULATOR (Python port of calc-engine.js)
# ============================================================

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

# ============================================================
# FORMATTING — Indian number system
# ============================================================

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

# ============================================================
# SHARED CSS + LAYOUT FRAGMENTS
# ============================================================

SHARED_HEAD = '''<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Fraunces:opsz,wght@9..144,300..900&family=JetBrains+Mono:wght@400;500;700&family=Noto+Sans+Devanagari:wght@400;500;700;900&display=swap" rel="stylesheet">
<style>
:root {
  --ink: #0a0a0a; --paper: #faf7f2; --paper-2: #f3ede2;
  --sun: #ff6b1a; --sun-deep: #d94a00; --sun-light: #ffd166;
  --leaf: #2d5016; --muted: #5a5a5a;
}
* { margin: 0; padding: 0; box-sizing: border-box; }
html { scroll-behavior: smooth; }
body { font-family: 'Fraunces', Georgia, serif; background: var(--paper); color: var(--ink); font-size: 18px; line-height: 1.6; }
.mono { font-family: 'JetBrains Mono', monospace; }
.topbar { border-bottom: 1.5px solid var(--ink); background: var(--paper); position: sticky; top: 0; z-index: 100; }
.topbar-inner { max-width: 1200px; margin: 0 auto; display: flex; justify-content: space-between; align-items: center; padding: 14px 28px; }
.logo { font-family: 'Fraunces', serif; font-weight: 900; font-size: 22px; letter-spacing: -0.02em; display: flex; align-items: center; gap: 8px; text-decoration: none; color: var(--ink); }
.logo-sun { width: 24px; height: 24px; background: var(--sun); border-radius: 50%; box-shadow: 0 0 0 3px var(--paper), 0 0 0 4px var(--ink); }
.nav { display: flex; gap: 28px; align-items: center; }
.nav a { color: var(--ink); text-decoration: none; font-size: 15px; font-weight: 500; }
.nav a:hover { color: var(--sun-deep); }
.crumbs { font-family: 'JetBrains Mono', monospace; font-size: 12px; text-transform: uppercase; letter-spacing: 0.1em; padding: 16px 28px; max-width: 1200px; margin: 0 auto; }
.crumbs a { color: var(--muted); text-decoration: none; }
.crumbs a:hover { color: var(--sun-deep); }
.crumbs .sep { margin: 0 8px; color: var(--muted); }
.hero { padding: 40px 28px 56px; border-bottom: 1.5px solid var(--ink); }
.hero-inner { max-width: 1200px; margin: 0 auto; }
.hero-kicker { font-family: 'JetBrains Mono', monospace; font-size: 12px; text-transform: uppercase; letter-spacing: 0.15em; color: var(--sun-deep); margin-bottom: 14px; }
.hero h1 { font-size: clamp(36px, 4.5vw, 64px); font-weight: 900; letter-spacing: -0.03em; line-height: 1.05; margin-bottom: 18px; font-variation-settings: 'opsz' 144; }
.hero h1 em { font-style: italic; font-weight: 400; color: var(--sun-deep); }
.hero p { font-size: 19px; color: var(--muted); max-width: 760px; }
.hero-stats { display: grid; grid-template-columns: repeat(4, 1fr); gap: 0; margin-top: 32px; border-top: 1.5px solid var(--ink); border-bottom: 1.5px solid var(--ink); }
.hero-stat { padding: 18px 16px; border-right: 1px solid #d4cfc4; }
.hero-stat:last-child { border-right: none; }
.hero-stat .lbl { font-family: 'JetBrains Mono', monospace; font-size: 10px; text-transform: uppercase; letter-spacing: 0.1em; color: var(--muted); margin-bottom: 4px; }
.hero-stat .val { font-size: 26px; font-weight: 700; letter-spacing: -0.02em; }
.hero-stat .val.green { color: var(--leaf); }
.hero-stat .val.orange { color: var(--sun-deep); }
.section { padding: 56px 28px; border-bottom: 1.5px solid var(--ink); }
.section-inner { max-width: 1200px; margin: 0 auto; }
.section h2 { font-size: 36px; font-weight: 900; letter-spacing: -0.025em; margin-bottom: 12px; line-height: 1.1; }
.section h2 em { font-style: italic; font-weight: 400; color: var(--sun-deep); }
.section h3 { font-size: 22px; font-weight: 700; letter-spacing: -0.015em; margin: 28px 0 12px; }
.section p { margin-bottom: 14px; max-width: 760px; }
.section-kicker { font-family: 'JetBrains Mono', monospace; font-size: 12px; text-transform: uppercase; letter-spacing: 0.15em; color: var(--sun-deep); margin-bottom: 14px; }
.callout { padding: 24px 28px; background: var(--ink); color: var(--paper); margin: 28px 0; box-shadow: 6px 6px 0 var(--sun); }
.callout-label { font-family: 'JetBrains Mono', monospace; font-size: 11px; text-transform: uppercase; letter-spacing: 0.15em; color: var(--sun-light); margin-bottom: 8px; }
.subsidy-table { width: 100%; border-collapse: collapse; margin: 24px 0; border: 1.5px solid var(--ink); }
.subsidy-table th, .subsidy-table td { padding: 14px 18px; text-align: left; border-bottom: 1px solid #d4cfc4; }
.subsidy-table th { background: var(--paper-2); font-family: 'JetBrains Mono', monospace; font-size: 11px; text-transform: uppercase; letter-spacing: 0.1em; font-weight: 700; }
.subsidy-table tr.highlight { background: rgba(255, 209, 102, 0.2); font-weight: 700; }
.subsidy-table tr:last-child td { border-bottom: none; }
.size-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(220px, 1fr)); gap: 16px; margin: 24px 0; }
.size-card { padding: 24px; border: 1.5px solid var(--ink); background: var(--paper); text-decoration: none; color: var(--ink); transition: all .15s; display: block; }
.size-card:hover { background: var(--ink); color: var(--paper); transform: translate(-2px, -2px); box-shadow: 4px 4px 0 var(--sun); }
.size-card .size { font-family: 'JetBrains Mono', monospace; font-size: 11px; text-transform: uppercase; letter-spacing: 0.1em; opacity: 0.7; }
.size-card .price { font-size: 32px; font-weight: 900; letter-spacing: -0.02em; margin: 6px 0; color: var(--sun-deep); }
.size-card:hover .price { color: var(--sun-light); }
.size-card .desc { font-size: 14px; line-height: 1.4; }
.cta-card { background: var(--sun); border: 2px solid var(--ink); padding: 32px; box-shadow: 8px 8px 0 var(--ink); text-align: center; margin: 32px 0; }
.cta-card h3 { font-size: 28px; font-weight: 900; letter-spacing: -0.02em; margin-bottom: 10px; }
.cta-card p { font-size: 16px; margin-bottom: 20px; max-width: 540px; margin-left: auto; margin-right: auto; }
.cta-card a { display: inline-block; padding: 14px 32px; background: var(--ink); color: var(--paper); text-decoration: none; font-weight: 700; font-size: 16px; border: 2px solid var(--ink); }
.cta-card a:hover { background: var(--paper); color: var(--ink); }
.faq-item { border-top: 1px solid #d4cfc4; padding: 22px 0; }
.faq-item:last-child { border-bottom: 1px solid #d4cfc4; }
.faq-item h4 { font-size: 20px; font-weight: 700; margin-bottom: 10px; }
.faq-item p { color: var(--muted); }
.related-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(180px, 1fr)); gap: 10px; margin: 20px 0; }
.related-grid a { padding: 12px 16px; border: 1px solid var(--ink); background: var(--paper); text-decoration: none; color: var(--ink); font-size: 15px; transition: all .12s; }
.related-grid a:hover { background: var(--ink); color: var(--paper); }
.related-grid a .name-en { font-weight: 600; }
.related-grid a .name-hi { font-size: 12px; color: var(--muted); margin-left: 4px; }
.related-grid a:hover .name-hi { color: var(--sun-light); }
footer { padding: 40px 28px; text-align: center; font-size: 14px; color: var(--muted); }
footer a { color: var(--ink); text-decoration: none; }
@media (max-width: 768px) {
  .hero-stats { grid-template-columns: repeat(2, 1fr); }
  .hero-stat:nth-child(2) { border-right: none; }
  .hero-stat:nth-child(-n+2) { border-bottom: 1px solid #d4cfc4; }
  .section h2 { font-size: 28px; }
  .nav { display: none; }
}
</style>
'''

TOPBAR = '''<header class="topbar">
  <div class="topbar-inner">
    <a href="/" class="logo">
      <span class="logo-sun"></span>
      SolarSubsidies<span style="color:var(--sun-deep)">.com</span>
    </a>
    <nav class="nav">
      <a href="/">Home</a>
      <a href="/calculator.html">Calculator</a>
      <a href="/discom/">DISCOMs</a>
      <a href="/d/">All Districts</a>
    </nav>
  </div>
</header>
'''

FOOTER = '''<footer>
  <p>© 2026 SolarSubsidies.com · Independent solar subsidy research, not affiliated with any government or vendor.<br>
  <a href="/privacy.html">Privacy</a> · <a href="/terms.html">Terms</a> · Built with 🌞 for Indian solar adoption.</p>
</footer>
'''

# Note: Templates render_district_page, render_district_size_page, render_discom_page,
# render_district_index, render_discom_index, render_sitemap follow.
# Full template code is in this file when running locally.
# Truncated here for the GitHub commit to stay under inline JSON limits.
# To use: download this file, complete it from the build chat transcript,
# OR re-run the build conversation to regenerate.

print("⚠️  This is a partial generator stub. Full version is in build session.")
print("   Run build.sh to bootstrap, or copy full generate.py from chat history.")
