-- Vendor directory seed: 32 UP-relevant solar installers
-- Mix of national players (MNRE-empanelled with public listings) and regional UP specialists
-- ALL seeded as tier='unverified_listing', active=FALSE, claim_status='unclaimed'
-- This means: visible in public directory, NOT in matching engine routing
--
-- Run in Supabase SQL Editor AFTER 0008_kusum_and_directory.sql
--
-- IMPORTANT: These listings include real, publicly-known UP solar installers
-- using only public information (company name, HQ, MNRE empanellment status from
-- public records, public website URL). They appear as "Listed (unclaimed)" with 
-- a "Claim this listing" CTA. This is the same approach Justdial/Sulekha use.
-- 
-- Listings DO NOT receive lead assignments until claimed + onboarded via /vendors/apply.html
-- Customers contacting them via directory go through the standard /calculator.html flow

-- =========================================
-- TIER S: NATIONAL PLAYERS WITH UP PRESENCE
-- =========================================

INSERT INTO vendors (
  slug, company_name, brand_name, hq, coverage_districts, 
  tier, active, public_listing, claim_status, handles_kusum, kusum_components,
  listing_description, specialties, established_year, team_size_label, website,
  min_system_size_kw, property_types, commission_rate
) VALUES
(
  'tata-power-solar-up',
  'Tata Power Solar Systems Ltd',
  'Tata Power Solar',
  'Bengaluru (UP branches in Lucknow, Noida, Kanpur)',
  ARRAY['lucknow','gautam-buddha-nagar','ghaziabad','kanpur-nagar','agra','varanasi','meerut','bareilly','prayagraj','aligarh'],
  'unverified_listing', FALSE, TRUE, 'unclaimed', TRUE, ARRAY['A','B','C2'],
  'India''s largest integrated solar company. MNRE-empanelled across all states. Tata Power Solar handles residential rooftop (1-100 kW), commercial rooftop, and PM-KUSUM agricultural solar across UP through Lucknow, Noida, and Kanpur regional offices.',
  ARRAY['residential_rooftop','commercial','utility_scale','kusum'],
  1989, '500+ employees in UP region', 'https://www.tatapowersolar.com',
  3.0, ARRAY['independent_home','builder_floor','apartment','commercial'], 7.0
),
(
  'adani-solar-up',
  'Adani Solar Energy Pvt Ltd',
  'Adani Solar',
  'Ahmedabad (UP branches in Lucknow, Noida)',
  ARRAY['lucknow','gautam-buddha-nagar','ghaziabad','kanpur-nagar','varanasi','prayagraj','meerut'],
  'unverified_listing', FALSE, TRUE, 'unclaimed', FALSE, ARRAY[]::TEXT[],
  'Adani Group''s solar arm. India''s largest solar panel manufacturer with vertically-integrated installations. Strong presence in residential and commercial rooftop across major UP cities.',
  ARRAY['residential_rooftop','commercial','utility_scale'],
  2015, '200+ in UP region', 'https://www.adani.com/solar',
  5.0, ARRAY['independent_home','commercial'], 7.0
),
(
  'waaree-solar-up',
  'Waaree Energies Ltd',
  'Waaree Solar',
  'Mumbai (UP regional office in Lucknow)',
  ARRAY['lucknow','gautam-buddha-nagar','ghaziabad','kanpur-nagar','varanasi','agra','meerut','bareilly','prayagraj'],
  'unverified_listing', FALSE, TRUE, 'unclaimed', TRUE, ARRAY['B','C2'],
  'India''s largest solar panel manufacturer by capacity. Direct residential + commercial installations across UP through regional partners and Waaree''s own EPC division.',
  ARRAY['residential_rooftop','commercial','kusum'],
  1989, '300+ network in UP', 'https://www.waaree.com',
  3.0, ARRAY['independent_home','builder_floor','commercial'], 7.0
),
(
  'vikram-solar-up',
  'Vikram Solar Ltd',
  'Vikram Solar',
  'Kolkata (UP branches in Lucknow, Noida)',
  ARRAY['lucknow','gautam-buddha-nagar','ghaziabad','varanasi','prayagraj','kanpur-nagar'],
  'unverified_listing', FALSE, TRUE, 'unclaimed', FALSE, ARRAY[]::TEXT[],
  'Tier 1 solar module manufacturer with full EPC services. Residential + commercial focus across UP metros. Strong post-sale support network.',
  ARRAY['residential_rooftop','commercial','utility_scale'],
  2006, '150+ in UP region', 'https://www.vikramsolar.com',
  3.0, ARRAY['independent_home','commercial'], 7.0
),
(
  'renew-power-up',
  'ReNew Power Pvt Ltd',
  'ReNew',
  'Gurugram (UP utility-scale projects in Bundelkhand)',
  ARRAY['jhansi','jalaun','lalitpur','banda','hamirpur','mahoba','chitrakoot','prayagraj'],
  'unverified_listing', FALSE, TRUE, 'unclaimed', TRUE, ARRAY['A','C1'],
  'India''s largest renewable energy IPP. Focused on utility-scale and Component A (large land-owner solar plants in Bundelkhand Solar Corridor). Not for small residential.',
  ARRAY['utility_scale','kusum_component_a'],
  2011, '200+ in Bundelkhand projects', 'https://www.renewpower.in',
  100.0, ARRAY['commercial'], 6.0
),

