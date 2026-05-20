/**
 * /api/kusum-lead.js — KUSUM-specific lead capture (canonical schema v0.8.1)
 * 
 * Writes to kusum_leads table using column names defined in
 * data/0008_kusum_and_directory.sql (the canonical migration).
 *
 * v0.9 P1: Auto-calls matchKusumLead() for HOT/WARM leads after insert.
 *
 * IMPORTANT — schema differences from rooftop lead pipeline:
 *   - kusum_lead_score / kusum_lead_tier (NOT lead_score / lead_tier)
 *   - land_owned_acres (NOT land_area_acres)
 *   - pump_situation (NOT current_irrigation_source / has_existing_pump)
 *   - pump_hp (NOT existing_pump_hp)
 *   - water_source (NOT water_source_type) — values must be in enum
 *   - water_depth_ft (NOT water_table_depth_ft)
 *   - primary_crops (free text — TEXT not enum)
 *   - estimated_gross_cost / estimated_subsidy_central / estimated_subsidy_state
 *     / estimated_farmer_contribution / estimated_loan_eligible
 *     / estimated_payback_years / estimated_diesel_savings_annual
 *   - status enum: 'new' | 'eligibility_passed' | 'eligibility_failed'
 *     | 'documents_pending' | 'assigned' | 'site_visit_scheduled' | etc.
 *   - recommended_component enum: 'A' | 'B' | 'C1' | 'C2' | 'ineligible' | 'needs_review'
 *
 * Anything from the frontend that doesn't have a DB column is preserved
 * in calculator_snapshot (JSONB) for future analysis.
 *
 * ENV VARS:
 *   SUPABASE_URL
 *   SUPABASE_SERVICE_ROLE_KEY
 *   WHATSAPP_API_KEY
 *   WHATSAPP_PROVIDER
 *   ADMIN_PHONE
 *   KUSUM_LEAD_PHONES (optional, comma-separated additional escalation)
 *   MSG91_INTEGRATED_NUMBER (only if WHATSAPP_PROVIDER=msg91)
 *   MATCH_INTERNAL_TOKEN (required for v0.9 auto-routing)
 */

import { matchKusumLead } from './match-kusum-lead.js';

const ALLOWED_ORIGINS = [
  'https://solarsubsidies.com',
  'https://www.solarsubsidies.com',
  'https://solar-subsidies.vercel.app',
  'http://localhost:3000'
];

// Map frontend irrigation values to canonical pump_situation enum
function mapPumpSituation(irrigationSource, existingPumpHp) {
  if (irrigationSource === 'electric_pump_grid' || irrigationSource === 'electric_pump_unreliable') {
    return 'electric_grid_pump';
  }
  if (irrigationSource === 'diesel_pump') return 'diesel_pump';
  if (irrigationSource === 'rain_fed' || irrigationSource === 'manual_lift' || irrigationSource === 'canal_irrigation') {
    return 'no_pump';
  }
  return existingPumpHp ? 'electric_grid_pump' : 'no_pump';
}

// Map frontend water_source values to canonical water_source enum
function mapWaterSource(waterSourceType) {
  const map = {
    'borewell': 'borewell',
    'open_well': 'open_well',
    'canal': 'canal',
    'pond': 'pond_river',
    'river': 'pond_river',
    'none': 'unsure'
  };
  return map[waterSourceType] || 'unsure';
}

// Map frontend recommended_component to canonical recommended_component enum
function mapRecommendedComponent(rec) {
  if (!rec) return 'needs_review';
  if (rec === 'INELIGIBLE') return 'ineligible';
  if (['A', 'B', 'C1', 'C2'].includes(rec)) return rec;
  return 'needs_review';
}

// Map ineligibility to canonical status enum
function mapStatus(recommendedComponent) {
  if (recommendedComponent === 'INELIGIBLE') return 'eligibility_failed';
  return 'new';
}

