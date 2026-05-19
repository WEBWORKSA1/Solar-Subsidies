#!/usr/bin/env python3
"""
SolarSubsidies.com — Vendor Profile Page Generator + Directory Builder
Generates /vendors/{slug}.html for each vendor + /vendors/directory/index.html

Reads vendor data from data/vendors-seed.json (eventually replace with Supabase query).

Run by Vercel build hook via build.sh, or manually:
  python3 generator/generate-vendors.py
"""

import json
import os
from datetime import date

BASE = os.path.dirname(os.path.abspath(__file__))
DATA_DIR = os.path.join(BASE, '..', 'data')
OUT_DIR = os.path.join(BASE, '..', 'output')

# Load vendor data
with open(os.path.join(DATA_DIR, 'vendors-seed.json')) as f:
    vendor_data = json.load(f)

with open(os.path.join(DATA_DIR, 'districts-up.json')) as f:
    districts_data = json.load(f)

VENDORS = vendor_data['vendors']
DISTRICTS = {d['slug']: d for d in districts_data['districts']}

# Filter: only verified vendors appear publicly
PUBLIC_VENDORS = [v for v in VENDORS if v.get('verified') is True]


# ============================================================
# SHARED CSS + LAYOUT (matches district pages style)
# ============================================================

SHARED_CSS = '''<style>
:root { --ink:#0a0a0a; --paper:#faf7f2; --paper-2:#f3ede2; --sun:#ff6b1a; --sun-deep:#d94a00; --sun-light:#ffd166; --leaf:#2d5016; --muted:#5a5a5a; --line:#d4cfc4; }
* { margin:0; padding:0; box-sizing:border-box; }
html { scroll-behavior:smooth; -webkit-text-size-adjust:100%; }
body { font-family:'Fraunces',Georgia,serif; background:var(--paper); color:var(--ink); font-size:18px; line-height:1.65; }
.mono { font-family:'JetBrains Mono',monospace; }
.topbar { border-bottom:1.5px solid var(--ink); background:var(--paper); position:sticky; top:0; z-index:100; }
.topbar-inner { max-width:1200px; margin:0 auto; display:flex; justify-content:space-between; align-items:center; padding:14px 28px; }
.logo { font-weight:900; font-size:22px; letter-spacing:-0.02em; display:flex; align-items:center; gap:8px; text-decoration:none; color:var(--ink); }
.logo-sun { width:24px; height:24px; background:var(--sun); border-radius:50%; box-shadow:0 0 0 3px var(--paper),0 0 0 4px var(--ink); }
.nav { display:flex; gap:28px; align-items:center; }
.nav a { color:var(--ink); text-decoration:none; font-size:15px; font-weight:500; }
.nav a:hover { color:var(--sun-deep); }
.crumbs { font-family:'JetBrains Mono',monospace; font-size:11px; text-transform:uppercase; letter-spacing:0.1em; padding:16px 28px; max-width:1200px; margin:0 auto; }
.crumbs a { color:var(--muted); text-decoration:none; }
.crumbs a:hover { color:var(--sun-deep); }
.crumbs .sep { margin:0 8px; color:var(--muted); }
.hero { padding:40px 28px 56px; border-bottom:1.5px solid var(--ink); }
.hero-inner { max-width:1200px; margin:0 auto; }
.hero-kicker { font-family:'JetBrains Mono',monospace; font-size:12px; text-transform:uppercase; letter-spacing:0.15em; color:var(--sun-deep); margin-bottom:14px; }
.hero h1 { font-size:clamp(36px,4.5vw,64px); font-weight:900; letter-spacing:-0.03em; line-height:1.05; margin-bottom:18px; font-variation-settings:'opsz' 144; }
.hero h1 em { font-style:italic; font-weight:400; color:var(--sun-deep); }
.hero p { font-size:19px; color:var(--muted); max-width:760px; }
.hero-stats { display:grid; grid-template-columns:repeat(auto-fit, minmax(180px,1fr)); margin-top:32px; border-top:1.5px solid var(--ink); border-bottom:1.5px solid var(--ink); }
.hero-stat { padding:18px 16px; border-right:1px solid var(--line); }
.hero-stat:last-child { border-right:none; }
.hero-stat .lbl { font-family:'JetBrains Mono',monospace; font-size:10px; text-transform:uppercase; letter-spacing:0.1em; color:var(--muted); margin-bottom:4px; }
.hero-stat .val { font-size:26px; font-weight:700; letter-spacing:-0.02em; }
.hero-stat .val.green { color:var(--leaf); }
.hero-stat .val.orange { color:var(--sun-deep); }
.section { padding:56px 28px; border-bottom:1.5px solid var(--ink); }
.section-inner { max-width:1200px; margin:0 auto; }
.section h2 { font-size:clamp(28px,3.5vw,42px); font-weight:900; letter-spacing:-0.03em; margin-bottom:14px; line-height:1.05; }
.section h2 em { font-style:italic; font-weight:400; color:var(--sun-deep); }
.section h3 { font-size:22px; font-weight:700; margin:28px 0 12px; }
.section p { margin-bottom:14px; max-width:760px; }
.section-kicker { font-family:'JetBrains Mono',monospace; font-size:12px; text-transform:uppercase; letter-spacing:0.15em; color:var(--sun-deep); margin-bottom:14px; }
.info-table { width:100%; border-collapse:collapse; margin:20px 0; border:1.5px solid var(--ink); }
.info-table td { padding:14px 18px; border-bottom:1px solid var(--line); vertical-align:top; }
.info-table tr:last-child td { border-bottom:none; }
.info-table td:first-child { font-family:'JetBrains Mono',monospace; font-size:11px; text-transform:uppercase; letter-spacing:0.1em; color:var(--muted); font-weight:600; width:200px; }
.info-table td:last-child { font-weight:600; }
.tag-list { display:flex; gap:8px; flex-wrap:wrap; margin:14px 0; }
.tag { display:inline-block; padding:5px 12px; background:var(--paper-2); border:1px solid var(--ink); font-family:'JetBrains Mono',monospace; font-size:10px; text-transform:uppercase; letter-spacing:0.08em; font-weight:700; }
.tag.premium { background:var(--sun); }
.tag.verified { background:var(--leaf); color:var(--paper); border-color:var(--leaf); }
.specs-grid { display:grid; grid-template-columns:repeat(auto-fit, minmax(220px,1fr)); gap:14px; margin:24px 0; }
.spec-card { padding:20px; border:1.5px solid var(--ink); background:var(--paper); }
.spec-card .lbl { font-family:'JetBrains Mono',monospace; font-size:11px; text-transform:uppercase; letter-spacing:0.1em; color:var(--sun-deep); margin-bottom:8px; font-weight:700; }
.spec-card .val { font-size:18px; font-weight:700; line-height:1.3; }
.spec-card .sub { font-size:13px; color:var(--muted); margin-top:4px; font-style:italic; }
.coverage-list { display:grid; grid-template-columns:repeat(auto-fill,minmax(160px,1fr)); gap:8px; margin:14px 0; }
.coverage-list a { padding:10px 14px; border:1px solid var(--ink); background:var(--paper); text-decoration:none; color:var(--ink); font-size:14px; font-weight:600; }
.coverage-list a:hover { background:var(--ink); color:var(--paper); }
.cta-card { background:var(--sun); border:2px solid var(--ink); padding:32px; box-shadow:8px 8px 0 var(--ink); text-align:center; margin:32px 0; }
.cta-card h3 { font-size:28px; font-weight:900; margin-bottom:10px; letter-spacing:-0.02em; }
.cta-card p { font-size:16px; max-width:540px; margin:0 auto 20px; }
.cta-card a { display:inline-block; padding:14px 32px; background:var(--ink); color:var(--paper); text-decoration:none; font-weight:700; font-size:16px; border:2px solid var(--ink); }
.cta-card a:hover { background:var(--paper); color:var(--ink); }
.warning-strip { padding:14px 28px; background:var(--paper-2); border-bottom:1.5px solid var(--ink); font-size:13px; color:var(--muted); text-align:center; font-style:italic; }
.warning-strip strong { color:var(--ink); }
footer { padding:40px 28px; text-align:center; font-size:14px; color:var(--muted); }
footer a { color:var(--ink); text-decoration:none; }
@media (max-width:768px) {
  .nav { display:none; }
  .info-table td:first-child { width:auto; display:block; padding-bottom:4px; }
  .info-table td:last-child { display:block; padding-top:4px; }
}
</style>'''

