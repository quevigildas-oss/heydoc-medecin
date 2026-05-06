// /api/db.js
// DOKITA — Proxy Supabase sécurisé
// V4.10 — Fix module.exports + ajout tables manquantes

const handler = async function(req, res) {
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

  const _q = req.query;
  const _bodyTable = (req.method === 'POST' && req.body && req.body.table) ? req.body.table : null;
  const table   = _q.table   || _bodyTable;
  const filter  = _q.filter;
  const filter2 = _q.filter2;
  const filter3 = _q.filter3;
  const order   = _q.order;
  const limit   = _q.limit;
  const id      = _q.id;
  const select  = _q.select;

  if (!table) {
    return res.status(400).json({ error: 'Parametre table requis' });
  }

  const TABLES_AUTORISEES = [
    'consultations', 'patients', 'medecins', 'lieux_exercice',
    'examens', 'ordonnances', 'pharmacies', 'appels_offres',
    'familles', 'medicaments', 'dossier_medical',
    'etablissements', 'rendez_vous', 'disponibilites',
    // Tables ajoutees V4.10
    'catalogue_examens', 'stock_pharmacie', 'medical_documents',
    'remboursements'
  ];

  if (!TABLES_AUTORISEES.includes(table)) {
    return res.status(403).json({ error: 'Table non autorisee: ' + table });
  }

  const TABLES_AVEC_IS_TEST = [
    'consultations', 'patients', 'medecins', 'examens',
    'ordonnances', 'pharmacies', 'appels_offres', 'familles',
    'lieux_exercice', 'dossier_medical', 'rendez_vous'
  ];

  try {
    var url    = SUPABASE_URL + '/rest/v1/' + table;
    var params = [];

    if (select)  params.push('select=' + select);
    if (filter)  params.push(filter);
    if (filter2) params.push(filter2);
    if (filter3) params.push(filter3);

    if (req.method === 'GET' && TABLES_AVEC_IS_TEST.includes(table) && !(filter && filter.includes('is_test'))) {
      params.push('is_test=eq.' + IS_TEST);
    }

    if (order) params.push('order=' + order);
    else if (req.method === 'GET') params.push('order=created_at.desc');

    if (limit) params.push('limit=' + limit);
    else if (req.method === 'GET') params.push('limit=500');

    if (id) params.push('id=eq.' + id);

    if (params.length > 0) url += '?' + params.join('&');

    var headers = {
      'apikey':        SUPABASE_KEY,
      'Authorization': 'Bearer ' + SUPABASE_KEY,
      'Content-Type':  'application/json'
    };

    if (req.method === 'POST')  headers['Prefer'] = 'return=representation';
    if (req.method === 'PATCH') headers['Prefer'] = 'return=representation';

    var body = req.body;
    if (req.method === 'POST' && body && body.table && body.data) {
      body = body.data;
    }
    if (req.method === 'POST' && TABLES_AVEC_IS_TEST.includes(table)) {
      body = Object.assign({}, body, { is_test: IS_TEST });
    }

    var sbRes = await fetch(url, {
      method:  req.method,
      headers: headers,
      body:    (req.method === 'POST' || req.method === 'PATCH') ? JSON.stringify(body) : undefined
    });

    var data = await sbRes.json();

    if (!sbRes.ok) {
      console.error('Supabase ' + req.method + ' ' + table + ' error:', data);
      return res.status(sbRes.status).json({ error: data });
    }

    return res.status(200).json(data);

  } catch (e) {
    console.error('DB proxy error:', e);
    return res.status(500).json({ error: e.message });
  }
};

module.exports = handler;