export default async function handler(req, res) {
  const origin = req.headers.origin;
  if (ALLOWED_ORIGINS.includes(origin)) {
    res.setHeader('Access-Control-Allow-Origin', origin);
  }
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const payload = req.body || {};
    
    // Honeypot
    if (payload.website) {
      return res.status(200).json({ success: true, leadId: 'bot-' + Date.now() });
    }
    
    // Required validation
    if (!payload.name || payload.name.length < 2) return res.status(400).json({ error: 'Name required' });
    if (!payload.phone) return res.status(400).json({ error: 'Phone required' });
    if (!/^[+]?[0-9\-\s]{10,15}$/.test(payload.phone)) return res.status(400).json({ error: 'Invalid phone' });
    
    // Normalize phone to E.164
    let normalizedPhone = payload.phone.replace(/[\s\-]/g, '');
    if (!normalizedPhone.startsWith('+')) {
      if (normalizedPhone.length === 10) normalizedPhone = '+91' + normalizedPhone;
    }
    
    // ===== KUSUM-specific scoring =====
    const { leadScore, leadTier, priorityQuota } = scoreKusumLead(payload);
    
    // ===== Build DB record (canonical column names) =====
    const recommendedComponent = mapRecommendedComponent(payload.recommended_component);
    const status = mapStatus(payload.recommended_component);
    const pumpSituation = mapPumpSituation(payload.current_irrigation_source, payload.existing_pump_hp);
    const waterSource = mapWaterSource(payload.water_source_type);
    
    // Compute estimated_system_kw from recommended_pump_hp or recommended_capacity_mw
    let estimatedSystemKw = null;
    if (payload.recommended_capacity_mw) {
      estimatedSystemKw = Math.round(payload.recommended_capacity_mw * 1000 * 100) / 100;
    } else if (payload.recommended_pump_hp) {
      estimatedSystemKw = Math.round(payload.recommended_pump_hp * 0.9 * 100) / 100;
    }
    
    // Preserve everything that doesn't have a DB column in calculator_snapshot
    const calculatorSnapshot = {
      applicant_type: payload.applicant_type || null,
      land_owned: payload.land_owned !== false,
      land_type: payload.land_type || null,
      eligible_components: payload.eligible_components || [],
      recommended_pump_hp: payload.recommended_pump_hp || null,
      recommended_capacity_mw: payload.recommended_capacity_mw || null,
      farmer_own_funds_inr: payload.farmer_own_funds_inr || null,
      estimated_annual_benefit_inr: payload.estimated_annual_benefit_inr || null,
      distance_to_substation_km: payload.distance_to_substation_km || null,
      priority_quota: priorityQuota,
      sc_st_quota: payload.sc_st_quota || false,
      source_irrigation_input: payload.current_irrigation_source || null,
      source_water_input: payload.water_source_type || null,
      source_recommended_input: payload.recommended_component || null,
      preferred_language: payload.preferred_language || 'en',
      preferred_path: payload.preferred_path || null
    };
    
    const dbRecord = {
      name: payload.name,
      phone: normalizedPhone,
      email: payload.email || null,
      district_slug: payload.district || null,
      village_or_tehsil: payload.village_or_tehsil || null,
      land_owned_acres: payload.land_area_acres || null,
      land_ownership_proof: payload.land_ownership_proof || null,
      pump_situation: pumpSituation,
      pump_hp: payload.existing_pump_hp || payload.recommended_pump_hp || null,
      existing_pump_age: payload.existing_pump_age || null,
      water_source: waterSource,
      water_depth_ft: payload.water_table_depth_ft || null,
      irrigation_acres: payload.irrigation_acres || payload.land_area_acres || null,
      primary_crops: payload.primary_crop || null,
      current_electricity_bill_monthly: payload.current_electricity_bill_inr_per_month || null,
      current_diesel_spend_monthly: payload.current_diesel_spend_monthly || null,
      recommended_component: recommendedComponent,
      estimated_system_kw: estimatedSystemKw,
      estimated_gross_cost: payload.benchmark_cost_inr ? Math.round(payload.benchmark_cost_inr) : null,
      estimated_subsidy_central: payload.subsidy_central_inr ? Math.round(payload.subsidy_central_inr) : null,
      estimated_subsidy_state: payload.subsidy_state_inr ? Math.round(payload.subsidy_state_inr) : null,
      estimated_farmer_contribution: payload.farmer_share_total_inr ? Math.round(payload.farmer_share_total_inr) : null,
      estimated_loan_eligible: payload.farmer_loan_eligible_inr ? Math.round(payload.farmer_loan_eligible_inr) : null,
      estimated_payback_years: payload.payback_years || null,
      estimated_diesel_savings_annual: payload.estimated_annual_benefit_inr ? Math.round(payload.estimated_annual_benefit_inr) : null,
      kusum_lead_score: leadScore,
      kusum_lead_tier: leadTier,
      status: status,
      consent_whatsapp: payload.consent_whatsapp || false,
      consent_aadhaar_data: payload.consent_aadhaar_data || false,
      calculator_snapshot: calculatorSnapshot,
      source: payload.source || 'kusum_eligibility_v1',
      ip: req.headers['x-forwarded-for'] || null,
      user_agent: req.headers['user-agent'] || null
    };
    
    // ===== Write to kusum_leads =====
    const supabaseUrl = process.env.SUPABASE_URL;
    const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
    
    let leadId = null;
    
    if (supabaseUrl && supabaseKey) {
      const supabaseRes = await fetch(`${supabaseUrl}/rest/v1/kusum_leads`, {
        method: 'POST',
        headers: {
          'apikey': supabaseKey,
          'Authorization': `Bearer ${supabaseKey}`,
          'Content-Type': 'application/json',
          'Prefer': 'return=representation'
        },
        body: JSON.stringify(dbRecord)
      });
      
      if (supabaseRes.ok) {
        const data = await supabaseRes.json();
        leadId = data[0]?.id;
      } else {
        const err = await supabaseRes.text();
        console.error('KUSUM Supabase write failed:', err);
      }
    } else {
      console.warn('KUSUM: Supabase not configured, lead not persisted');
    }
    
    // ===== Notify admin (only for eligible leads) =====
    const provider = process.env.WHATSAPP_PROVIDER || 'webhook';
    const adminPhone = process.env.ADMIN_PHONE;
    const isEligible = recommendedComponent !== 'ineligible' && recommendedComponent !== 'needs_review';
    
    if (isEligible && adminPhone && process.env.WHATSAPP_API_KEY) {
      await notifyKusumAdmin({
        provider,
        apiKey: process.env.WHATSAPP_API_KEY,
        toPhone: adminPhone,
        leadData: {
          ...payload,
          phone: normalizedPhone,
          leadId,
          leadScore,
          leadTier,
          priorityQuota,
          recommendedComponent
        }
      });
      
      if (leadTier === 'HOT' && process.env.KUSUM_LEAD_PHONES) {
        const extras = process.env.KUSUM_LEAD_PHONES.split(',').map(p => p.trim()).filter(Boolean);
        for (const extra of extras) {
          await notifyKusumAdmin({
            provider,
            apiKey: process.env.WHATSAPP_API_KEY,
            toPhone: extra,
            leadData: { ...payload, phone: normalizedPhone, leadId, leadScore, leadTier, priorityQuota, recommendedComponent }
          });
        }
      }
    }
    
    // ===== Welcome WhatsApp to farmer (only if eligible + consented) =====
    if (isEligible && payload.consent_whatsapp && normalizedPhone && process.env.WHATSAPP_API_KEY) {
      await sendKusumWelcome({
        provider,
        apiKey: process.env.WHATSAPP_API_KEY,
        toPhone: normalizedPhone,
        leadData: payload
      });
    }
    
    // ===== v0.9 P1: AUTO-ROUTE TO KUSUM-SPECIALIST VENDOR =====
    // Only for HOT and WARM leads that are eligible AND have a leadId
    let matchResult = null;
    if (isEligible && leadId && (leadTier === 'HOT' || leadTier === 'WARM')) {
      try {
        matchResult = await matchKusumLead(leadId, []);
        if (matchResult.matched) {
          console.log(`KUSUM auto-routed: leadId=${leadId} → vendor=${matchResult.vendorName} (score=${matchResult.score})`);
        } else {
          console.log(`KUSUM auto-route declined: ${matchResult.reason}`);
        }
      } catch (matchErr) {
        console.error('KUSUM auto-route exception:', matchErr);
        matchResult = { matched: false, reason: 'exception', detail: matchErr.message };
      }
    }
    
    return res.status(200).json({
      success: true,
      leadId,
      leadScore,
      leadTier,
      eligible: isEligible,
      recommendedComponent,
      matched: matchResult?.matched || false,
      vendorName: matchResult?.vendorName || null,
      assignmentMethod: matchResult?.assignmentMethod || null,
      matchReason: matchResult?.reason || null,
      message: 'KUSUM lead captured.'
    });
    
  } catch (err) {
    console.error('KUSUM lead error:', err);
    return res.status(500).json({ error: 'Internal error', detail: err.message });
  }
}

