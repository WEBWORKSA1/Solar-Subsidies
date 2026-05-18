/**
 * /api/vendor-apply.js — Vendor application submission
 * 
 * Writes vendor application to Supabase `vendor_applications` table.
 * Sends WhatsApp alert to admin for manual review.
 * 
 * ENV VARS REQUIRED:
 *   SUPABASE_URL
 *   SUPABASE_SERVICE_ROLE_KEY
 *   WHATSAPP_API_KEY
 *   WHATSAPP_PROVIDER
 *   ADMIN_PHONE
 *   VENDOR_REVIEW_PHONES (optional, comma-separated)
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
    
    // Honeypot — bots fill this hidden field
    if (payload.honeypot) {
      return res.status(200).json({ success: true, applicationId: 'bot-' + Date.now() });
    }
    
    // Required field validation
    const required = [
      'companyName', 'contactName', 'phone', 'email', 'hq',
      'mnreNumber', 'upnedaNumber', 'gstin', 'pan',
      'yearsActive', 'installsCompleted', 'teamSize',
      'coverageDistricts', 'minSystemSizeKw'
    ];
    
    for (const field of required) {
      if (!payload[field] || (Array.isArray(payload[field]) && payload[field].length === 0)) {
        return res.status(400).json({ error: `Missing required field: ${field}` });
      }
    }
    
    // Format validation
    if (!/^[+]?[0-9\-\s]{10,15}$/.test(payload.phone)) {
      return res.status(400).json({ error: 'Invalid phone format' });
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(payload.email)) {
      return res.status(400).json({ error: 'Invalid email format' });
    }
    if (!/^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z]{1}[1-9A-Z]{1}Z[0-9A-Z]{1}$/.test(payload.gstin)) {
      return res.status(400).json({ error: 'Invalid GSTIN format' });
    }
    if (!/^[A-Z]{5}[0-9]{4}[A-Z]{1}$/.test(payload.pan)) {
      return res.status(400).json({ error: 'Invalid PAN format' });
    }
    
    // All 6 commitments must be agreed
    const requiredAgreements = ['response_4hr', 'bis_certified', 'commission_7_8', 'no_redirect', 'warranties', 'verify_consent'];
    for (const agreement of requiredAgreements) {
      if (!payload.agreed?.[agreement]) {
        return res.status(400).json({ error: `Must agree to: ${agreement}` });
      }
    }
    
    // Normalize phone to E.164
    let normalizedPhone = payload.phone.replace(/[\s\-]/g, '');
    if (!normalizedPhone.startsWith('+')) {
      if (normalizedPhone.length === 10) {
        normalizedPhone = '+91' + normalizedPhone;
      }
    }
    
    // Calculate auto-eligibility flags for manual reviewer
    const flags = autoEvaluate(payload);
    
    // Write to Supabase
    const supabaseUrl = process.env.SUPABASE_URL;
    const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
    
    let applicationId = null;
    
    if (supabaseUrl && supabaseKey) {
      const supabaseRes = await fetch(`${supabaseUrl}/rest/v1/vendor_applications`, {
        method: 'POST',
        headers: {
          'apikey': supabaseKey,
          'Authorization': `Bearer ${supabaseKey}`,
          'Content-Type': 'application/json',
          'Prefer': 'return=representation'
        },
        body: JSON.stringify({
          company_name: payload.companyName,
          brand_name: payload.brandName || null,
          contact_name: payload.contactName,
          contact_role: payload.contactRole,
          phone: normalizedPhone,
          email: payload.email,
          website: payload.website || null,
          hq: payload.hq,
          mnre_number: payload.mnreNumber,
          upneda_number: payload.upnedaNumber,
          gstin: payload.gstin,
          pan: payload.pan,
          years_active: payload.yearsActive,
          installs_completed: payload.installsCompleted,
          team_size: payload.teamSize,
          coverage_districts: payload.coverageDistricts,
          min_system_size_kw: payload.minSystemSizeKw,
          property_types: payload.propertyTypes || [],
          lead_capacity_per_week: payload.leadCapacityPerWeek,
          notes: payload.notes || null,
          agreed: payload.agreed,
          auto_flags: flags,
          status: flags.autoReject ? 'auto_rejected' : 'pending_review',
          source: payload.source || 'vendor_apply_v1',
          ip: req.headers['x-forwarded-for'] || null,
          user_agent: req.headers['user-agent'] || null
        })
      });
      
      if (supabaseRes.ok) {
        const data = await supabaseRes.json();
        applicationId = data[0]?.id;
      } else {
        const err = await supabaseRes.text();
        console.error('Supabase write failed:', err);
      }
    }
    
    // WhatsApp alert to admin reviewers
    const whatsappProvider = process.env.WHATSAPP_PROVIDER || 'webhook';
    const adminPhone = process.env.ADMIN_PHONE;
    
    if (adminPhone && process.env.WHATSAPP_API_KEY && !flags.autoReject) {
      await notifyVendorReview({
        provider: whatsappProvider,
        apiKey: process.env.WHATSAPP_API_KEY,
        toPhone: adminPhone,
        data: payload,
        flags,
        applicationId
      });
    }
    
    // Welcome message to applicant (only if not auto-rejected)
    if (!flags.autoReject && process.env.WHATSAPP_API_KEY) {
      await sendApplicantConfirmation({
        provider: whatsappProvider,
        apiKey: process.env.WHATSAPP_API_KEY,
        toPhone: normalizedPhone,
        data: payload,
        applicationId
      });
    }
    
    return res.status(200).json({
      success: true,
      applicationId,
      status: flags.autoReject ? 'auto_rejected' : 'pending_review',
      message: flags.autoReject 
        ? 'Application received but does not meet minimum criteria.' 
        : 'Application received. Review within 48-72 hours.'
    });
    
  } catch (err) {
    console.error('Vendor apply error:', err);
    return res.status(500).json({ error: 'Internal error', detail: err.message });
  }
}

/**
 * Auto-evaluation flags for manual reviewer
 * - autoReject: hard-fails minimum criteria
 * - warnings: flags worth a closer look
 * - priorityReview: indicators of strong vendor
 */