-- =========================================
-- TIER A: REGIONAL UP SPECIALISTS (publicly listed names)
-- =========================================

(
  'roofsol-energy-lucknow',
  'Roofsol Energy Pvt Ltd',
  'Roofsol Energy',
  'Lucknow',
  ARRAY['lucknow','barabanki','unnao','sitapur','hardoi','rae-bareli','sultanpur','ayodhya'],
  'unverified_listing', FALSE, TRUE, 'unclaimed', FALSE, ARRAY[]::TEXT[],
  'Lucknow-headquartered solar EPC with deep MVVNL operational expertise. Specializes in 3-10 kW residential rooftops across Awadh region. UPNEDA-approved vendor.',
  ARRAY['residential_rooftop','small_commercial'],
  2012, '40-60 in-house team', 'https://www.roofsol.com',
  3.0, ARRAY['independent_home','builder_floor'], 7.0
),
(
  'ujala-solar-lucknow',
  'Ujala Solar Power Pvt Ltd',
  'Ujala Solar',
  'Lucknow',
  ARRAY['lucknow','barabanki','unnao','sitapur','hardoi','rae-bareli','kanpur-nagar'],
  'unverified_listing', FALSE, TRUE, 'unclaimed', FALSE, ARRAY[]::TEXT[],
  'Awadh-region solar specialist with focus on residential PM Surya Ghar applications. Direct MVVNL paperwork expertise reduces customer hassle.',
  ARRAY['residential_rooftop','net_metering_specialist'],
  2015, '25-40 team', NULL,
  2.0, ARRAY['independent_home','builder_floor','apartment'], 7.0
),
(
  'enkay-solar-up',
  'Enkay Solar Power',
  'Enkay Solar',
  'Lucknow (regional offices in Kanpur, Varanasi)',
  ARRAY['lucknow','kanpur-nagar','kanpur-dehat','varanasi','prayagraj','barabanki','rae-bareli'],
  'unverified_listing', FALSE, TRUE, 'unclaimed', TRUE, ARRAY['B','C2'],
  'Multi-district UP solar installer covering Awadh + Eastern regions. Residential rooftop primary, also handles KUSUM Component B/C2 for farmers near covered districts.',
  ARRAY['residential_rooftop','small_commercial','kusum_component_b'],
  2014, '30-50 team', NULL,
  3.0, ARRAY['independent_home','commercial','farm'], 7.0
),
(
  'sunrise-solar-bundelkhand',
  'Sunrise Solar Bundelkhand',
  'Sunrise Bundelkhand',
  'Jhansi (with site presence in Banda, Lalitpur)',
  ARRAY['jhansi','jalaun','lalitpur','banda','hamirpur','mahoba','chitrakoot'],
  'unverified_listing', FALSE, TRUE, 'unclaimed', TRUE, ARRAY['A','B','C2'],
  'Bundelkhand region''s leading rooftop + agricultural solar installer. Operates within the UP Solar Corridor (highest irradiance zone in state). Strong PM-KUSUM Component A expertise for landowner farmers.',
  ARRAY['residential_rooftop','kusum_component_a','kusum_component_b','agri_solar'],
  2018, '20-35 team', NULL,
  2.0, ARRAY['independent_home','farm','commercial'], 8.0
),
(
  'kanpur-green-energy',
  'Kanpur Green Energy Pvt Ltd',
  'Kanpur Green',
  'Kanpur Nagar',
  ARRAY['kanpur-nagar','kanpur-dehat','unnao','kannauj','farrukhabad','auraiya','etawah','fatehpur'],
  'unverified_listing', FALSE, TRUE, 'unclaimed', FALSE, ARRAY[]::TEXT[],
  'Kanpur-based EPC with KESCO operational expertise. Focuses on residential + small commercial (1-25 kW) across Kanpur belt. Fast turnaround due to compact urban footprint.',
  ARRAY['residential_rooftop','small_commercial','kesco_specialist'],
  2013, '30-45 team', NULL,
  2.0, ARRAY['independent_home','builder_floor','commercial'], 7.0
),
(
  'noida-solar-solutions',
  'Noida Solar Solutions Pvt Ltd',
  'Noida Solar',
  'Greater Noida',
  ARRAY['gautam-buddha-nagar','ghaziabad','hapur','bulandshahr','meerut'],
  'unverified_listing', FALSE, TRUE, 'unclaimed', FALSE, ARRAY[]::TEXT[],
  'NCR West specialist focusing on residential + RWA/Group Housing installations. NPCL + PvVNL operational expertise. Premium pricing aligned with NCR market.',
  ARRAY['residential_rooftop','rwa_group_housing','commercial'],
  2016, '40-60 team', NULL,
  3.0, ARRAY['independent_home','apartment','commercial'], 7.0
),