// =====================================================
// KUSUM-SPECIFIC SCORING
// =====================================================
function scoreKusumLead(p) {
  let score = 5;
  let priorityQuota = null;
  
  if (p.recommended_component === 'INELIGIBLE') {
    return { leadScore: 1, leadTier: 'COLD', priorityQuota: null };
  }
  
  if (p.recommended_component === 'A') score += 4;
  else if (p.recommended_component === 'B') score += 2;
  else if (p.recommended_component === 'C1' || p.recommended_component === 'C2') score += 2;
  
  const acres = p.land_area_acres || 0;
  if (acres >= 10) score += 2;
  else if (acres >= 4) score += 1.5;
  else if (acres >= 2) score += 1;
  else if (acres >= 1) score += 0.5;
  
  if (p.recommended_pump_hp >= 7.5) score += 1;
  else if (p.recommended_pump_hp >= 5) score += 0.5;
  
  if (p.water_source_type && p.water_source_type !== 'none') score += 1;
  else score -= 1;
  
  if (p.primary_crop === 'sugarcane' || p.primary_crop === 'paddy') score += 0.5;
  
  // SC/ST priority quota (UPNEDA reservation)
  if (p.sc_st_quota === true) {
    score += 1;
    priorityQuota = priorityQuota || 'SC_ST_QUOTA';
  }
  
  // Drought district priority (Bundelkhand)
  const bundelkhand = ['jhansi', 'jalaun', 'lalitpur', 'banda', 'hamirpur', 'mahoba', 'chitrakoot'];
  if (bundelkhand.includes(p.district)) {
    score += 1;
    priorityQuota = priorityQuota || 'DROUGHT_DISTRICT';
  }
  
  score = Math.max(1, Math.min(10, Math.round(score)));
  const tier = score >= 8 ? 'HOT' : score >= 5 ? 'WARM' : 'COLD';
  
  return { leadScore: score, leadTier: tier, priorityQuota };
}

