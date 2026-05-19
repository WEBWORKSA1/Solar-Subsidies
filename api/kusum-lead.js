/**
 * /api/kusum-lead.js — KUSUM-specific lead capture
 * 
 * Different from /api/lead.js because:
 *   - Different qualifying data (land, water, irrigation vs bill, property)
 *   - Different scoring algorithm (timeline matters less, land + water + grid status matter more)
 *   - Different routing (KUSUM-specialist vendors only)
 *   - Different commission structure (typically 5-7% for KUSUM)
 * 
 * Writes to kusum_leads table. Triggers matching to KUSUM-specialist vendors.
 * 
 * ENV VARS:
 *   SUPABASE_URL
 *   SUPABASE_SERVICE_ROLE_KEY
 *   WHATSAPP_API_KEY
 *   WHATSAPP_PROVIDER
 *   ADMIN_PHONE
 *   KUSUM_LEAD_PHONES (optional, comma-separated additional escalation)
 */

const ALLOWED_ORIGINS = [
  'https://solarsubsidies.com',
  'https://www.solarsubsidies.com',
  'https://solar-subsidies.vercel.app',
  'http://localhost:3000'
];

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
    const payload = req.body;
    
    // Honeypot
    if (payload.website) {
      return res.status(200).json({ success: true, leadId: 'bot-' + Date.now() });
    }
    
    // Required validation
    if (!payload.name || payload.name.length < 2) return res.status(400).json({ error: 'Name required' });
    if (!payload.phone) return res.status(400).json({ error: 'Phone required' });
    if (!/^[+]?[0-9\-\s]{10,15}$/.test(payload.phone)) return res.status(400).json({ error: 'Invalid phone' });
    
    // Normalize phone
    let normalizedPhone = payload.phone.replace(/[\s\-]/g, '');
    if (!normalizedPhone.startsWith('+')) {
      if (normalizedPhone.length === 10) normalizedPhone = '+91' + normalizedPhone;
    }
    
    // ===== KUSUM-specific scoring =====
    const { leadScore, leadTier, priorityQuota } = scoreKusumLead(payload);
    
    // ===== Write to kusum_leads =====
    const supabaseUrl = process.env.SUPABASE_URL;
    const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
    
    let leadId = null;
    let status = 'new';
    if (payload.recommended_component === 'INELIGIBLE') status = 'ineligible';
    
    if (supabaseUrl && supabaseKey) {
      const supabaseRes = await fetch(`${supabaseUrl}/rest/v1/kusum_leads`, {
        method: 'POST',
        headers: {
          'apikey': supabaseKey,
          'Authorization': `Bearer ${supabaseKey}`,
          'Content-Type': 'application/json',
          'Prefer': 'return=representation'
        },
        body: JSON.stringify({
          name: payload.name,
          phone: normalizedPhone,
          email: payload.email || null,
          district_slug: payload.district || null,
          village_or_tehsil: payload.village_or_tehsil || null,
          consent_whatsapp: payload.consent_whatsapp || false,
          
          applicant_type: payload.applicant_type,
          land_owned: payload.land_owned,
          land_area_acres: payload.land_area_acres,
          land_type: payload.land_type,
          
          current_irrigation_source: payload.current_irrigation_source,
          water_source_type: payload.water_source_type,
          water_table_depth_ft: payload.water_table_depth_ft,
          current_electricity_bill_inr_per_month: payload.current_electricity_bill_inr_per_month,
          has_existing_pump: payload.has_existing_pump,
          existing_pump_hp: payload.existing_pump_hp,
          
          distance_to_substation_km: payload.distance_to_substation_km,
          primary_crop: payload.primary_crop,
          
          eligible_components: payload.eligible_components || [],
          recommended_component: payload.recommended_component,
          recommended_pump_hp: payload.recommended_pump_hp,
          recommended_capacity_mw: payload.recommended_capacity_mw,
          
          benchmark_cost_inr: payload.benchmark_cost_inr,
          subsidy_central_inr: payload.subsidy_central_inr,
          subsidy_state_inr: payload.subsidy_state_inr,
          farmer_share_total_inr: payload.farmer_share_total_inr,
          farmer_loan_eligible_inr: payload.farmer_loan_eligible_inr,
          farmer_own_funds_inr: payload.farmer_own_funds_inr,
          estimated_annual_benefit_inr: payload.estimated_annual_benefit_inr,
          payback_years: payload.payback_years,
          
          lead_score: leadScore,
          lead_tier: leadTier,
          priority_quota: priorityQuota,
          
          status: status,
          source: payload.source || 'kusum_eligibility_v1',
          ip: req.headers['x-forwarded-for'] || null,
          user_agent: req.headers['user-agent'] || null
        })
      });
      
      if (supabaseRes.ok) {
        const data = await supabaseRes.json();
        leadId = data[0]?.id;
      } else {
        const err = await supabaseRes.text();
        console.error('KUSUM Supabase write failed:', err);
      }
    }
    
    // ===== Notify admin =====
    const provider = process.env.WHATSAPP_PROVIDER || 'webhook';
    const adminPhone = process.env.ADMIN_PHONE;
    
    if (adminPhone && process.env.WHATSAPP_API_KEY && payload.recommended_component !== 'INELIGIBLE') {
      await notifyKusumAdmin({
        provider, apiKey: process.env.WHATSAPP_API_KEY, toPhone: adminPhone,
        leadData: { ...payload, phone: normalizedPhone, leadId, leadScore, leadTier, priorityQuota }
      });
    }
    
    // ===== Welcome WhatsApp to lead =====
    if (payload.consent_whatsapp && normalizedPhone && process.env.WHATSAPP_API_KEY && payload.recommended_component !== 'INELIGIBLE') {
      await sendKusumWelcome({
        provider, apiKey: process.env.WHATSAPP_API_KEY, toPhone: normalizedPhone,
        leadData: payload
      });
    }
    
    return res.status(200).json({
      success: true,
      leadId,
      leadScore,
      leadTier,
      eligible: payload.recommended_component !== 'INELIGIBLE',
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
// Different from rooftop. Land + water + grid context matter most.
// Timeline matters less (KUSUM is inherently 90-120 days).
// Priority quotas matter (SC/ST/women/FPO/drought district get higher routing priority).
function scoreKusumLead(p) {
  let score = 5;
  let priorityQuota = null;
  
  // INELIGIBLE = automatic COLD, no scoring
  if (p.recommended_component === 'INELIGIBLE') {
    return { leadScore: 1, leadTier: 'COLD', priorityQuota: null };
  }
  
  // Component A is highest-value (₹Cr+ projects, premium routing)
  if (p.recommended_component === 'A') score += 4;
  // Component B is most common, baseline
  else if (p.recommended_component === 'B') score += 2;
  // Component C is good, slightly lower value
  else if (p.recommended_component === 'C1') score += 2;
  
  // Land area signals seriousness
  const acres = p.land_area_acres || 0;
  if (acres >= 10) score += 2;
  else if (acres >= 4) score += 1.5;
  else if (acres >= 2) score += 1;
  else if (acres >= 1) score += 0.5;
  
  // Recommended pump HP
  if (p.recommended_pump_hp >= 7.5) score += 1;
  else if (p.recommended_pump_hp >= 5) score += 0.5;
  
  // Has water source = ready to install
  if (p.water_source_type && p.water_source_type !== 'none') score += 1;
  else score -= 1;
  
  // Crop type — water-intensive crops mean higher pump need
  if (p.primary_crop === 'sugarcane' || p.primary_crop === 'paddy') score += 0.5;
  
  // Drought district priority (Bundelkhand)
  const bundelkhand = ['jhansi', 'jalaun', 'lalitpur', 'banda', 'hamirpur', 'mahoba', 'chitrakoot'];
  if (bundelkhand.includes(p.district)) {
    score += 1;
    priorityQuota = 'DROUGHT_DISTRICT';
  }
  
  // Clamp 1-10
  score = Math.max(1, Math.min(10, Math.round(score)));
  const tier = score >= 8 ? 'HOT' : score >= 5 ? 'WARM' : 'COLD';
  
  return { leadScore: score, leadTier: tier, priorityQuota };
}

// =====================================================
// WHATSAPP HELPERS
// =====================================================
async function notifyKusumAdmin({ provider, apiKey, toPhone, leadData }) {
  const componentLabel = {
    'A': '🏛️ Component A (Solar Plant)',
    'B': '💧 Component B (Standalone Pump)',
    'C1': '⚡ Component C (Grid Solarisation)'
  }[leadData.recommended_component] || leadData.recommended_component;
  
  const tierEmoji = leadData.leadTier === 'HOT' ? '🔥🔥🔥' : leadData.leadTier === 'WARM' ? '🟡' : '⚪';
  
  const message = `${tierEmoji} NEW KUSUM LEAD (score ${leadData.leadScore}/10)

🌾 ${leadData.name}
📞 ${leadData.phone}
📍 ${leadData.district || '—'}

✨ ${componentLabel}
${leadData.recommended_pump_hp ? `Pump: ${leadData.recommended_pump_hp} HP` : ''}
${leadData.recommended_capacity_mw ? `Plant: ${leadData.recommended_capacity_mw} MW` : ''}

🌾 Land: ${leadData.land_area_acres} acres (${leadData.land_type || '—'})
💧 Water: ${leadData.water_source_type || '—'}
⚡ Current irrigation: ${leadData.current_irrigation_source || '—'}
🌺 Crop: ${leadData.primary_crop || '—'}

💰 Cost: ₹${leadData.benchmark_cost_inr ? leadData.benchmark_cost_inr.toLocaleString('en-IN') : '—'}
   Subsidy: ₹${leadData.subsidy_central_inr + leadData.subsidy_state_inr ? (leadData.subsidy_central_inr + leadData.subsidy_state_inr).toLocaleString('en-IN') : '—'}
   Farmer share: ₹${leadData.farmer_share_total_inr ? leadData.farmer_share_total_inr.toLocaleString('en-IN') : '—'}

${leadData.priorityQuota ? `⭐ PRIORITY QUOTA: ${leadData.priorityQuota}\n` : ''}Lead ID: ${leadData.leadId || 'pending'}
Time: ${new Date().toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' })}

⚠️ KUSUM vendor different from rooftop — route to MNRE-pump-empanelled vendor only`;
  
  return await sendWhatsApp(provider, apiKey, toPhone, message);
}

async function sendKusumWelcome({ provider, apiKey, toPhone, leadData }) {
  const componentName = {
    'A': 'Component A (Solar Plant on your land)',
    'B': `Component B (${leadData.recommended_pump_hp} HP standalone solar pump)`,
    'C1': 'Component C (Grid-pump solarisation)'
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
