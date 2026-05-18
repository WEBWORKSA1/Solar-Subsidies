/**
 * SolarSubsidies.com — Calculator Engine
 * Version: 1.0
 * Last updated: 2026-05-18
 * 
 * Pure functions. No DOM. Browser-compatible (no ESM imports).
 * Exposed via window.SolarCalc global.
 */

// ============================================================
// CONSTANTS — Match data/subsidies.json
// ============================================================

const PM_SURYA_GHAR_TIERS = [
  { maxKw: 1, perKw: 30000 },
  { maxKw: 2, perKw: 30000 },
  { maxKw: 3, perKw: 18000 },
];
const PM_SURYA_GHAR_CAP = 78000;

const STATE_SUBSIDY = {
  up: { perKw: 15000, capKw: 2, cap: 30000, name: 'Uttar Pradesh', nameHi: 'उत्तर प्रदेश' },
  gj: { perKw: 0,     capKw: 0, cap: 40000, name: 'Gujarat',       nameHi: 'ગુજરાત', flatRate: true },
  dl: { perKw: 0,     capKw: 0, cap: 10000, name: 'Delhi',         nameHi: 'दिल्ली', flatRate: true },
  mh: { perKw: 0,     capKw: 0, cap: 0,     name: 'Maharashtra',   nameHi: 'महाराष्ट्र' },
  rj: { perKw: 0,     capKw: 0, cap: 0,     name: 'Rajasthan',     nameHi: 'राजस्थान' },
  hr: { perKw: 0,     capKw: 0, cap: 0,     name: 'Haryana',       nameHi: 'हरियाणा' },
  pb: { perKw: 0,     capKw: 0, cap: 0,     name: 'Punjab',        nameHi: 'ਪੰਜਾਬ' },
  ka: { perKw: 0,     capKw: 0, cap: 0,     name: 'Karnataka',     nameHi: 'ಕರ್ನಾಟಕ' },
  tn: { perKw: 0,     capKw: 0, cap: 0,     name: 'Tamil Nadu',    nameHi: 'தமிழ்நாடு' },
  other: { perKw: 0,  capKw: 0, cap: 0,     name: 'Other',         nameHi: 'अन्य' }
};

const GROSS_COST_PER_KW = {
  up: 70000, mh: 75000, gj: 68000, dl: 72000, rj: 70000,
  hr: 72000, pb: 73000, ka: 73000, tn: 72000, other: 72000
};

const TARIFFS = {
  residential: 7.0, rwa: 7.0, commercial: 9.0, industrial: 8.5, farm: 2.0
};

const IRRADIANCE_DEFAULT_KWH_M2 = 5.0;
const SYSTEM_EFFICIENCY = 0.75;
const SYSTEM_LIFETIME_YEARS = 25;
const ANNUAL_TARIFF_ESCALATION = 0.04;

const KUSUM_PUMP_COSTS = {
  3: 230000, 5: 320000, 7.5: 470000, 10: 580000
};

// ============================================================
// CORE CALCULATION FUNCTIONS
// ============================================================

function pmSuryaGharSubsidy(kw) {
  if (kw <= 0) return 0;
  if (kw >= 3) return PM_SURYA_GHAR_CAP;
  if (kw <= 1) return kw * 30000;
  if (kw <= 2) return 30000 + (kw - 1) * 30000;
  return 60000 + (kw - 2) * 18000;
}

function stateSubsidy(kw, stateCode) {
  const rule = STATE_SUBSIDY[stateCode] || STATE_SUBSIDY.other;
  if (rule.cap === 0) return 0;
  if (rule.flatRate) return rule.cap;
  return Math.min(kw * rule.perKw, rule.cap);
}

function calculateSubsidy(input) {
  const {
    state = 'up',
    sizeKw = 3,
    propertyType = 'residential',
    monthlyBill = 3500,
    irradiance = null,
    panelType = 'mono_perc'
  } = input;

  const isResidential = propertyType === 'residential' || propertyType === 'rwa';
  const isFarm = propertyType === 'farm';
  
  const central = isResidential ? pmSuryaGharSubsidy(sizeKw) : 0;
  const state_sub = isResidential ? stateSubsidy(sizeKw, state) : 0;
  const totalSubsidy = central + state_sub;
  
  const grossPerKw = GROSS_COST_PER_KW[state] || GROSS_COST_PER_KW.other;
  const grossCost = sizeKw * grossPerKw;
  const netCost = Math.max(0, grossCost - totalSubsidy);
  
  const dailyIrr = irradiance || IRRADIANCE_DEFAULT_KWH_M2;
  const monthlyUnits = Math.round(sizeKw * dailyIrr * 30 * SYSTEM_EFFICIENCY);
  const annualUnits = monthlyUnits * 12;
  
  const tariff = TARIFFS[propertyType] || TARIFFS.residential;
  const monthlyBillSavings = Math.min(monthlyBill, monthlyUnits * tariff);
  const annualSavings = monthlyBillSavings * 12;
  
  const paybackYears = annualSavings > 0 ? (netCost / annualSavings) : 999;
  
  let cumulative = 0;
  for (let year = 1; year <= SYSTEM_LIFETIME_YEARS; year++) {
    cumulative += annualSavings * Math.pow(1 + ANNUAL_TARIFF_ESCALATION, year - 1);
  }
  const lifetimeSavings = Math.round(cumulative - netCost);
  
  const co2OffsetKgYear = Math.round(annualUnits * 0.82);
  const co2OffsetTonsLifetime = Math.round(co2OffsetKgYear * SYSTEM_LIFETIME_YEARS / 1000);
  const treesEquivalent = Math.round(co2OffsetTonsLifetime * 16.5);
  
  const panelsRequired = Math.ceil(sizeKw * 1000 / 400);
  const roofAreaSqft = Math.round(sizeKw * 100);
  
  return {
    inputs: { state, sizeKw, propertyType, monthlyBill, panelType },
    pricing: {
      grossCost, grossPerKw,
      centralSubsidy: central,
      stateSubsidy: state_sub,
      totalSubsidy, netCost,
      effectiveDiscountPct: Math.round((totalSubsidy / grossCost) * 100)
    },
    generation: {
      monthlyUnits, annualUnits,
      irradiance: dailyIrr,
      panelsRequired, roofAreaSqft
    },
    savings: {
      monthlySavings: Math.round(monthlyBillSavings),
      annualSavings: Math.round(annualSavings),
      paybackYears: parseFloat(paybackYears.toFixed(1)),
      lifetimeSavings,
      tariffUsed: tariff
    },
    environmental: {
      co2OffsetKgYear, co2OffsetTonsLifetime, treesEquivalent
    },
    schemes: {
      eligible: isResidential ? ['pm_surya_ghar', state !== 'other' && stateSubsidy(sizeKw, state) > 0 ? `${state}_state` : null].filter(Boolean) : 
                isFarm ? ['pm_kusum_b', 'pm_kusum_c'] : ['none']
    }
  };
}