// =====================================================
// WHATSAPP NOTIFICATIONS
// =====================================================
async function notifyKusumAdmin({ provider, apiKey, toPhone, leadData }) {
  const componentLabel = {
    'A': '🏛️ Component A (Solar Plant on land)',
    'B': '💧 Component B (Standalone Pump)',
    'C1': '⚡ Component C1 (Individual Pump Solarisation)',
    'C2': '⚡ Component C2 (Feeder-Level Solarisation)'
  }[leadData.recommendedComponent] || leadData.recommendedComponent;
  
  const tierEmoji = leadData.leadTier === 'HOT' ? '🔥🔥🔥' : leadData.leadTier === 'WARM' ? '🟡' : '⚪';
  const totalSubsidy = (leadData.subsidy_central_inr || 0) + (leadData.subsidy_state_inr || 0);
  
  const message = `${tierEmoji} NEW KUSUM LEAD (score ${leadData.leadScore}/10)

🌾 ${leadData.name}
📞 ${leadData.phone}
📍 ${leadData.district || '—'}

✨ ${componentLabel}
${leadData.recommended_pump_hp ? `Pump: ${leadData.recommended_pump_hp} HP` : ''}
${leadData.recommended_capacity_mw ? `Plant: ${leadData.recommended_capacity_mw} MW` : ''}

🌾 Land: ${leadData.land_area_acres || '—'} acres (${leadData.land_type || '—'})
💧 Water: ${leadData.water_source_type || '—'}
⚡ Current irrigation: ${leadData.current_irrigation_source || '—'}
🌺 Crop: ${leadData.primary_crop || '—'}

💰 Cost: ₹${leadData.benchmark_cost_inr ? Number(leadData.benchmark_cost_inr).toLocaleString('en-IN') : '—'}
   Subsidy: ₹${totalSubsidy ? totalSubsidy.toLocaleString('en-IN') : '—'}
   Farmer share: ₹${leadData.farmer_share_total_inr ? Number(leadData.farmer_share_total_inr).toLocaleString('en-IN') : '—'}

${leadData.priorityQuota ? `⭐ PRIORITY QUOTA: ${leadData.priorityQuota}\n` : ''}Lead ID: ${leadData.leadId || 'pending'}
Time: ${new Date().toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' })}

⚠️ Auto-routing to KUSUM-specialist will execute. Check admin dashboard KUSUM tab.`;
  
  return await sendWhatsApp(provider, apiKey, toPhone, message);
}