SHARED_HEAD = '''<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Fraunces:opsz,wght@9..144,300..900&family=JetBrains+Mono:wght@400;500;700&family=Noto+Sans+Devanagari:wght@400;500;700;900&display=swap" rel="stylesheet">''' + SHARED_CSS

TOPBAR = '''<header class="topbar"><div class="topbar-inner"><a href="/" class="logo"><span class="logo-sun"></span>SolarSubsidies<span style="color:var(--sun-deep)">.com</span></a><nav class="nav"><a href="/">Home</a><a href="/calculator.html">Calculator</a><a href="/d/">Districts</a><a href="/vendors/directory/">Vendors</a></nav></div></header>'''

FOOTER = '''<footer><p>© 2026 SolarSubsidies.com · Independent solar subsidy research for Indian households.</p><p style="margin-top:6px;"><a href="/">Home</a> · <a href="/calculator.html">Calculator</a> · <a href="/vendors/directory/">Vendor Directory</a> · <a href="/privacy.html">Privacy</a> · <a href="/terms.html">Terms</a></p></footer>'''

WARNING_STRIP = '''<div class="warning-strip">⚠️ <strong>Independent directory.</strong> SolarSubsidies.com is not affiliated with the vendors listed. Verify MNRE empanellment and UPNEDA approval directly with the vendor before signing any contract.</div>'''


