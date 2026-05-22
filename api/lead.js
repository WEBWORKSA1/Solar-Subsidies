/**
 * /api/lead.js — Vercel Serverless Function (v0.9.3)
 * 
 * Captures lead from 4-step calculator, writes to Supabase, scores it,
 * notifies admin, AND triggers vendor matching automatically.
 * 
 * v0.6: Auto-calls matchLead() after capture to assign vendor + start SLA clock.
 * v0.9: Captures preferredVendorSlug when customer arrives from vendor profile page.
 * v0.9.3: Phone-based dedup — same phone with an active lead is flagged
 *   status=duplicate, not auto-matched, no second vendor WhatsApp. Customer
 *   still gets their confirmation (they shouldn't notice anything).
 * 
 * ENV VARS REQUIRED:
 *   SUPABASE_URL
 *   SUPABASE_SERVICE_ROLE_KEY
 *   WHATSAPP_API_KEY
 *   WHATSAPP_PROVIDER          'aisensy' | 'interakt' | 'msg91' | 'webhook'
 *   ADMIN_PHONE                Admin phone in E.164 (e.g. '+919876543210')
 *   HOT_LEAD_PHONES            (optional) Comma-separated additional admin phones for HOT leads only
 *   MATCH_INTERNAL_TOKEN       Required — protects /api/match-lead from public calls
 *   PORTAL_BASE_URL            e.g. 'https://solarsubsidies.com'
 */

