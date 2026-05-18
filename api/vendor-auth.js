/**
 * /api/vendor-auth.js — Magic-link OTP authentication for vendor portal
 * 
 * Endpoints (single file, action via query param):
 *   POST /api/vendor-auth?action=request  { destination, channel }
 *     → Generates 6-digit OTP, hashes it (SHA-256), stores in vendor_sessions,
 *       sends to vendor's phone (WhatsApp) or email.
 *   
 *   POST /api/vendor-auth?action=verify   { destination, code }
 *     → Verifies OTP, creates session_token (30-day expiry), returns to client.
 *   
 *   POST /api/vendor-auth?action=me       { sessionToken }
 *     → Returns the vendor profile attached to session.
 *   
 *   POST /api/vendor-auth?action=logout   { sessionToken }
 *     → Invalidates the session.
 * 
 * ENV VARS:
 *   SUPABASE_URL
 *   SUPABASE_SERVICE_ROLE_KEY
 *   WHATSAPP_API_KEY
 *   WHATSAPP_PROVIDER
 *   PORTAL_BASE_URL
 */

import crypto from 'crypto';

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
  
  const action = req.query.action;
  
  try {
    if (action === 'request') return await handleRequestOTP(req, res);
    if (action === 'verify')  return await handleVerifyOTP(req, res);
    if (action === 'me')      return await handleMe(req, res);
    if (action === 'logout')  return await handleLogout(req, res);
    return res.status(400).json({ error: 'Unknown action' });
  } catch (err) {
    console.error('Auth error:', err);
    return res.status(500).json({ error: 'Internal error', detail: err.message });
  }
}

function sha256(text) {
  return crypto.createHash('sha256').update(text).digest('hex');
}

function generateOTP() {
  return Math.floor(100000 + Math.random() * 900000).toString();
}

function generateSessionToken() {
  return crypto.randomBytes(32).toString('hex');
}