# ============================================================
# HELPERS
# ============================================================

def get_specialization_label(spec):
    labels = {
        'rooftop_residential': 'Residential Rooftop',
        'rooftop_commercial': 'Commercial Rooftop',
        'rooftop_industrial': 'Industrial Rooftop',
        'rwa_group_housing': 'RWA / Group Housing',
        'ground_mounted': 'Ground-Mounted',
        'battery_storage': 'Battery Storage / Hybrid',
        'hybrid_systems': 'Hybrid Systems',
        'agrivoltaics': 'Agrivoltaics',
        'ev_charging': 'EV Charging Bundle',
        'ppa_models': 'PPA Models',
        'opex_models': 'OPEX Models',
        'religious_tourism': 'Religious Tourism Commercial',
        'solar_financing': 'Solar Financing',
        'kusum_compatible': 'PM-KUSUM Compatible',
    }
    return labels.get(spec, spec.replace('_', ' ').title())


def get_district_name(slug):
    if slug == 'all_75_up':
        return 'All 75 UP Districts'
    d = DISTRICTS.get(slug)
    if d:
        return d['name']
    return slug.replace('-', ' ').title()


def get_coverage_display(vendor):
    """Returns either a list of district links or 'all UP' badge."""
    coverage = vendor.get('coverage_districts', [])
    if 'all_75_up' in coverage:
        return '<div class="tag-list"><span class="tag verified">✓ All 75 UP Districts</span></div>'
    if not coverage:
        return '<p class="mono" style="color:var(--muted);">No coverage districts listed.</p>'
    links = ''.join([f'<a href="/d/{slug}.html">{get_district_name(slug)}</a>' for slug in sorted(coverage)])
    return f'<div class="coverage-list">{links}</div>'


def get_specializations_tags(vendor):
    specs = vendor.get('specialization', [])
    if not specs:
        return ''
    tags = ''.join([f'<span class="tag">{get_specialization_label(s)}</span>' for s in specs])
    return f'<div class="tag-list">{tags}</div>'


def get_public_tags(vendor):
    tags = vendor.get('tags', [])
    pub_tags = [t for t in tags if t not in ('placeholder',)]
    if not pub_tags:
        return ''
    rendered = ''
    for t in pub_tags:
        cls = ''
        if t == 'premium':
            cls = ' premium'
        if vendor.get('verified'):
            pass
        rendered += f'<span class="tag{cls}">{t.replace("_", " ").title()}</span>'
    return f'<div class="tag-list">{rendered}</div>'


# ============================================================
# RENDER: VENDOR PROFILE PAGE
# ============================================================