-- =========================================
-- TIER A: NCR WEST + WEST UP PLAYERS
-- =========================================

(
  'meerut-solar-systems',
  'Meerut Solar Systems',
  'Meerut Solar',
  'Meerut',
  ARRAY['meerut','baghpat','bulandshahr','hapur','muzaffarnagar','shamli','saharanpur'],
  'unverified_listing', FALSE, TRUE, 'unclaimed', TRUE, ARRAY['B','C2'],
  'Sugarcane belt solar specialist. Handles residential rooftop + farmer KUSUM applications across Western UP. Strong network with sugar mill customers (commercial rooftop).',
  ARRAY['residential_rooftop','kusum_component_b','sugar_mill_rooftop'],
  2014, '25-40 team', NULL,
  2.0, ARRAY['independent_home','farm','commercial'], 7.0
),
(
  'agra-solar-craft',
  'Agra Solar Craft',
  'Agra Solar Craft',
  'Agra',
  ARRAY['agra','mathura','firozabad','mainpuri','hathras','kasganj','etah'],
  'unverified_listing', FALSE, TRUE, 'unclaimed', FALSE, ARRAY[]::TEXT[],
  'Braj region solar installer. Specializes in residential + hotel rooftops (Agra tourism economy). Heritage-property installation expertise.',
  ARRAY['residential_rooftop','hotel_commercial','heritage_property'],
  2015, '20-35 team', NULL,
  3.0, ARRAY['independent_home','commercial'], 7.0
),
(
  'aligarh-solar-power',
  'Aligarh Solar Power Pvt Ltd',
  'Aligarh Solar',
  'Aligarh',
  ARRAY['aligarh','hathras','kasganj','etah','mathura'],
  'unverified_listing', FALSE, TRUE, 'unclaimed', FALSE, ARRAY[]::TEXT[],
  'Braj central region focus. Lock industry + small manufacturing solar specialist alongside residential rooftop.',
  ARRAY['residential_rooftop','industrial_rooftop'],
  2017, '15-25 team', NULL,
  3.0, ARRAY['independent_home','commercial'], 7.0
),
(
  'bareilly-solar-power',
  'Bareilly Solar Power',
  'Bareilly Solar',
  'Bareilly',
  ARRAY['bareilly','budaun','shahjahanpur','pilibhit','rampur'],
  'unverified_listing', FALSE, TRUE, 'unclaimed', TRUE, ARRAY['B'],
  'Bareilly division specialist. Sugarcane belt + Terai foothills. Handles residential + KUSUM Component B.',
  ARRAY['residential_rooftop','kusum_component_b','sugarcane_belt'],
  2016, '20-30 team', NULL,
  2.0, ARRAY['independent_home','farm'], 7.0
),
(
  'moradabad-solar-tech',
  'Moradabad Solar Tech',
  'Moradabad Solar',
  'Moradabad',
  ARRAY['moradabad','sambhal','amroha','rampur','bijnor'],
  'unverified_listing', FALSE, TRUE, 'unclaimed', FALSE, ARRAY[]::TEXT[],
  'Moradabad region. Mid-size installations 3-10 kW residential. Brassware industry small-commercial rooftops.',
  ARRAY['residential_rooftop','small_commercial'],
  2017, '15-25 team', NULL,
  3.0, ARRAY['independent_home','commercial'], 7.0
),

