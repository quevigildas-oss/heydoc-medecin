// /api/search-med.js
// DOKITA Pro — Autocompletion medicaments depuis Supabase
// V4.10 — Fix module.exports

const handler = async function(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, x-dokita-key');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  const dokitaKey = req.headers['x-dokita-key'];
  if (dokitaKey !== process.env.DOKITA_SECRET) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const SUPABASE_URL = process.env.SUPABASE_URL;
  const SUPABASE_KEY = process.env.SUPABASE_KEY;

  const q = (req.query.q || '').trim();
  if (q.length < 2) return res.status(200).json([]);

  const qNorm = q.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();

  try {
    const sbHeaders = {
      'apikey':        SUPABASE_KEY,
      'Authorization': 'Bearer ' + SUPABASE_KEY,
      'Content-Type':  'application/json'
    };

    const url1 = SUPABASE_URL + '/rest/v1/medicaments?nom=ilike.*' + encodeURIComponent(q) + '*&actif=eq.true&select=nom,classe,dosages&limit=8&order=nom.asc';
    const url2 = SUPABASE_URL + '/rest/v1/medicaments?nom=ilike.*' + encodeURIComponent(qNorm) + '*&actif=eq.true&select=nom,classe,dosages&limit=8&order=nom.asc';

    const [sbRes1, sbRes2] = await Promise.all([
      fetch(url1, { headers: sbHeaders }),
      fetch(url2, { headers: sbHeaders })
    ]);

    const data1 = sbRes1.ok ? await sbRes1.json() : [];
    const data2 = sbRes2.ok ? await sbRes2.json() : [];

    const arr1 = Array.isArray(data1) ? data1 : [];
    const arr2 = Array.isArray(data2) ? data2 : [];

    const seen   = new Set();
    const merged = [];
    for (const item of [...arr1, ...arr2]) {
      if (!item || !item.nom) continue;
      const key = item.nom.toLowerCase();
      if (!seen.has(key)) {
        seen.add(key);
        merged.push(item);
      }
    }

    merged.sort(function(a, b) {
      const an = (a.nom || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
      const bn = (b.nom || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
      const aStarts = an.startsWith(qNorm) ? 0 : 1;
      const bStarts = bn.startsWith(qNorm) ? 0 : 1;
      if (aStarts !== bStarts) return aStarts - bStarts;
      return an.localeCompare(bn);
    });

    return res.status(200).json(merged.slice(0, 8));

  } catch (e) {
    console.error('search-med error:', e);
    return res.status(500).json({ error: e.message });
  }
};

module.exports = handler;