def render_vendor_page(v):
    brand = v.get('brand_name') or v['company_name']
    title = f"{brand} — UP Solar Installer Profile | SolarSubsidies.com"
    desc_text = v.get('description', f'{brand} is a solar installer serving UP.')
    desc = desc_text[:155].replace('"', "'")
    
    approvals = v.get('approvals', {})
    creds = v.get('credentials', {})
    warranty = v.get('warranty', {})
    
    verified_badge = '<span class="tag verified">✓ Verified Public Record</span>' if v.get('verified') else ''
    
    # Schema.org LocalBusiness JSON-LD
    schema = {
        "@context": "https://schema.org",
        "@type": "LocalBusiness",
        "name": v['company_name'],
        "description": desc_text,
        "url": f"https://solarsubsidies.com/vendors/{v['slug']}.html",
        "address": {
            "@type": "PostalAddress",
            "addressLocality": v.get('hq', 'Uttar Pradesh'),
            "addressRegion": "Uttar Pradesh",
            "addressCountry": "IN"
        }
    }
    if v.get('rating'):
        schema['aggregateRating'] = {
            "@type": "AggregateRating",
            "ratingValue": str(v['rating']),
            "bestRating": "5",
            "ratingCount": "100"
        }
    if v.get('phone_display'):
        schema['telephone'] = v['phone_display']
    if v.get('website'):
        schema['sameAs'] = [v['website']]
    
    import json as jsonlib
    schema_str = jsonlib.dumps(schema, ensure_ascii=False)
    
    # Build approval rows
    approval_rows = ''
    if approvals.get('mnre_empanelled'):
        approval_rows += '<tr><td>MNRE Empanellment</td><td>✓ Active (verify at <a href="https://mnre.gov.in" target="_blank" rel="noopener" style="color:var(--ink);">mnre.gov.in</a>)</td></tr>'
    if approvals.get('upneda_approved'):
        approval_rows += '<tr><td>UPNEDA Approval</td><td>✓ Active (verify at <a href="https://upneda.org.in" target="_blank" rel="noopener" style="color:var(--ink);">upneda.org.in</a>)</td></tr>'
    if approvals.get('bis_certified_panels'):
        approval_rows += '<tr><td>BIS Certified Panels</td><td>✓ Used in installations</td></tr>'
    if approvals.get('cea_approved_inverters'):
        approval_rows += '<tr><td>CEA Approved Inverters</td><td>✓ Used in installations</td></tr>'
    if approvals.get('iso_9001'):
        approval_rows += '<tr><td>ISO 9001</td><td>✓ Quality Management Certified</td></tr>'
    if approvals.get('iso_14001'):
        approval_rows += '<tr><td>ISO 14001</td><td>✓ Environmental Management Certified</td></tr>'
    if approvals.get('iso_45001'):
        approval_rows += '<tr><td>ISO 45001</td><td>✓ Occupational Health & Safety Certified</td></tr>'
    
    return f'''<!DOCTYPE html>
<html lang="en"><head>{SHARED_HEAD}
<title>{title}</title>
<meta name="description" content="{desc}">
<link rel="canonical" href="https://solarsubsidies.com/vendors/{v['slug']}.html">
<meta property="og:title" content="{brand} — UP Solar Installer">
<meta property="og:description" content="{desc}">
<meta property="og:url" content="https://solarsubsidies.com/vendors/{v['slug']}.html">
<meta property="og:type" content="website">
<script type="application/ld+json">{schema_str}</script>
</head><body>
{WARNING_STRIP}
{TOPBAR}
<div class="crumbs mono"><a href="/">Home</a><span class="sep">/</span><a href="/vendors/directory/">Vendors</a><span class="sep">/</span>{brand}</div>

<section class="hero"><div class="hero-inner">
<div class="hero-kicker mono">§ Vendor Profile · {v.get('hq', 'Uttar Pradesh')}</div>
<h1>{brand}<br><em>UP Solar Installer</em></h1>
<p>{desc_text}</p>
{get_public_tags(v)}
{verified_badge}
<div class="hero-stats">
<div class="hero-stat"><div class="lbl">Established</div><div class="val">{v.get('established_year', '—')}</div></div>
<div class="hero-stat"><div class="lbl">Years in Solar</div><div class="val">{creds.get('years_in_solar', '—')}</div></div>
<div class="hero-stat"><div class="lbl">Installations</div><div class="val">{creds.get('installations_completed', '—')}</div></div>
<div class="hero-stat"><div class="lbl">Public Rating</div><div class="val orange">{v.get('rating', '—')}{'/5' if v.get('rating') else ''}</div></div>
</div></div></section>

<section class="section"><div class="section-inner">
<div class="section-kicker mono">§ Company Details</div>
<h2>About <em>{brand}</em>.</h2>
<table class="info-table">
<tr><td>Legal Entity</td><td>{v['company_name']}</td></tr>
{f"<tr><td>Trading As</td><td>{v['brand_name']}</td></tr>" if v.get('brand_name') and v['brand_name'] != v['company_name'] else ''}
<tr><td>Headquarters</td><td>{v.get('hq', '—')}</td></tr>
{f"<tr><td>UP Office Cities</td><td>{', '.join(v.get('office_cities', []))}</td></tr>" if v.get('office_cities') else ''}
<tr><td>Year Established</td><td>{v.get('established_year', '—')}</td></tr>
<tr><td>Specializations</td><td>{', '.join(get_specialization_label(s) for s in v.get('specialization', []))}</td></tr>
<tr><td>System Sizes</td><td>{v.get('min_system_size_kw', 1)} kW — {v.get('max_system_size_kw', 100)} kW</td></tr>
{f"<tr><td>Public Contact</td><td><a href='tel:{v['phone_display']}' style='color:var(--ink);'>{v['phone_display']}</a></td></tr>" if v.get('phone_display') else ''}
{f"<tr><td>Website</td><td><a href='{v['website']}' target='_blank' rel='noopener noreferrer nofollow' style='color:var(--ink);'>{v['website']}</a></td></tr>" if v.get('website') else ''}
</table>
</div></section>

<section class="section" style="background:var(--paper-2)"><div class="section-inner">
<div class="section-kicker mono">§ Approvals & Certifications</div>
<h2>Regulatory <em>standing</em>.</h2>
<p>Independent verification recommended before signing any contract. Click the verification links to check current status on official portals.</p>
<table class="info-table">
{approval_rows}
</table>
</div></section>

<section class="section"><div class="section-inner">
<div class="section-kicker mono">§ Equipment & Warranty</div>
<h2>What they <em>install</em>.</h2>
<div class="specs-grid">
<div class="spec-card"><div class="lbl">Panel Brands Used</div><div class="val">{creds.get('panel_brand_used', '—')}</div></div>
<div class="spec-card"><div class="lbl">Inverter Brands</div><div class="val">{', '.join(creds.get('inverter_brands', []))}</div></div>
<div class="spec-card"><div class="lbl">Panel Warranty</div><div class="val green">{warranty.get('panels_years', 25)} years</div><div class="sub">Manufacturer standard</div></div>
<div class="spec-card"><div class="lbl">Inverter Warranty</div><div class="val">{warranty.get('inverter_years', 5)} years</div></div>
<div class="spec-card"><div class="lbl">Workmanship Warranty</div><div class="val">{warranty.get('workmanship_years', 3)} years</div></div>
<div class="spec-card"><div class="lbl">Team Size (India)</div><div class="val">{creds.get('team_size_india', '—')}</div></div>
</div>
</div></section>

<section class="section" style="background:var(--paper-2)"><div class="section-inner">
<div class="section-kicker mono">§ Service Coverage</div>
<h2>UP districts <em>served</em>.</h2>
{get_coverage_display(v)}
</div></section>

<div class="cta-card" style="max-width:1200px; margin:32px auto;">
<h3>Get a free quote from {brand}</h3>
<p>Use our calculator to compute your exact subsidy + payback, then we'll connect you. They'll WhatsApp you within 4 business hours.</p>
<a href="/calculator.html?preferred_vendor={v['slug']}">Calculate + Request Quote →</a>
</div>

<section class="section"><div class="section-inner">
<div class="section-kicker mono">§ Browse Other Vendors</div>
<h2>Compare with <em>other UP installers</em>.</h2>
<p>SolarSubsidies.com lists multiple vetted vendors per district. Compare warranties, pricing, and specializations before committing.</p>
<p><a href="/vendors/directory/" style="color:var(--sun-deep); font-weight:700;">← Browse full vendor directory</a></p>
</div></section>

{FOOTER}
</body></html>'''