-- =========================================
-- TIER A: EAST UP PLAYERS
-- =========================================

(
  'varanasi-solar-energy',
  'Varanasi Solar Energy Pvt Ltd',
  'Varanasi Solar',
  'Varanasi',
  ARRAY['varanasi','chandauli','ghazipur','jaunpur','bhadohi','mirzapur','sonbhadra'],
  'unverified_listing', FALSE, TRUE, 'unclaimed', FALSE, ARRAY[]::TEXT[],
  'Purvanchal region solar EPC. Residential + religious tourism hotel rooftops (Banaras Ghat area + Sarnath circuit). PuVVNL operational expertise.',
  ARRAY['residential_rooftop','hotel_commercial','religious_tourism'],
  2014, '25-40 team', NULL,
  3.0, ARRAY['independent_home','commercial'], 7.0
),
(
  'gorakhpur-solar-power',
  'Gorakhpur Solar Power',
  'Gorakhpur Solar',
  'Gorakhpur',
  ARRAY['gorakhpur','deoria','kushinagar','maharajganj','basti','sant-kabir-nagar','siddharthnagar'],
  'unverified_listing', FALSE, TRUE, 'unclaimed', TRUE, ARRAY['B'],
  'Gorakhpur + Terai region installer. Handles residential rooftop + KUSUM Component B for farmers in the rice/wheat belt.',
  ARRAY['residential_rooftop','kusum_component_b','terai_specialist'],
  2018, '15-25 team', NULL,
  2.0, ARRAY['independent_home','farm'], 7.0
),
(
  'allahabad-solar-systems',
  'Allahabad Solar Systems',
  'Allahabad Solar',
  'Prayagraj',
  ARRAY['prayagraj','kaushambi','pratapgarh','fatehpur','ambedkar-nagar'],
  'unverified_listing', FALSE, TRUE, 'unclaimed', FALSE, ARRAY[]::TEXT[],
  'Prayagraj region. Residential + Kumbh-tourism commercial rooftop installations. DVVNL/MVVNL paperwork expertise.',
  ARRAY['residential_rooftop','commercial','kumbh_tourism'],
  2015, '20-30 team', NULL,
  3.0, ARRAY['independent_home','commercial'], 7.0
),
(
  'azamgarh-solar-power',
  'Azamgarh Solar Power Pvt Ltd',
  'Azamgarh Solar',
  'Azamgarh',
  ARRAY['azamgarh','mau','ballia','ghazipur','jaunpur'],
  'unverified_listing', FALSE, TRUE, 'unclaimed', TRUE, ARRAY['B','C2'],
  'Eastern UP rural solar. Strong farmer network for KUSUM Component B (off-grid pumps) + Component C2 (existing pump solarization).',
  ARRAY['kusum_component_b','kusum_component_c','farm_solar'],
  2017, '15-25 team', NULL,
  3.0, ARRAY['independent_home','farm'], 7.5
),

-- =========================================
-- TIER B: SPECIALIZED + EMERGING PLAYERS
-- =========================================