function autoEvaluate(payload) {
  const flags = {
    autoReject: false,
    rejectReasons: [],
    warnings: [],
    priorityReview: false,
    priorityReasons: []
  };
  
  // Hard rejects
  if (payload.installsCompleted === '<25') {
    flags.autoReject = true;
    flags.rejectReasons.push('Below 25-install minimum');
  }
  if (payload.teamSize === '1-3') {
    flags.warnings.push('Likely sub-contracted crews — verify in review');
  }
  if (!payload.coverageDistricts || payload.coverageDistricts.length === 0) {
    flags.autoReject = true;
    flags.rejectReasons.push('No service districts');
  }
  
  // Priority signals (strong vendor)
  if (payload.installsCompleted === '>500') {
    flags.priorityReview = true;
    flags.priorityReasons.push('500+ installs — established player');
  }
  if (payload.yearsActive === '5-10' || payload.yearsActive === '>10') {
    flags.priorityReasons.push(`${payload.yearsActive} years experience`);
  }
  if (payload.teamSize === '>50' || payload.teamSize === '26-50') {
    flags.priorityReasons.push(`Large in-house team (${payload.teamSize})`);
  }
  if (payload.coverageDistricts && payload.coverageDistricts.length >= 10) {
    flags.priorityReasons.push(`Multi-district coverage (${payload.coverageDistricts.length} districts)`);
  }
  
  // Warnings
  if (!payload.website) flags.warnings.push('No website listed');
  if (payload.coverageDistricts && payload.coverageDistricts.length > 30) {
    flags.warnings.push('Claims 30+ districts — verify install volume distribution');
  }
  if (payload.propertyTypes && payload.propertyTypes.length === 0) {
    flags.warnings.push('No property types selected');
  }
  
  if (flags.priorityReasons.length >= 2) flags.priorityReview = true;
  
  return flags;
}

async function notifyVendorReview({ provider, apiKey, toPhone, data, flags, applicationId }) {
  const priorityMarker = flags.priorityReview ? '⭐⭐⭐ PRIORITY' : '';
  const districtCount = data.coverageDistricts?.length || 0;
  const propertyList = (data.propertyTypes || []).join(', ') || 'none specified';
  
  const message = `${priorityMarker} 📋 NEW VENDOR APPLICATION

🏢 ${data.companyName}
${data.brandName ? `(Brand: ${data.brandName})\n` : ''}👤 ${data.contactName} (${data.contactRole})
📞 ${data.phone}
📧 ${data.email}
🌐 ${data.website || 'No website'}
📍 ${data.hq}

═══ APPROVALS ═══
MNRE: ${data.mnreNumber}
UPNEDA: ${data.upnedaNumber}
GSTIN: ${data.gstin}
PAN: ${data.pan}

═══ EXPERIENCE ═══
Years active: ${data.yearsActive}
Installs (24mo): ${data.installsCompleted}
Team size: ${data.teamSize}

═══ COVERAGE ═══
Districts: ${districtCount} selected
Min size: ${data.minSystemSizeKw} kW
Properties: ${propertyList}
Capacity: ${data.leadCapacityPerWeek}/week

${flags.priorityReasons.length > 0 ? `\n🌟 PRIORITY:\n${flags.priorityReasons.map(r => '• ' + r).join('\n')}` : ''}
${flags.warnings.length > 0 ? `\n⚠️ WARNINGS:\n${flags.warnings.map(w => '• ' + w).join('\n')}` : ''}
${data.notes ? `\n💬 Notes: "${data.notes.slice(0, 200)}"` : ''}

App ID: ${applicationId || 'pending'}
Submitted: ${new Date().toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' })}

→ Review at Supabase /vendor_applications`;

  return await sendWhatsApp(provider, apiKey, toPhone, message);
}

async function sendApplicantConfirmation({ provider, apiKey, toPhone, data, applicationId }) {
  const message = `Hi ${data.contactName}! 👋

Thanks for applying to the SolarSubsidies.com vendor network.

🆔 Application ID: ${applicationId ? applicationId.slice(0, 8).toUpperCase() : 'pending'}
🏢 Company: ${data.companyName}
📅 Submitted: ${new Date().toLocaleDateString('en-IN')}

⏱️ Next steps:
1. We'll verify your MNRE + UPNEDA status (48-72 hrs)
2. WhatsApp you the decision
3. If approved → vendor agreement + onboarding call

Questions? Reply here or email vendors@solarsubsidies.com

— Team SolarSubsidies.com`;

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
            apiKey,
            campaignName: 'vendor_notification',
            destination: toPhone,
            userName: 'SolarSubsidies',
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
              to: [toPhone],
              type: 'template',
              template: { name: 'vendor_alert', body_text: [message] }
            }
          })
        });
      default:
        if (!apiKey || !apiKey.startsWith('http')) return;
        return await fetch(apiKey, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ to: toPhone, message })
        });
    }
  } catch (e) {
    console.error('WhatsApp send error:', e);
  }
}