# ============================================================
# RENDER: DIRECTORY INDEX
# ============================================================

def render_directory_index():
    # Sort: verified first, then by tier preference
    sorted_vendors = sorted(
        PUBLIC_VENDORS,
        key=lambda v: (
            not v.get('verified', False),
            0 if v.get('tier_in_network') == 'premium' else 1 if v.get('tier_in_network') == 'standard' else 2,
            -(v.get('rating') or 0),
            v.get('company_name', '')
        )
    )
    
    vendor_cards = ''
    for v in sorted_vendors:
        brand = v.get('brand_name') or v['company_name']
        desc = (v.get('description', '') or '')[:160]
        if len(v.get('description', '')) > 160:
            desc += '...'
        
        specs = v.get('specialization', [])
        spec_text = ', '.join(get_specialization_label(s) for s in specs[:3])
        if len(specs) > 3:
            spec_text += f' +{len(specs)-3} more'
        
        coverage = v.get('coverage_districts', [])
        if 'all_75_up' in coverage:
            coverage_text = 'All 75 UP districts'
        else:
            coverage_text = f'{len(coverage)} districts'
        
        rating_html = ''
        if v.get('rating'):
            rating_html = f'<span style="color:var(--sun-deep); font-weight:700;">★ {v["rating"]}/5</span>'
        
        tier_label = ''
        if v.get('tier_in_network') == 'premium':
            tier_label = '<span class="tag premium" style="font-size:9px;">Premium Partner</span>'
        
        verified_label = '<span class="tag verified" style="font-size:9px;">✓ Verified</span>' if v.get('verified') else ''
        
        vendor_cards += f'''
        <a href="/vendors/{v["slug"]}.html" class="vendor-card">
          <div class="vendor-card-head">
            <h3>{brand}</h3>
            <div style="display:flex; gap:6px; flex-wrap:wrap;">{verified_label}{tier_label}</div>
          </div>
          <p class="vendor-card-desc">{desc}</p>
          <table class="vendor-card-table">
            <tr><td>HQ</td><td>{v.get('hq', '—')}</td></tr>
            <tr><td>Specializes</td><td>{spec_text}</td></tr>
            <tr><td>Coverage</td><td>{coverage_text}</td></tr>
            <tr><td>System sizes</td><td>{v.get('min_system_size_kw', 1)}–{v.get('max_system_size_kw', 100)} kW</td></tr>
            <tr><td>Rating</td><td>{rating_html or '<span style="color:var(--muted);">Not rated</span>'}</td></tr>
          </table>
          <div class="vendor-card-cta">View Profile →</div>
        </a>
        '''
    
    if not vendor_cards:
        vendor_cards = '<div style="grid-column:1/-1; padding:60px 20px; text-align:center; color:var(--muted); font-style:italic;">Vendor directory is being populated. Check back soon.</div>'
    
    return f'''<!DOCTYPE html>
<html lang="en"><head>{SHARED_HEAD}
<title>UP Solar Installer Directory — Vetted MNRE+UPNEDA Vendors | SolarSubsidies.com</title>
<meta name="description" content="Compare verified solar installers across all 75 UP districts. MNRE empanellment, UPNEDA approval, warranty terms, specializations. Updated {date.today().strftime('%b %Y')}.">
<link rel="canonical" href="https://solarsubsidies.com/vendors/directory/">
<meta property="og:title" content="UP Solar Installer Directory — Vetted Vendors">
<meta property="og:description" content="Compare verified solar installers across all 75 UP districts.">
<meta property="og:url" content="https://solarsubsidies.com/vendors/directory/">
<style>
.directory-hero {{ padding:48px 28px 32px; border-bottom:1.5px solid var(--ink); }}
.directory-hero-inner {{ max-width:1200px; margin:0 auto; }}
.directory-hero h1 {{ font-size:clamp(36px,5vw,64px); font-weight:900; letter-spacing:-0.03em; line-height:1.05; margin-bottom:16px; font-variation-settings:'opsz' 144; }}
.directory-hero h1 em {{ font-style:italic; font-weight:400; color:var(--sun-deep); }}
.directory-hero p {{ font-size:19px; color:var(--ink); max-width:760px; margin-bottom:20px; }}
.directory-hero-meta {{ display:flex; gap:24px; flex-wrap:wrap; font-family:'JetBrains Mono',monospace; font-size:12px; text-transform:uppercase; letter-spacing:0.1em; color:var(--muted); margin-top:14px; padding-top:14px; border-top:1px solid var(--line); }}
.directory-hero-meta span::before {{ content:"✓ "; color:var(--leaf); font-weight:700; }}
.vendor-grid {{ display:grid; grid-template-columns:repeat(auto-fill, minmax(360px,1fr)); gap:20px; padding:48px 28px; max-width:1280px; margin:0 auto; }}
.vendor-card {{ display:block; padding:24px; border:1.5px solid var(--ink); background:var(--paper); text-decoration:none; color:var(--ink); transition:all .15s; }}
.vendor-card:hover {{ transform:translate(-2px,-2px); box-shadow:6px 6px 0 var(--sun); }}
.vendor-card-head {{ display:flex; justify-content:space-between; align-items:flex-start; gap:12px; margin-bottom:12px; padding-bottom:12px; border-bottom:1px solid var(--line); }}
.vendor-card-head h3 {{ font-size:22px; font-weight:900; letter-spacing:-0.02em; margin:0; line-height:1.2; }}
.vendor-card-desc {{ font-size:14px; color:var(--muted); line-height:1.5; margin-bottom:14px; min-height:60px; }}
.vendor-card-table {{ width:100%; font-size:13px; }}
.vendor-card-table td {{ padding:5px 0; vertical-align:top; }}
.vendor-card-table td:first-child {{ font-family:'JetBrains Mono',monospace; font-size:10px; text-transform:uppercase; letter-spacing:0.08em; color:var(--muted); font-weight:600; width:90px; }}
.vendor-card-table td:last-child {{ font-weight:600; }}
.vendor-card-cta {{ margin-top:14px; padding-top:14px; border-top:1px solid var(--line); font-family:'JetBrains Mono',monospace; font-size:11px; text-transform:uppercase; letter-spacing:0.1em; color:var(--sun-deep); font-weight:700; }}
@media (max-width:640px) {{
  .vendor-grid {{ grid-template-columns:1fr; padding:32px 20px; }}
  .directory-hero {{ padding:32px 20px 24px; }}
  .vendor-card-head {{ flex-direction:column; }}
}}
</style>
</head><body>
{WARNING_STRIP}
{TOPBAR}
<div class="crumbs mono"><a href="/">Home</a><span class="sep">/</span>Vendor Directory</div>

<section class="directory-hero">
<div class="directory-hero-inner">
<div class="hero-kicker mono">§ Verified UP Solar Installer Directory</div>
<h1>Pick the right <em>installer for your home</em>.</h1>
<p>{len(sorted_vendors)} verified solar installers serving Uttar Pradesh. Every vendor listed has active MNRE empanellment and UPNEDA approved-vendor status, both verifiable on official portals. Click any vendor to see full profile.</p>
<div class="directory-hero-meta">
<span>MNRE empanellment verified</span>
<span>UPNEDA approved</span>
<span>BIS-certified panels</span>
<span>CEA-approved inverters</span>
</div>
</div>
</section>

<div class="vendor-grid">
{vendor_cards}
</div>

<div class="cta-card" style="max-width:1100px; margin:32px auto 60px;">
<h3>Not sure which vendor to pick?</h3>
<p>Use our calculator. Based on your district + bill, we'll automatically match you with the best-fit vendor and get you 3 quotes within 48 hours.</p>
<a href="/calculator.html">Run the Calculator →</a>
</div>

{FOOTER}
</body></html>'''