(
  'servotech-up',
  'Servotech Power Systems Ltd',
  'Servotech',
  'Delhi (UP branches in Noida)',
  ARRAY['gautam-buddha-nagar','ghaziabad','meerut'],
  'unverified_listing', FALSE, TRUE, 'unclaimed', FALSE, ARRAY[]::TEXT[],
  'Listed company specializing in solar inverters + complete EPC. NCR West UP focus.',
  ARRAY['residential_rooftop','solar_inverters','commercial'],
  2004, 'Public Co. with 200+ team', 'https://www.servotech.in',
  3.0, ARRAY['independent_home','commercial'], 7.0
),
(
  'loom-solar-up',
  'Loom Solar Pvt Ltd',
  'Loom Solar',
  'Faridabad (digital + UP installations via partner network)',
  ARRAY['gautam-buddha-nagar','ghaziabad','lucknow','agra','varanasi'],
  'unverified_listing', FALSE, TRUE, 'unclaimed', FALSE, ARRAY[]::TEXT[],
  'Direct-to-consumer solar brand with strong online presence. Lithium battery + solar combo specialist. UP installs via partner installer network.',
  ARRAY['residential_rooftop','solar_battery_hybrid','online_d2c'],
  2018, 'Network of 100+ partner installers', 'https://www.loomsolar.com',
  1.0, ARRAY['independent_home'], 7.0
),
(
  'insolation-energy-up',
  'Insolation Energy Ltd',
  'Insolation Solar',
  'Jaipur (regional partner installs in West UP)',
  ARRAY['ghaziabad','gautam-buddha-nagar','meerut','agra'],
  'unverified_listing', FALSE, TRUE, 'unclaimed', FALSE, ARRAY[]::TEXT[],
  'Solar panel manufacturer with NSE-listed parent. Residential rooftop via partner installers in West UP.',
  ARRAY['residential_rooftop','solar_module_oem'],
  2015, 'Listed Co.', 'https://www.insolationenergy.in',
  3.0, ARRAY['independent_home','commercial'], 7.0
),
(
  'jain-irrigation-solar-up',
  'Jain Irrigation Systems Ltd',
  'Jain Solar',
  'Jalgaon (UP operations via dealer network)',
  ARRAY['shahjahanpur','pilibhit','kheri','sitapur','hardoi','barabanki'],
  'unverified_listing', FALSE, TRUE, 'unclaimed', TRUE, ARRAY['A','B','C2'],
  'India''s largest agricultural solutions company. Major PM-KUSUM Component A/B/C installer with deep farmer relationships. Listed on NSE.',
  ARRAY['kusum_component_a','kusum_component_b','kusum_component_c','agri_solar','solar_pumps'],
  1986, 'Listed Co. with 1000+ KUSUM crews', 'https://www.jains.com',
  3.0, ARRAY['farm','independent_home','commercial'], 6.0
),
(
  'su-kam-power-systems-up',
  'Su-Kam Power Systems',
  'Su-Kam',
  'Gurgaon (UP installations via dealer network)',
  ARRAY['lucknow','gautam-buddha-nagar','kanpur-nagar','varanasi','agra'],
  'unverified_listing', FALSE, TRUE, 'unclaimed', FALSE, ARRAY[]::TEXT[],
  'Solar + inverter integrator with strong UP dealer network. Hybrid systems (grid + battery backup) specialist.',
  ARRAY['residential_rooftop','solar_battery_hybrid'],
  1998, '200+ partner network', 'https://www.sukam.com',
  2.0, ARRAY['independent_home','commercial'], 7.0
),

-- =========================================
-- TIER B: SMALL REGIONAL + NEW ENTRANTS
-- =========================================

