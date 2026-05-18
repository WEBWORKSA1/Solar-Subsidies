/**
 * /api/lead.js — Vercel Serverless Function
 * 
 * Captures lead from calculator form, writes to Supabase, sends WhatsApp notification.
 * 
 * ENV VARS REQUIRED (set in Vercel dashboard → Settings → Environment Variables):
 *   SUPABASE_URL
 *   SUPABASE_SERVICE_ROLE_KEY (NOT anon key — needs write access)
 *   WHATSAPP_API_KEY
 *   WHATSAPP_PROVIDER          'aisensy' | 'interakt' | 'msg91' | 'webhook'
 *   ADMIN_PHONE                Your phone in E.164 format (e.g. '+919876543210')
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
    const {
      name, phone, email,
      state = 'up',
      district = null,
      systemSizeKw,
      monthlyBill,
      propertyType = 'residential',
      consentWhatsapp = false,
      calculatorSnapshot = null,
      source = 'calculator'
    } = req.body;

    // Validation
    if (!phone && !email) {
      return res.status(400).json({ error: 'Phone or email required' });
    }
    
    if (phone && !/^[+]?[0-9\-\s]{10,15}$/.test(phone)) {
      return res.status(400).json({ error: 'Invalid phone format' });
    }
    
    if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return res.status(400).json({ error: 'Invalid email format' });
    }

    // Normalize phone to E.164
    let normalizedPhone = phone;
    if (phone) {
      normalizedPhone = phone.replace(/[\s\-]/g, '');
      if (!normalizedPhone.startsWith('+')) {
        if (normalizedPhone.length === 10) {
          normalizedPhone = '+91' + normalizedPhone;
        }
      }
    }

    // Honeypot — bots fill this hidden field
    if (req.body.website) {
      return res.status(200).json({ success: true });
    }

    // Write to Supabase
    const supabaseUrl = process.env.SUPABASE_URL;
    const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

    let leadId = null;
    
    if (supabaseUrl && supabaseKey) {
      const supabaseRes = await fetch(`${supabaseUrl}/rest/v1/leads`, {
        method: 'POST',
        headers: {
          'apikey': supabaseKey,
          'Authorization': `Bearer ${supabaseKey}`,
          'Content-Type': 'application/json',
          'Prefer': 'return=representation'
        },
        body: JSON.stringify({
          name: name || null,
          phone: normalizedPhone || null,
          email: email || null,
          state_code: state,
          district_slug: district,
          system_size_kw: systemSizeKw || null,
          monthly_bill: monthlyBill || null,
          property_type: propertyType,
          consent_whatsapp: consentWhatsapp,
          calculator_snapshot: calculatorSnapshot,
          source,
          status: 'new',
          ip: req.headers['x-forwarded-for'] || null,
          user_agent: req.headers['user-agent'] || null
        })
      });

      if (supabaseRes.ok) {
        const data = await supabaseRes.json();
        leadId = data[0]?.id;
      } else {
        const err = await supabaseRes.text();
        console.error('Supabase write failed:', err);
      }
    }

    // WhatsApp notification to admin
    const whatsappProvider = process.env.WHATSAPP_PROVIDER || 'webhook';
    const adminPhone = process.env.ADMIN_PHONE;
    
    if (adminPhone && process.env.WHATSAPP_API_KEY) {
      await notifyAdminWhatsApp({
        provider: whatsappProvider,
        apiKey: process.env.WHATSAPP_API_KEY,
        toPhone: adminPhone,
        leadData: {
          name: name || 'Anonymous',
          phone: normalizedPhone,
          email, state, district,
          systemSizeKw, monthlyBill
        }
      });
    }

    // WhatsApp welcome to lead (if consented)
    if (consentWhatsapp && normalizedPhone && process.env.WHATSAPP_API_KEY) {
      await sendLeadWelcomeWhatsApp({
        provider: whatsappProvider,
        apiKey: process.env.WHATSAPP_API_KEY,
        toPhone: normalizedPhone,
        leadData: { name, state, systemSizeKw }
      });
    }

    return res.status(200).json({
      success: true, leadId,
      message: 'Lead captured. Vendor matching in progress.'
    });

  } catch (err) {
    console.error('Lead capture error:', err);
    return res.status(500).json({ error: 'Internal error', detail: err.message });
  }
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
  const message = `Hi ${leadData.name || 'there'}! 👋

Thanks for using SolarSubsidies.com.

Based on your ${leadData.systemSizeKw}kW system in ${leadData.state.toUpperCase()}, we're matching you with 3 vetted, MNRE-empanelled installers in your district.

They'll reach out within 48 hours with personalized quotes.

No spam. No call-center harassment. Reply STOP anytime.

— Team SolarSubsidies.com`;

  switch (provider) {
    case 'aisensy': return await sendViaAiSensy(apiKey, toPhone, message);
    case 'interakt': return await sendViaInterakt(apiKey, toPhone, message);
    case 'msg91': return await sendViaMSG91(apiKey, toPhone, message);
    default: return await sendViaWebhook(apiKey, toPhone, message);
  }
}

function formatAdminMessage(d) {
  return `🌞 NEW LEAD — SolarSubsidies.com

Name: ${d.name}
Phone: ${d.phone || '—'}
Email: ${d.email || '—'}

State: ${d.state?.toUpperCase()}
District: ${d.district || '—'}
System: ${d.systemSizeKw} kW
Monthly Bill: ₹${d.monthlyBill?.toLocaleString('en-IN') || '—'}

Time: ${new Date().toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' })}`;
}

// AiSensy (recommended for India)
async function sendViaAiSensy(apiKey, toPhone, message) {
  try {
    return await fetch('https://backend.aisensy.com/campaign/t1/api/v2', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        apiKey,
        campaignName: 'lead_notification',
        destination: toPhone,
        userName: 'SolarSubsidies',
        templateParams: [message]
      })
    });
  } catch (e) { console.error('AiSensy error:', e); }
}

async function sendViaInterakt(apiKey, toPhone, message) {
  try {
    return await fetch('https://api.interakt.ai/v1/public/message/', {
      method: 'POST',
      headers: {
        'Authorization': `Basic ${apiKey}`,
        'Content-Type': 'application/json'
      },
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
      headers: {
        'authkey': apiKey,
        'Content-Type': 'application/json'
      },
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