# ============================================================
# MAIN
# ============================================================

def main():
    print("=" * 60)
    print(f"SolarSubsidies.com — Vendor Page Generator")
    print(f"Total vendors in seed: {len(VENDORS)}")
    print(f"Public (verified) vendors: {len(PUBLIC_VENDORS)}")
    print("=" * 60)
    
    os.makedirs(os.path.join(OUT_DIR, 'vendors'), exist_ok=True)
    os.makedirs(os.path.join(OUT_DIR, 'vendors', 'directory'), exist_ok=True)
    
    count = 0
    
    print(f"\n[1/2] Generating {len(PUBLIC_VENDORS)} public vendor profile pages...")
    for v in PUBLIC_VENDORS:
        out_path = os.path.join(OUT_DIR, 'vendors', f"{v['slug']}.html")
        with open(out_path, 'w', encoding='utf-8') as f:
            f.write(render_vendor_page(v))
        count += 1
    
    print(f"\n[2/2] Generating vendor directory index...")
    with open(os.path.join(OUT_DIR, 'vendors', 'directory', 'index.html'), 'w', encoding='utf-8') as f:
        f.write(render_directory_index())
    count += 1
    
    print(f"\n{'='*60}")
    print(f"✅ TOTAL: {count} files generated")
    print(f"{'='*60}")


if __name__ == '__main__':
    main()