import { matchLead } from './match-lead.js';
import { checkDuplicateLead, duplicateLeadFields } from './_dedup.js';

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
    const {
      name, phone, email,
      state = 'up',
      district = null,
      systemSizeKw,
      monthlyBill,
      propertyType = 'residential',
      intent = null,
      timeline = null,
      consentWhatsapp = false,
      calculatorSnapshot = null,
      source = 'calculator_v2',
      preferredVendorSlug = null  // v0.9: customer's vendor preference from profile page
    } = req.body;

    if (req.body.website) {
      return res.status(200).json({ success: true, leadId: 'bot-' + Date.now() });
    }

    if (!phone && !email) {
      return res.status(400).json({ error: 'Phone or email required' });
    }
    if (phone && !/^[+]?[0-9\-\s]{10,15}$/.test(phone)) {
      return res.status(400).json({ error: 'Invalid phone format' });
    }
    if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return res.status(400).json({ error: 'Invalid email format' });
    }
    if (!name || name.length < 2) {
      return res.status(400).json({ error: 'Name required' });
    }
    
    // Validate preferredVendorSlug format if provided (alphanumeric + hyphen only, max 80 chars)
    const cleanPreferredSlug = preferredVendorSlug && /^[a-z0-9-]{1,80}$/.test(preferredVendorSlug)
      ? preferredVendorSlug
      : null;

    let normalizedPhone = phone;
    if (phone) {
      normalizedPhone = phone.replace(/[\s\-]/g, '');
      if (!normalizedPhone.startsWith('+')) {
        if (normalizedPhone.length === 10) {
          normalizedPhone = '+91' + normalizedPhone;
        }
      }
    }

    const leadScore = scoreLead({
      monthlyBill, timeline, propertyType, intent, systemSizeKw
    });
    const leadTier = leadScore >= 8 ? 'HOT' : leadScore >= 5 ? 'WARM' : 'COLD';

    // ===== v0.9.3: DEDUP CHECK =====
    // Look for an existing active lead with this phone. If found, the new row
    // is still written (audit trail) but flagged duplicate + skips auto-match
    // and the vendor-facing WhatsApp.
    const dedup = await checkDuplicateLead('leads', normalizedPhone);
    if (dedup.isDuplicate) {
      console.log(`[lead] DUPLICATE phone=${normalizedPhone} original=${dedup.originalLeadId} status=${dedup.originalStatus} age=${dedup.originalAgeHours}h`);
    }

    const supabaseUrl = process.env.SUPABASE_URL;
    const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

    let leadId = null;
    
    if (supabaseUrl && supabaseKey) {
      const insertBody = {
        name,
        phone: normalizedPhone,
        email: email || null,
        state_code: state,
        district_slug: district,
        system_size_kw: systemSizeKw || null,
        monthly_bill: monthlyBill || null,
        property_type: propertyType,
        intent,
        timeline,
        lead_score: leadScore,
        lead_tier: leadTier,
        consent_whatsapp: consentWhatsapp,
        calculator_snapshot: calculatorSnapshot,
        source,
        preferred_vendor_slug: cleanPreferredSlug,  // v0.9
        status: 'new',
        ip: req.headers['x-forwarded-for'] || null,
        user_agent: req.headers['user-agent'] || null
      };

      // Merge duplicate flags if this is a dup (overrides status to 'duplicate')
      if (dedup.isDuplicate) {
        Object.assign(insertBody, duplicateLeadFields(dedup.originalLeadId));
      }

      const supabaseRes = await fetch(`${supabaseUrl}/rest/v1/leads`, {
        method: 'POST',
        headers: {
          'apikey': supabaseKey,
          'Authorization': `Bearer ${supabaseKey}`,
          'Content-Type': 'application/json',
          'Prefer': 'return=representation'
        },
        body: JSON.stringify(insertBody)
      });

      if (supabaseRes.ok) {
        const data = await supabaseRes.json();
        leadId = data[0]?.id;
      } else {
        const err = await supabaseRes.text();
        console.error('Supabase write failed:', err);
      }
    }

    // ===== ADMIN WHATSAPP =====
    // Duplicates still alert admin (so they're aware of the re-submit), but the
    // message flags it as a duplicate so admin doesn't double-handle.
    const whatsappProvider = process.env.WHATSAPP_PROVIDER || 'webhook';
    const adminPhone = process.env.ADMIN_PHONE;
    
    if (adminPhone && process.env.WHATSAPP_API_KEY) {
      await notifyAdminWhatsApp({
        provider: whatsappProvider,
        apiKey: process.env.WHATSAPP_API_KEY,
        toPhone: adminPhone,
        leadData: {
          name, phone: normalizedPhone, email,
          state, district, systemSizeKw, monthlyBill,
          propertyType, intent, timeline,
          leadScore, leadTier, leadId,
          preferredVendorSlug: cleanPreferredSlug,
          isDuplicate: dedup.isDuplicate,
          originalLeadId: dedup.originalLeadId,
          originalStatus: dedup.originalStatus
        }
      });
    }
    
    // HOT escalation — skip for duplicates (no need to wake extra people for a re-submit)
    if (leadTier === 'HOT' && !dedup.isDuplicate && process.env.HOT_LEAD_PHONES) {
      const extraPhones = process.env.HOT_LEAD_PHONES.split(',').map(p => p.trim()).filter(Boolean);
      for (const extra of extraPhones) {
        await notifyAdminWhatsApp({
          provider: whatsappProvider,
          apiKey: process.env.WHATSAPP_API_KEY,
          toPhone: extra,
          leadData: {
            name, phone: normalizedPhone, email,
            state, district, systemSizeKw, monthlyBill,
            propertyType, intent, timeline,
            leadScore, leadTier, leadId,
            preferredVendorSlug: cleanPreferredSlug,
            isDuplicate: false
          }
        });
      }
    }

    // ===== WELCOME WHATSAPP TO LEAD =====
    // Customer ALWAYS gets their confirmation, even on a dup — they shouldn't
    // perceive the system as broken or non-responsive.
    if (consentWhatsapp && normalizedPhone && process.env.WHATSAPP_API_KEY) {
      await sendLeadWelcomeWhatsApp({
        provider: whatsappProvider,
        apiKey: process.env.WHATSAPP_API_KEY,
        toPhone: normalizedPhone,
        leadData: { name, state, systemSizeKw, district, preferredVendorSlug: cleanPreferredSlug }
      });
    }

    // ===== AUTO-MATCH VENDOR =====
    // Trigger vendor matching for HOT/WARM leads only. COLD leads get manual review.
    // SKIP for duplicates — the original lead already has/will-have an assignment;
    // we don't want a second vendor working the same prospect.
    let matchResult = null;
    if (leadId && leadTier !== 'COLD' && !dedup.isDuplicate) {
      try {
        matchResult = await matchLead(leadId, []);
        console.log('Match result:', JSON.stringify(matchResult));
      } catch (matchErr) {
        console.error('Auto-match failed (non-fatal):', matchErr);
      }
    }

    return res.status(200).json({
      success: true,
      leadId,
      leadScore,
      leadTier,
      duplicate: dedup.isDuplicate,
      matched: matchResult?.matched || false,
      vendorName: matchResult?.vendorName || null,
      assignmentMethod: matchResult?.assignmentMethod || null,
      message: dedup.isDuplicate
        ? 'Lead recorded. An installer is already working with this number.'
        : 'Lead captured. Vendor matching in progress.'
    });

  } catch (err) {
    console.error('Lead capture error:', err);
    return res.status(500).json({ error: 'Internal error', detail: err.message });
  }
}

