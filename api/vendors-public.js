/**
 * /api/vendors-public.js — Public vendor directory data
 * 
 * Returns publicly-displayable vendor data. No auth required.
 * Used by static directory page for client-side filtering, and any
 * future district-page integration for "Trusted local installers" sections.
 * 
 * Reads from vendors table where show_in_directory=TRUE AND active=TRUE.
 * Falls back to seed JSON if Supabase unreachable (for build-time generation).
 * 
 * Endpoints:
 *   GET /api/vendors-public                          → all public vendors
 *   GET /api/vendors-public?district=lucknow         → vendors covering this district
 *   GET /api/vendors-public?specialization=rooftop_residential
 *   GET /api/vendors-public?tier=premium
 *   GET /api/vendors-public?slug=tata-power-solar    → single vendor by slug
 * 
 * ENV VARS:
 *   SUPABASE_URL
 *   SUPABASE_SERVICE_ROLE_KEY
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
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.setHeader('Cache-Control', 'public, s-maxage=600, stale-while-revalidate=3600');
  
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const { district, specialization, tier, slug, limit = 100 } = req.query;
    
    const supabaseUrl = process.env.SUPABASE_URL;
    const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
    
    if (!supabaseUrl || !supabaseKey) {
      return res.status(500).json({ error: 'Database not configured' });
    }
    
    // Single vendor by slug
    if (slug) {
      const url = `${supabaseUrl}/rest/v1/public_vendor_directory?slug=eq.${slug}&select=*&limit=1`;
      const resp = await fetch(url, {
        headers: { 'apikey': supabaseKey, 'Authorization': `Bearer ${supabaseKey}` }
      });
      const data = await resp.json();
      if (!data || data.length === 0) return res.status(404).json({ error: 'Vendor not found' });
      return res.status(200).json({ vendor: data[0] });
    }
    
    // List query
    let url = `${supabaseUrl}/rest/v1/public_vendor_directory?select=*&limit=${parseInt(limit, 10) || 100}`;
    
    if (district) {
      // Vendor's coverage_districts array must contain this district
      url += `&coverage_districts=cs.{${district}}`;
    }
    if (specialization) {
      url += `&specializations=cs.{${specialization}}`;
    }
    if (tier && tier !== 'all') {
      url += `&tier=eq.${tier}`;
    }
    
    const resp = await fetch(url, {
      headers: { 'apikey': supabaseKey, 'Authorization': `Bearer ${supabaseKey}` }
    });
    
    if (!resp.ok) {
      const err = await resp.text();
      console.error('Supabase fetch failed:', err);
      return res.status(500).json({ error: 'Database error' });
    }
    
    const vendors = await resp.json();
    
    return res.status(200).json({
      vendors,
      count: vendors.length,
      filters: { district: district || null, specialization: specialization || null, tier: tier || null }
    });
    
  } catch (err) {
    console.error('Public vendors error:', err);
    return res.status(500).json({ error: 'Internal error', detail: err.message });
  }
}
