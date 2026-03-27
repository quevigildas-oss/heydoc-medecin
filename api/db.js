// /api/db.js
// DOKITA — Proxy Supabase sécurisé
// V4.3 — 2026-03-27
// FIXES :
//   - id lu depuis req.query.id OU req.body.id (fix PATCH depuis pharmacie.html)
//   - filter2 supporté (double filtre GET)
//   - Body PATCH : lit req.body.data si présent, sinon req.body direct
//   - POST structuré {table, data} supporté
//   - medecins retiré de TABLES_AVEC_IS_TEST (données permanentes)

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PATCH, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, x-dokita-key');

  if (req.method === 'OPTIONS') return res.status(200).end();

  const dokitaKey = req.headers['x-dokita-key'];
  if (dokitaKey !== process.env.DOKITA_SECRET) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const SUPABASE_URL = process.env.SUPABASE_URL;
  const SUPABASE_KEY = process.env.SUPABASE_KEY;
  const IS_TEST      = process.env.DOKITA_ENV !== 'prod';

  // table : req.query en priorité, sinon req.body (POST structuré)
  const table   = req.query.table  || req.body?.table;
  const select  = req.query.select;
  const filter  = req.query.filter;
  const filter2 = req.query.filter2;
  const order   = req.query.order;
  const limit   = req.query.limit;

  // id : req.query.id (PATCH via URL) OU req.body.id (PATCH via body)
  const id = req.query.id || req.body?.id;

  if (!table) {
    return res.status(400).json({ error: 'Paramètre table requis' });
  }

  const TABLES_AUTORISEES = [
    'consultations', 'patients', 'medecins', 'lieux_exercice',
    'examens', 'ordonnances', 'pharmacies', 'appels_offres',
    'familles', 'medicaments'
  ];
  if (!TABLES_AUTORISEES.includes(table)) {
    return res.status(403).json({ error: `Table non autorisée: ${table}` });
  }

  // medecins exclu : données permanentes, is_test géré manuellement
  const TABLES_AVEC_IS_TEST = [
    'consultations', 'patients', 'examens',
    'ordonnances', 'pharmacies', 'appels_offres', 'familles', 'lieux_exercice'
  ];

  try {
    let url    = `${SUPABASE_URL}/rest/v1/${table}`;
    let params = [];

    if (select)  params.push(`select=${select}`);
    if (filter)  params.push(filter);
    if (filter2) params.push(filter2);

    // is_test automatique sur GET (si pas déjà dans les filtres)
    const filterStr = (filter || '') + (filter2 || '');
    if (req.method === 'GET' && TABLES_AVEC_IS_TEST.includes(table) && !filterStr.includes('is_test')) {
      params.push(`is_test=eq.${IS_TEST}`);
    }

    if (order) params.push(`order=${order}`);
    else if (req.method === 'GET') params.push('order=created_at.desc');

    if (limit) params.push(`limit=${limit}`);
    else if (req.method === 'GET') params.push('limit=100');

    if (id) params.push(`id=eq.${id}`);

    if (params.length > 0) url += '?' + params.join('&');

    const headers = {
      'apikey':        SUPABASE_KEY,
      'Authorization': `Bearer ${SUPABASE_KEY}`,
      'Content-Type':  'application/json'
    };

    if (req.method === 'POST')  headers['Prefer'] = 'return=representation';
    if (req.method === 'PATCH') headers['Prefer'] = 'return=representation';

    // Body : supporte format direct {col:val} et structuré {table, id, data:{col:val}}
    let body = req.body;
    if (body && body.data && typeof body.data === 'object') {
      body = body.data;
    }

    // Injecter is_test sur POST
    if (req.method === 'POST' && TABLES_AVEC_IS_TEST.includes(table)) {
      body = { ...body, is_test: IS_TEST };
    }

    const sbRes = await fetch(url, {
      method:  req.method,
      headers: headers,
      body:    ['POST', 'PATCH'].includes(req.method) ? JSON.stringify(body) : undefined
    });

    const data = await sbRes.json();

    if (!sbRes.ok) {
      console.error(`Supabase ${req.method} ${table} error:`, data);
      return res.status(sbRes.status).json({ error: data });
    }

    return res.status(200).json(data);

  } catch (e) {
    console.error('DB proxy error:', e);
    return res.status(500).json({ error: e.message });
  }
}