// ============================================================
// LEAD SCORING ALGORITHM
// ============================================================
function scoreLead({ monthlyBill, timeline, propertyType, intent, systemSizeKw }) {
  let score = 5;
  
  if (monthlyBill >= 8000) score += 3;
  else if (monthlyBill >= 5000) score += 2;
  else if (monthlyBill >= 3000) score += 1;
  else if (monthlyBill < 1500) score -= 1;
  
  if (timeline === 'this_month') score += 3;
  else if (timeline === '1_3_months') score += 2;
  else if (timeline === '3_6_months') score += 0;
  else if (timeline === 'just_researching') score -= 2;
  
  if (propertyType === 'independent_home') score += 1;
  else if (propertyType === 'builder_floor') score += 1;
  else if (propertyType === 'commercial') score += 1;
  else if (propertyType === 'farm') score += 0;
  else if (propertyType === 'apartment') score -= 1;
  else if (propertyType === 'other') score -= 0.5;
  
  if (intent === 'reduce_bill' || intent === 'subsidy') score += 1;
  else if (intent === 'independence' || intent === 'property_value') score += 0.5;
  else if (intent === 'researching') score -= 1;
  
  if (systemSizeKw >= 5) score += 0.5;
  
  return Math.max(1, Math.min(10, Math.round(score)));
}

// ============================================================
// WHATSAPP HELPERS
// ============================================================

async function notifyAdminWhatsApp({ provider, apiKey, toPhone, leadData }) {
  const message = formatAdminMessage(leadData);
  switch (provider) {
    case 'aisensy': return await sendViaAiSensy(apiKey, toPhone, message);
    case 'interakt': return await sendViaInterakt(apiKey, toPhone, message);
    case 'msg91': return await sendViaMSG91(apiKey, toPhone, message);
    default: return await sendViaWebhook(apiKey, toPhone, message);
  }
}

async function sendLeadWelcomeWhatsApp({ provider, apiKey, toPhone, leadData }) {
  const districtName = leadData.district 
    ? leadData.district.charAt(0).toUpperCase() + leadData.district.slice(1).replace(/-/g, ' ') 
    : 'your district';
  
  // v0.9: Tailored welcome copy if customer came from a vendor profile
  const vendorLine = leadData.preferredVendorSlug
    ? `we're routing your request directly to your chosen installer`
    : `we're matching you with a vetted, UPNEDA-approved installer`;
  
  const message = `Hi ${leadData.name || 'there'}! 👋

Thanks for using SolarSubsidies.com.

Based on your ${leadData.systemSizeKw}kW system in ${districtName}, ${vendorLine}.

✓ They'll reach out within 4 business hours
✓ No spam, no call-center harassment  
✓ Reply STOP to opt out anytime

Questions? Reply to this message.

— Team SolarSubsidies.com`;

  switch (provider) {
    case 'aisensy': return await sendViaAiSensy(apiKey, toPhone, message);
    case 'interakt': return await sendViaInterakt(apiKey, toPhone, message);
    case 'msg91': return await sendViaMSG91(apiKey, toPhone, message);
    default: return await sendViaWebhook(apiKey, toPhone, message);
  }
}