// ============================================================
// PM-KUSUM CALCULATOR
// ============================================================

function suggestPumpHP(acres, cropType, waterSource) {
  cropType = cropType || 'wheat';
  waterSource = waterSource || 'bore';
  
  let baseHP = 3;
  if (acres <= 2) baseHP = 3;
  else if (acres <= 5) baseHP = 5;
  else if (acres <= 10) baseHP = 7.5;
  else baseHP = 10;
  
  if (cropType === 'paddy' || cropType === 'sugarcane') {
    if (baseHP === 3) baseHP = 5;
    else if (baseHP === 5) baseHP = 7.5;
    else if (baseHP === 7.5) baseHP = 10;
  }
  
  if (waterSource === 'bore') {
    if (baseHP === 3 && acres > 1) baseHP = 5;
  }
  
  return baseHP;
}

function calculateKUSUM(input) {
  const {
    landAcres = 5,
    cropType = 'wheat',
    waterSource = 'bore',
    hasGridConnection = false,
    pumpHP = null
  } = input;

  const recommendedHP = pumpHP || suggestPumpHP(landAcres, cropType, waterSource);
  const component = hasGridConnection ? 'C' : 'B';
  
  const benchmarkCost = KUSUM_PUMP_COSTS[recommendedHP] || KUSUM_PUMP_COSTS[5];
  
  const centralSubsidy = Math.round(benchmarkCost * 0.30);
  const stateSubsidy = Math.round(benchmarkCost * 0.30);
  const farmerShareTotal = benchmarkCost - centralSubsidy - stateSubsidy;
  const farmerLoanEligible = Math.round(benchmarkCost * 0.30);
  const farmerOutOfPocket = farmerShareTotal - farmerLoanEligible;
  
  let annualDiscomIncome = 0;
  if (hasGridConnection) {
    const pumpKw = recommendedHP * 0.746;
    const solarKw = pumpKw * 2;
    const annualGenUnits = solarKw * 5.0 * 365 * 0.75;
    const excessUnits = annualGenUnits * 0.30;
    annualDiscomIncome = Math.round(excessUnits * 3.5);
  }
  
  return {
    inputs: { landAcres, cropType, waterSource, hasGridConnection, pumpHP: recommendedHP },
    component,
    componentName: hasGridConnection ? 'Component C — Solarize existing pump' : 'Component B — Off-grid solar pump',
    pump: { recommendedHP, benchmarkCost },
    subsidy: {
      centralSubsidy, stateSubsidy,
      totalSubsidy: centralSubsidy + stateSubsidy,
      farmerShareTotal, farmerLoanEligible, farmerOutOfPocket
    },
    revenue: hasGridConnection ? {
      annualDiscomIncome,
      lifetimeDiscomIncome: annualDiscomIncome * 25
    } : null,
    benefits: [
      'Zero electricity bills for irrigation',
      hasGridConnection ? `Earn ~₹${annualDiscomIncome.toLocaleString('en-IN')}/year from excess solar` : 'Independence from diesel/grid',
      '25-year asset life with minimal maintenance',
      `Subsidy of ${Math.round(((centralSubsidy + stateSubsidy) / benchmarkCost) * 100)}% of cost`
    ]
  };
}

// ============================================================
// FORMATTING HELPERS
// ============================================================

function formatINR(n) {
  if (n >= 10000000) return '₹' + (n/10000000).toFixed(2).replace(/\.?0+$/,'') + ' Cr';
  if (n >= 100000) return '₹' + (n/100000).toFixed(2).replace(/\.?0+$/,'') + ' L';
  return '₹' + n.toLocaleString('en-IN');
}

function formatINRFull(n) {
  return '₹' + Math.round(n).toLocaleString('en-IN');
}

function formatNumber(n) {
  return n.toLocaleString('en-IN');
}

// ============================================================
// BROWSER GLOBAL
// ============================================================

if (typeof window !== 'undefined') {
  window.SolarCalc = {
    calculateSubsidy, calculateKUSUM,
    pmSuryaGharSubsidy, stateSubsidy, suggestPumpHP,
    formatINR, formatINRFull, formatNumber,
    STATE_SUBSIDY, GROSS_COST_PER_KW, TARIFFS
  };
}