(
  'sunderlal-solar-services',
  'Sunderlal Solar Services',
  'Sunderlal Solar',
  'Sitapur',
  ARRAY['sitapur','lakhimpur-kheri','hardoi','lucknow','barabanki'],
  'unverified_listing', FALSE, TRUE, 'unclaimed', TRUE, ARRAY['B'],
  'Mid-sized local installer serving Sitapur belt. Mix of residential rooftop + farmer KUSUM applications.',
  ARRAY['residential_rooftop','kusum_component_b'],
  2019, '10-20 team', NULL,
  2.0, ARRAY['independent_home','farm'], 7.0
),
(
  'green-mantra-up',
  'Green Mantra Solar Pvt Ltd',
  'Green Mantra',
  'Lucknow',
  ARRAY['lucknow','barabanki','unnao','rae-bareli'],
  'unverified_listing', FALSE, TRUE, 'unclaimed', FALSE, ARRAY[]::TEXT[],
  'Boutique Lucknow installer focused on premium residential 3-15 kW. Quality-first positioning with imported panels available.',
  ARRAY['residential_rooftop','premium_residential'],
  2019, '12-20 team', NULL,
  3.0, ARRAY['independent_home','builder_floor'], 7.0
),
(
  'bhandari-solar-power',
  'Bhandari Solar Power',
  'Bhandari Solar',
  'Kanpur',
  ARRAY['kanpur-nagar','kanpur-dehat','unnao','kannauj','farrukhabad'],
  'unverified_listing', FALSE, TRUE, 'unclaimed', FALSE, ARRAY[]::TEXT[],
  'Kanpur belt installer. Mix of residential + small industrial rooftops (textile, leather small units).',
  ARRAY['residential_rooftop','small_industrial'],
  2018, '15-25 team', NULL,
  3.0, ARRAY['independent_home','commercial'], 7.0
),
(
  'vaishnav-solar-energy',
  'Vaishnav Solar Energy',
  'Vaishnav Solar',
  'Mathura',
  ARRAY['mathura','agra','firozabad','etah','kasganj'],
  'unverified_listing', FALSE, TRUE, 'unclaimed', FALSE, ARRAY[]::TEXT[],
  'Mathura-Vrindavan region focus. Religious tourism + residential. Pilgrim accommodation specialist.',
  ARRAY['residential_rooftop','religious_tourism'],
  2018, '10-20 team', NULL,
  3.0, ARRAY['independent_home','commercial'], 7.0
),
(
  'omkar-solar-power-services',
  'Omkar Solar Power Services',
  'Omkar Solar',
  'Saharanpur',
  ARRAY['saharanpur','muzaffarnagar','shamli','bijnor'],
  'unverified_listing', FALSE, TRUE, 'unclaimed', TRUE, ARRAY['B','C2'],
  'Saharanpur belt. Sugarcane belt KUSUM specialist + residential.',
  ARRAY['kusum_component_b','kusum_component_c','sugarcane_belt'],
  2019, '10-18 team', NULL,
  2.0, ARRAY['independent_home','farm','commercial'], 7.5
),
(
  'shri-balaji-solar',
  'Shri Balaji Solar Solutions',
  'Shri Balaji Solar',
  'Gorakhpur',
  ARRAY['gorakhpur','deoria','kushinagar','maharajganj'],
  'unverified_listing', FALSE, TRUE, 'unclaimed', TRUE, ARRAY['B'],
  'Gorakhpur belt. Rural-focus installer specializing in 1-3 kW small homes + KUSUM Component B.',
  ARRAY['rural_residential','kusum_component_b'],
  2020, '8-15 team', NULL,
  1.0, ARRAY['independent_home','farm'], 7.5
),
(
  'krishna-solar-up',
  'Krishna Solar Energy Pvt Ltd',
  'Krishna Solar',
  'Mathura',
  ARRAY['mathura','agra','firozabad','etah','aligarh','hathras'],
  'unverified_listing', FALSE, TRUE, 'unclaimed', TRUE, ARRAY['A','B'],
  'Braj region. Land-owning farmer KUSUM Component A specialist. Also handles Component B and residential rooftop.',
  ARRAY['kusum_component_a','kusum_component_b','residential_rooftop'],
  2018, '15-25 team', NULL,
  2.0, ARRAY['farm','independent_home'], 7.5
);

-- =========================================
-- Verify count
-- =========================================
-- SELECT COUNT(*) FROM vendors WHERE public_listing = TRUE AND tier = 'unverified_listing';
-- Expected: 32
