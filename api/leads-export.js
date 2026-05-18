/**
 * /api/leads-export.js — Admin lead export endpoint
 * 
 * Usage:
 *   GET /api/leads-export?token=YOUR_ADMIN_TOKEN&format=csv
 *   GET /api/leads-export?token=YOUR_ADMIN_TOKEN&format=json
 *   GET /api/leads-export?token=YOUR_ADMIN_TOKEN&tier=HOT
 *   GET /api/leads-export?token=YOUR_ADMIN_TOKEN&since=2026-05-01
 * 
 * ENV VARS:
 *   SUPABASE_URL
 *   SUPABASE_SERVICE_ROLE_KEY
 *   ADMIN_EXPORT_TOKEN  (set this in Vercel — must match ?token= param)
 */

export default async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  // Token auth — prevents random people from downloading your leads
  const token = req.query.token;
  if (!token || token !== process.env.ADMIN_EXPORT_TOKEN) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const format = req.query.format || 'csv';
  const tierFilter = req.query.tier; // HOT | WARM | COLD
  const since = req.query.since; // ISO date
  const limit = parseInt(req.query.limit, 10) || 1000;

  const supabaseUrl = process.env.SUPABASE_URL;
  const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!supabaseUrl || !supabaseKey) {
    return res.status(500).json({ error: 'Supabase not configured' });
  }

  // Build query
  let url = `${supabaseUrl}/rest/v1/leads?select=*&order=created_at.desc&limit=${limit}`;
  if (tierFilter) url += `&lead_tier=eq.${tierFilter}`;
  if (since) url += `&created_at=gte.${since}`;

  try {
    const supabaseRes = await fetch(url, {
      headers: {
        'apikey': supabaseKey,
        'Authorization': `Bearer ${supabaseKey}`,
        'Accept': 'application/json'
      }
    });

    if (!supabaseRes.ok) {
      const err = await supabaseRes.text();
      console.error('Supabase read failed:', err);
      return res.status(500).json({ error: 'Database read failed' });
    }

    const leads = await supabaseRes.json();

    if (format === 'json') {
      return res.status(200).json({ count: leads.length, leads });
    }

    // Build CSV
    const headers = [
      'created_at', 'lead_tier', 'lead_score', 'name', 'phone', 'email',
      'state_code', 'district_slug', 'system_size_kw', 'monthly_bill',
      'property_type', 'intent', 'timeline',
      'consent_whatsapp', 'source', 'status', 'lead_id'
    ];
    
    const escapeCsv = (val) => {
      if (val === null || val === undefined) return '';
      const s = String(val);
      if (s.includes(',') || s.includes('"') || s.includes('\n')) {
        return '"' + s.replace(/"/g, '""') + '"';
      }
      return s;
    };
    
    const csvRows = [headers.join(',')];
    for (const lead of leads) {
      const row = [
        lead.created_at,
        lead.lead_tier,
        lead.lead_score,
        lead.name,
        lead.phone,
        lead.email,
        lead.state_code,
        lead.district_slug,
        lead.system_size_kw,
        lead.monthly_bill,
        lead.property_type,
        lead.intent,
        lead.timeline,
        lead.consent_whatsapp,
        lead.source,
        lead.status,
        lead.id
      ].map(escapeCsv).join(',');
      csvRows.push(row);
    }
    
    const csv = csvRows.join('\n');
    const filename = `solar-leads-${new Date().toISOString().slice(0, 10)}${tierFilter ? '-' + tierFilter : ''}.csv`;
    
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    return res.status(200).send(csv);
    
  } catch (err) {
    console.error('Export error:', err);
    return res.status(500).json({ error: 'Export failed', detail: err.message });
  }
}