// ============================================================
// ACTION: request OTP
// ============================================================
async function handleRequestOTP(req, res) {
  const { destination, channel = 'whatsapp' } = req.body;
  
  if (!destination) return res.status(400).json({ error: 'destination required' });
  if (!['whatsapp', 'email'].includes(channel)) return res.status(400).json({ error: 'channel must be whatsapp or email' });
  
  const supabaseUrl = process.env.SUPABASE_URL;
  const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  
  // Look up vendor by phone or email
  let normalizedDest = destination.trim();
  if (channel === 'whatsapp') {
    normalizedDest = normalizedDest.replace(/[\s\-]/g, '');
    if (!normalizedDest.startsWith('+')) {
      if (normalizedDest.length === 10) normalizedDest = '+91' + normalizedDest;
    }
  } else {
    normalizedDest = normalizedDest.toLowerCase();
  }
  
  const lookupField = channel === 'whatsapp' ? 'phone' : 'email';
  const lookupUrl = `${supabaseUrl}/rest/v1/vendors?${lookupField}=eq.${encodeURIComponent(normalizedDest)}&active=eq.true&select=id,company_name,phone,email`;
  
  const vendorRes = await fetch(lookupUrl, {
    headers: { 'apikey': supabaseKey, 'Authorization': `Bearer ${supabaseKey}` }
  });
  const vendors = await vendorRes.json();
  
  if (!vendors || vendors.length === 0) {
    // Don't reveal whether vendor exists — return generic success anyway
    // This prevents enumeration attacks but means users can't tell if they typed wrong
    return res.status(200).json({ 
      success: true, 
      message: 'If this destination is registered, an OTP has been sent.' 
    });
  }
  
  const vendor = vendors[0];
  const otp = generateOTP();
  const otpHash = sha256(otp);
  const expiresAt = new Date(Date.now() + 10 * 60 * 1000).toISOString(); // 10 min
  
  // Invalidate any existing OTPs for this destination
  await fetch(`${supabaseUrl}/rest/v1/vendor_sessions?otp_destination=eq.${encodeURIComponent(normalizedDest)}&session_token=is.null`, {
    method: 'DELETE',
    headers: { 'apikey': supabaseKey, 'Authorization': `Bearer ${supabaseKey}` }
  });
  
  // Create new OTP record
  await fetch(`${supabaseUrl}/rest/v1/vendor_sessions`, {
    method: 'POST',
    headers: {
      'apikey': supabaseKey,
      'Authorization': `Bearer ${supabaseKey}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      vendor_id: vendor.id,
      otp_code: otpHash,
      otp_destination: normalizedDest,
      otp_channel: channel,
      otp_expires_at: expiresAt,
      ip: req.headers['x-forwarded-for'] || null,
      user_agent: req.headers['user-agent'] || null
    })
  });
  
  // Send OTP via channel
  const message = `🔐 Your SolarSubsidies vendor portal login code: ${otp}\n\nValid for 10 minutes.\n\nIf you didn't request this, ignore this message.`;
  
  if (channel === 'whatsapp') {
    await sendOTPviaWhatsApp(normalizedDest, message);
  } else {
    // Email channel — TODO: implement Resend/SendGrid
    // For now log it server-side (admin can manually relay during testing)
    console.log(`[OTP_EMAIL_FALLBACK] To: ${normalizedDest} | Code: ${otp}`);
  }
  
  return res.status(200).json({ 
    success: true, 
    message: `OTP sent via ${channel}. Valid 10 minutes.`,
    channel,
    // Hint mask: "+91 98XXX XX210" — helps user confirm right destination
    maskedDestination: maskDestination(normalizedDest, channel)
  });
}

// ============================================================
// ACTION: verify OTP → issue session token
// ============================================================
async function handleVerifyOTP(req, res) {
  const { destination, code } = req.body;
  
  if (!destination || !code) return res.status(400).json({ error: 'destination and code required' });
  
  const supabaseUrl = process.env.SUPABASE_URL;
  const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  
  // Normalize destination same as request stage
  let normalizedDest = destination.trim();
  if (normalizedDest.includes('@')) {
    normalizedDest = normalizedDest.toLowerCase();
  } else {
    normalizedDest = normalizedDest.replace(/[\s\-]/g, '');
    if (!normalizedDest.startsWith('+')) {
      if (normalizedDest.length === 10) normalizedDest = '+91' + normalizedDest;
    }
  }
  
  const codeHash = sha256(code.trim());
  
  // Look up pending OTP
  const lookupUrl = `${supabaseUrl}/rest/v1/vendor_sessions` +
    `?otp_destination=eq.${encodeURIComponent(normalizedDest)}` +
    `&otp_code=eq.${codeHash}` +
    `&session_token=is.null` +
    `&otp_expires_at=gt.${new Date().toISOString()}` +
    `&select=*&limit=1`;
  
  const sessionRes = await fetch(lookupUrl, {
    headers: { 'apikey': supabaseKey, 'Authorization': `Bearer ${supabaseKey}` }
  });
  const sessions = await sessionRes.json();
  
  if (!sessions || sessions.length === 0) {
    // Track failed attempt (rate limiting)
    const failedAttemptUrl = `${supabaseUrl}/rest/v1/vendor_sessions?otp_destination=eq.${encodeURIComponent(normalizedDest)}&session_token=is.null`;
    await fetch(failedAttemptUrl, {
      method: 'PATCH',
      headers: {
        'apikey': supabaseKey,
        'Authorization': `Bearer ${supabaseKey}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ otp_attempts: { 'increment': 1 } })
    });
    return res.status(401).json({ error: 'Invalid or expired code' });
  }
  
  const session = sessions[0];
  
  // Block after 5 attempts
  if ((session.otp_attempts || 0) >= 5) {
    return res.status(429).json({ error: 'Too many attempts. Request a new code.' });
  }
  
  // Issue session token — 30 day expiry
  const sessionToken = generateSessionToken();
  const sessionExpires = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString();
  
  await fetch(`${supabaseUrl}/rest/v1/vendor_sessions?id=eq.${session.id}`, {
    method: 'PATCH',
    headers: {
      'apikey': supabaseKey,
      'Authorization': `Bearer ${supabaseKey}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      session_token: sessionToken,
      session_expires_at: sessionExpires,
      otp_code: null,  // wipe OTP
      last_used_at: new Date().toISOString()
    })
  });
  
  return res.status(200).json({
    success: true,
    sessionToken,
    expiresAt: sessionExpires,
    vendorId: session.vendor_id
  });
}

// ============================================================
// ACTION: 'me' — validate session, return vendor profile
// ============================================================
async function handleMe(req, res) {
  const { sessionToken } = req.body;
  if (!sessionToken) return res.status(401).json({ error: 'sessionToken required' });
  
  const vendor = await validateSession(sessionToken);
  if (!vendor) return res.status(401).json({ error: 'Invalid or expired session' });
  
  return res.status(200).json({ success: true, vendor });
}

async function handleLogout(req, res) {
  const { sessionToken } = req.body;
  if (!sessionToken) return res.status(400).json({ error: 'sessionToken required' });
  
  const supabaseUrl = process.env.SUPABASE_URL;
  const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  
  await fetch(`${supabaseUrl}/rest/v1/vendor_sessions?session_token=eq.${sessionToken}`, {
    method: 'DELETE',
    headers: { 'apikey': supabaseKey, 'Authorization': `Bearer ${supabaseKey}` }
  });
  
  return res.status(200).json({ success: true });
}

// ============================================================
// HELPER: validate session, return vendor record
// Used by /api/vendor-leads.js as well — exported below
// ============================================================
export async function validateSession(sessionToken) {
  if (!sessionToken) return null;
  
  const supabaseUrl = process.env.SUPABASE_URL;
  const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  
  const sessRes = await fetch(
    `${supabaseUrl}/rest/v1/vendor_sessions` +
    `?session_token=eq.${sessionToken}` +
    `&session_expires_at=gt.${new Date().toISOString()}` +
    `&select=vendor_id&limit=1`,
    { headers: { 'apikey': supabaseKey, 'Authorization': `Bearer ${supabaseKey}` } }
  );
  const sessions = await sessRes.json();
  if (!sessions || sessions.length === 0) return null;
  
  const vendorRes = await fetch(
    `${supabaseUrl}/rest/v1/vendors?id=eq.${sessions[0].vendor_id}&select=*&limit=1`,
    { headers: { 'apikey': supabaseKey, 'Authorization': `Bearer ${supabaseKey}` } }
  );
  const vendors = await vendorRes.json();
  return vendors?.[0] || null;
}

function maskDestination(dest, channel) {
  if (channel === 'email') {
    const [local, domain] = dest.split('@');
    if (!local || !domain) return dest;
    const masked = local.length > 3 ? local.slice(0, 2) + '***' + local.slice(-1) : local[0] + '***';
    return `${masked}@${domain}`;
  }
  // WhatsApp: +91 98XXX XX210
  if (dest.length < 10) return dest;
  return dest.slice(0, 4) + ' ' + dest.slice(4, 6) + 'XXX XX' + dest.slice(-3);
}

async function sendOTPviaWhatsApp(toPhone, message) {
  const provider = process.env.WHATSAPP_PROVIDER || 'webhook';
  const apiKey = process.env.WHATSAPP_API_KEY;
  if (!apiKey) {
    console.log(`[OTP_NO_PROVIDER] To: ${toPhone} | Msg: ${message}`);
    return;
  }
  
  try {
    switch (provider) {
      case 'aisensy':
        return await fetch('https://backend.aisensy.com/campaign/t1/api/v2', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            apiKey, campaignName: 'vendor_otp',
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
              template: { name: 'vendor_otp', body_text: [message] }
            }
          })
        });
      default:
        if (apiKey.startsWith('http')) {
          return await fetch(apiKey, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ to: toPhone, message })
          });
        }
    }
  } catch (e) {
    console.error('OTP send error:', e);
  }
}