function formatAdminMessage(d) {
  // Duplicate banner takes priority in the admin message
  if (d.isDuplicate) {
    const propertyMapDup = {
      'independent_home': 'Independent home', 'builder_floor': 'Builder floor',
      'apartment': 'Apartment / RWA', 'farm': 'Farm', 'commercial': 'Commercial', 'other': 'Other'
    };
    return `🔁 DUPLICATE SUBMISSION (no action needed)

${d.name} (${d.phone}) re-submitted the calculator.

An existing lead is already active for this number:
• Original lead ID: ${d.originalLeadId || '—'}
• Original status: ${d.originalStatus || '—'}

This re-submission was recorded (ID: ${d.leadId || 'pending'}) and flagged as a duplicate. It was NOT auto-matched — the original vendor assignment stands.

New inputs this time:
📍 ${d.district || '—'} · ⚡ ${d.systemSizeKw} kW · 💰 ₹${d.monthlyBill?.toLocaleString('en-IN') || '—'}/mo
🏠 ${propertyMapDup[d.propertyType] || d.propertyType}

If the customer's needs changed materially, update the original lead manually.`;
  }

  const tierEmoji = d.leadTier === 'HOT' ? '🔥🔥🔥' : d.leadTier === 'WARM' ? '🟡' : '⚪';
  const intentMap = {
    'reduce_bill': 'Cut bill',
    'independence': 'Energy independence',
    'property_value': 'Property value',
    'environment': 'Environment',
    'subsidy': 'Subsidy ₹1.08L',
    'researching': 'Just researching'
  };
  const timelineMap = {
    'this_month': 'THIS MONTH ⚡',
    '1_3_months': '1-3 months',
    '3_6_months': '3-6 months',
    'just_researching': 'No timeline'
  };
  const propertyMap = {
    'independent_home': 'Independent home',
    'builder_floor': 'Builder floor',
    'apartment': 'Apartment / RWA',
    'farm': 'Farm',
    'commercial': 'Commercial',
    'other': 'Other'
  };
  
  // v0.9: Show preferred-vendor flag in admin message
  const preferredLine = d.preferredVendorSlug
    ? `\n⭐ PREFERRED VENDOR REQUESTED: ${d.preferredVendorSlug}`
    : '';
  
  return `${tierEmoji} ${d.leadTier} LEAD (score ${d.leadScore}/10)${preferredLine}

👤 ${d.name}
📞 ${d.phone || '—'}
📧 ${d.email || '—'}

📍 ${d.district || '—'} (${d.state?.toUpperCase()})
🏠 ${propertyMap[d.propertyType] || d.propertyType}
⚡ ${d.systemSizeKw} kW system
💰 Bill: ₹${d.monthlyBill?.toLocaleString('en-IN') || '—'}/mo

🎯 Intent: ${intentMap[d.intent] || d.intent || '—'}
⏱️ Timeline: ${timelineMap[d.timeline] || d.timeline || '—'}

Lead ID: ${d.leadId || 'pending'}
Time: ${new Date().toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' })}

${d.leadTier === 'HOT' ? '⚡ HOT — auto-matching now' : d.leadTier === 'WARM' ? '🟡 WARM — auto-matching now' : '⚪ COLD — manual triage'}`;
}

async function sendViaAiSensy(apiKey, toPhone, message) {
  try {
    return await fetch('https://backend.aisensy.com/campaign/t1/api/v2', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        apiKey, campaignName: 'lead_notification',
        destination: toPhone, userName: 'SolarSubsidies',
        templateParams: [message]
      })
    });
  } catch (e) { console.error('AiSensy error:', e); }
}

async function sendViaInterakt(apiKey, toPhone, message) {
  try {
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
  } catch (e) { console.error('Interakt error:', e); }
}

async function sendViaMSG91(apiKey, toPhone, message) {
  try {
    return await fetch('https://api.msg91.com/api/v5/whatsapp/whatsapp-outbound-message/bulk/', {
      method: 'POST',
      headers: { 'authkey': apiKey, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        integrated_number: process.env.MSG91_INTEGRATED_NUMBER,
        content_type: 'template',
        payload: {
          to: [toPhone],
          type: 'template',
          template: { name: 'lead_alert', body_text: [message] }
        }
      })
    });
  } catch (e) { console.error('MSG91 error:', e); }
}

async function sendViaWebhook(webhookUrl, toPhone, message) {
  if (!webhookUrl || !webhookUrl.startsWith('http')) return;
  try {
    return await fetch(webhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ to: toPhone, message })
    });
  } catch (e) { console.error('Webhook error:', e); }
}
