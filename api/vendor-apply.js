/**
 * /api/vendor-apply.js — Vendor application submission (v0.9.2)
 *
 * Writes vendor application to Supabase `vendor_applications` table.
 * v0.9.2: Adds KUSUM self-declaration fields (handles_kusum_declared,
 * kusum_components_declared, mnre_pump_empanellment_number, upneda_kusum_id,
 * kusum_years_active, kusum_installs_completed, kusum_pump_brands).
 *
 * KUSUM specialization is opt-in. Admin must manually verify MNRE pump +
 * UPNEDA KUSUM ID before vendors.handles_kusum is set to true on promotion.
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

const VALID_KUSUM_COMPONENTS = ['A', 'B', 'C1', 'C2'];

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

    // ===== v0.9.2: KUSUM self-declaration validation =====
    const handlesKusumDeclared = !!payload.handlesKusumDeclared;
    let kusumComponentsDeclared = [];
    let mnrePumpEmpanellmentNumber = null;
    let upnedaKusumId = null;
    let kusumYearsActive = null;
    let kusumInstallsCompleted = null;
    let kusumPumpBrands = [];

    if (handlesKusumDeclared) {
      // Validate KUSUM components
      kusumComponentsDeclared = Array.isArray(payload.kusumComponentsDeclared)
        ? payload.kusumComponentsDeclared.filter(c => VALID_KUSUM_COMPONENTS.includes(c))
        : [];
      if (kusumComponentsDeclared.length === 0) {
        return res.status(400).json({ error: 'KUSUM declared but no components selected. Pick at least one of A, B, C1, C2.' });
      }

      // UPNEDA KUSUM ID always required if declaring KUSUM
      upnedaKusumId = (payload.upnedaKusumId || '').trim();
      if (!upnedaKusumId) {
        return res.status(400).json({ error: 'UPNEDA KUSUM vendor ID required when declaring KUSUM specialization' });
      }

      // MNRE pump empanellment required if B or C1 declared (pump-specific components)
      const needsPumpEmp = kusumComponentsDeclared.some(c => ['B', 'C1'].includes(c));
      mnrePumpEmpanellmentNumber = (payload.mnrePumpEmpanellmentNumber || '').trim();
      if (needsPumpEmp && !mnrePumpEmpanellmentNumber) {
        return res.status(400).json({
          error: 'MNRE pump empanellment number required for Components B or C1 (pump-specific)'
        });
      }
      if (!mnrePumpEmpanellmentNumber) mnrePumpEmpanellmentNumber = null;

      kusumYearsActive = payload.kusumYearsActive || null;
      kusumInstallsCompleted = payload.kusumInstallsCompleted || null;
      kusumPumpBrands = Array.isArray(payload.kusumPumpBrands) ? payload.kusumPumpBrands : [];

      if (!kusumYearsActive) {
        return res.status(400).json({ error: 'KUSUM years active required when declaring KUSUM' });
      }
      if (!kusumInstallsCompleted) {
        return res.status(400).json({ error: 'KUSUM installs completed required when declaring KUSUM' });
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
    const flags = autoEvaluate(payload, {
      handlesKusumDeclared,
      kusumComponentsDeclared,
      kusumYearsActive,
      kusumInstallsCompleted
    });

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
          source: payload.source || 'vendor_apply_v2',
          ip: req.headers['x-forwarded-for'] || null,
          user_agent: req.headers['user-agent'] || null,

          // v0.9.2: KUSUM self-declaration
          handles_kusum_declared: handlesKusumDeclared,
          kusum_components_declared: kusumComponentsDeclared,
          mnre_pump_empanellment_number: mnrePumpEmpanellmentNumber,
          upneda_kusum_id: upnedaKusumId,
          kusum_years_active: kusumYearsActive,
          kusum_installs_completed: kusumInstallsCompleted,
          kusum_pump_brands: kusumPumpBrands,
          kusum_admin_verified: false  // Always starts unverified
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
        applicationId,
        kusumData: {
          handlesKusumDeclared,
          kusumComponentsDeclared,
          mnrePumpEmpanellmentNumber,
          upnedaKusumId,
          kusumYearsActive,
          kusumInstallsCompleted,
          kusumPumpBrands
        }
      });
    }

    // Welcome message to applicant
    if (!flags.autoReject && process.env.WHATSAPP_API_KEY) {
      await sendApplicantConfirmation({
        provider: whatsappProvider,
        apiKey: process.env.WHATSAPP_API_KEY,
        toPhone: normalizedPhone,
        data: payload,
        applicationId,
        handlesKusumDeclared
      });
    }

    return res.status(200).json({
      success: true,
      applicationId,
      status: flags.autoReject ? 'auto_rejected' : 'pending_review',
      kusumDeclared: handlesKusumDeclared,
      kusumVerificationPending: handlesKusumDeclared,
      message: flags.autoReject
        ? 'Application received but does not meet minimum criteria.'
        : (handlesKusumDeclared
          ? 'Application received. Rooftop review 48-72hrs. KUSUM verification adds 24-48hrs.'
          : 'Application received. Review within 48-72 hours.')
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
function autoEvaluate(payload, kusumData) {
  const flags = {
    autoReject: false,
    rejectReasons: [],
    warnings: [],
    priorityReview: false,
    priorityReasons: [],
    kusumPriorityReview: false,
    kusumPriorityReasons: []
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

  // Rooftop priority signals
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

  // ===== KUSUM-specific evaluation =====
  if (kusumData?.handlesKusumDeclared) {
    if (kusumData.kusumInstallsCompleted === '>200') {
      flags.kusumPriorityReview = true;
      flags.kusumPriorityReasons.push('200+ KUSUM installs');
    }
    if (kusumData.kusumYearsActive === '5+') {
      flags.kusumPriorityReasons.push('5+ years KUSUM experience');
    }
    if (kusumData.kusumComponentsDeclared.includes('A')) {
      flags.kusumPriorityReasons.push('Component A capable (₹Cr+ deals)');
    }
    if (kusumData.kusumComponentsDeclared.length >= 3) {
      flags.kusumPriorityReasons.push(`Multi-component (${kusumData.kusumComponentsDeclared.join(', ')})`);
    }

    if (kusumData.kusumInstallsCompleted === '0') {
      flags.warnings.push('KUSUM declared but 0 prior KUSUM installs');
    }
    if (kusumData.kusumPumpBrands.length === 0) {
      flags.warnings.push('KUSUM declared but no pump brands specified');
    }

    if (flags.kusumPriorityReasons.length >= 2) flags.kusumPriorityReview = true;
  }

  return flags;
}

async function notifyVendorReview({ provider, apiKey, toPhone, data, flags, applicationId, kusumData }) {
  const priorityMarker = flags.priorityReview ? '⭐⭐⭐ PRIORITY' : '';
  const kusumMarker = kusumData?.handlesKusumDeclared
    ? (flags.kusumPriorityReview ? '🌾⭐ KUSUM-PRIORITY' : '🌾 KUSUM')
    : '';
  const districtCount = data.coverageDistricts?.length || 0;
  const propertyList = (data.propertyTypes || []).join(', ') || 'none specified';

  // KUSUM section (only if declared)
  let kusumSection = '';
  if (kusumData?.handlesKusumDeclared) {
    const comps = kusumData.kusumComponentsDeclared.join(', ');
    const pumpBrands = (kusumData.kusumPumpBrands || []).join(', ') || 'none specified';
    kusumSection = `

═══ 🌾 KUSUM (UNVERIFIED) ═══
Components: ${comps}
MNRE pump emp: ${kusumData.mnrePumpEmpanellmentNumber || 'NOT PROVIDED'}
UPNEDA KUSUM: ${kusumData.upnedaKusumId || 'NOT PROVIDED'}
Years: ${kusumData.kusumYearsActive || '—'}
Installs (24mo): ${kusumData.kusumInstallsCompleted || '—'}
Pump brands: ${pumpBrands}

⚠️ ACTION: Verify MNRE pump + UPNEDA KUSUM before approving as KUSUM specialist
${flags.kusumPriorityReasons.length > 0 ? `\n🌟 KUSUM PRIORITY:\n${flags.kusumPriorityReasons.map(r => '• ' + r).join('\n')}` : ''}`;
  }

  const message = `${priorityMarker} ${kusumMarker} 📋 NEW VENDOR APPLICATION

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

═══ ROOFTOP EXPERIENCE ═══
Years active: ${data.yearsActive}
Installs (24mo): ${data.installsCompleted}
Team size: ${data.teamSize}

═══ COVERAGE ═══
Districts: ${districtCount} selected
Min size: ${data.minSystemSizeKw} kW
Properties: ${propertyList}
Capacity: ${data.leadCapacityPerWeek}/week
${kusumSection}
${flags.priorityReasons.length > 0 ? `\n🌟 PRIORITY:\n${flags.priorityReasons.map(r => '• ' + r).join('\n')}` : ''}
${flags.warnings.length > 0 ? `\n⚠️ WARNINGS:\n${flags.warnings.map(w => '• ' + w).join('\n')}` : ''}
${data.notes ? `\n💬 Notes: "${data.notes.slice(0, 200)}"` : ''}

App ID: ${applicationId || 'pending'}
Submitted: ${new Date().toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' })}

→ Review at admin panel`;

  return await sendWhatsApp(provider, apiKey, toPhone, message);
}

async function sendApplicantConfirmation({ provider, apiKey, toPhone, data, applicationId, handlesKusumDeclared }) {
  const kusumNote = handlesKusumDeclared
    ? `\n\n🌾 KUSUM verification: separately, we'll verify your MNRE pump empanellment + UPNEDA KUSUM vendor ID. KUSUM leads start flowing only after this check (adds 24-48 hours).`
    : '';

  const message = `Hi ${data.contactName}! 👋

Thanks for applying to the SolarSubsidies.com vendor network.

🆔 Application ID: ${applicationId ? applicationId.slice(0, 8).toUpperCase() : 'pending'}
🏢 Company: ${data.companyName}
📅 Submitted: ${new Date().toLocaleDateString('en-IN')}

⏱️ Next steps:
1. We'll verify your MNRE + UPNEDA status (48-72 hrs)
2. WhatsApp you the decision
3. If approved → vendor agreement + onboarding call${kusumNote}

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