async function sendKusumWelcome({ provider, apiKey, toPhone, leadData }) {
  const componentName = {
    'A': 'Component A (Solar Plant on your land)',
    'B': `Component B (${leadData.recommended_pump_hp} HP standalone solar pump)`,
    'C1': 'Component C1 (Grid-pump solarisation)',
    'C2': 'Component C2 (Feeder-level solarisation)'
  }[leadData.recommended_component] || 'KUSUM';
  
  const message = `🌾 Hi ${leadData.name}! Thanks for using SolarSubsidies.com.

Based on your inputs, you qualify for:
✨ ${componentName}

Next: An MNRE-empanelled KUSUM specialist (not a regular rooftop installer) will WhatsApp you within 4 business hours. They'll:

✅ Confirm your eligibility on the ground
✅ Schedule a free site visit (1-7 days)
✅ Help with the UPNEDA application
✅ Arrange bank loan if needed (up to 30% of cost)

No upfront fees. You pay only your farmer share (40%) AFTER subsidy approval.

Documents to gather:
• Aadhaar (yours + spouse)
• Land records (RoR/Khasra-Khatauni)
• Bank account proof
• Water source photo + GPS

Reply STOP anytime to opt out.

— SolarSubsidies.com KUSUM team`;
  
  return await sendWhatsApp(provider, apiKey, toPhone, message);
}

async function sendWhatsApp(provider, apiKey, toPhone, message) {
  try {
    switch (provider) {
      case 'aisensy':
        return await fetch('https://backend.aisensy.com/campaign/t1/api/v2', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            apiKey, campaignName: 'kusum_lead_notification',
            destination: toPhone, userName: 'SolarSubsidies',
            templateParams: [message]
          })
        });
      case 'interakt':
        return await fetch('https://api.interakt.ai/v1/public/message/', {
          method: 'POST',
          headers: { 'Authorization': `Basic ${apiKey}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({
            countryCode: '+91',
            phoneNumber: toPhone.replace('+91', ''),
            type: 'Text',
            data: { message }
          })
        });
      case 'msg91':
        return await fetch('https://api.msg91.com/api/v5/whatsapp/whatsapp-outbound-message/bulk/', {
          method: 'POST',
          headers: { 'authkey': apiKey, 'Content-Type': 'application/json' },
          body: JSON.stringify({
            integrated_number: process.env.MSG91_INTEGRATED_NUMBER,
            content_type: 'template',
            payload: {
              to: [toPhone], type: 'template',
              template: { name: 'kusum_lead_alert', body_text: [message] }
            }
          })
        });
      default:
        if (apiKey?.startsWith('http')) {
          return await fetch(apiKey, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ to: toPhone, message })
          });
        }
    }
  } catch (e) {
    console.error('KUSUM WhatsApp send error:', e);
  }
}
