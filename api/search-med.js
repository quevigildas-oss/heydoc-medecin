// /api/search-med.js
// DOKITA Pro — Autocomplétion médicaments depuis Supabase
// Remplace MEDS_DB hardcodée dans Dokita Pro V4.1
// GET /api/search-med?q=artém → retourne les médicaments correspondants
// V4.9 — Normalisation accents + double recherche (avec et sans accents)

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, x-dokita-key');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  // Auth
  const dokitaKey = req.headers['x-dokita-key'];
  if (dokitaKey !== process.env.DOKITA_SECRET) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const SUPABASE_URL = process.env.SUPABASE_URL;
  const SUPABASE_KEY = process.env.SUPABASE_KEY;

  const q = (req.query.q || '').trim();

  if (q.length < 2) return res.status(200).json([]);

  // Normaliser : supprimer accents pour la recherche
  const normalize = (str) => str
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '') // supprimer diacritiques
    .toLowerCase();

  const qNorm = normalize(q);

  try {
    const headers = {
      'apikey':        SUPABASE_KEY,
      'Authorization': `Bearer ${SUPABASE_KEY}`,
      'Content-Type':  'application/json'
    };

    // Double recherche en parallèle :
    // 1. Avec la query originale (ex: "Cétiri" → trouve "Cétirizine")
    // 2. Avec la query normalisée (ex: "cetiri" → trouve aussi "Cétirizine" via ilike)
    const [res1, res2] = await Promise.all([
      fetch(
        `${SUPABASE_URL}/rest/v1/medicaments?nom=ilike.*${encodeURIComponent(q)}*&actif=eq.true&select=nom,classe,dosages&limit=8&order=nom.asc`,
        { headers }
      ),
      fetch(
        `${SUPABASE_URL}/rest/v1/medicaments?nom=ilike.*${encodeURIComponent(qNorm)}*&actif=eq.true&select=nom,classe,dosages&limit=8&order=nom.asc`,
        { headers }
      )
    ]);

    const [data1, data2] = await Promise.all([
      res1.ok ? res1.json() : [],
      res2.ok ? res2.json() : []
    ]);

    // Fusionner sans doublons (par nom)
    const seen = new Set();
    const merged = [];
    for (const item of [...(data1 || []), ...(data2 || [])]) {
      const key = (item.nom || '').toLowerCase();
      if (!seen.has(key)) {
        seen.add(key);
        merged.push(item);
      }
    }

    // Trier par pertinence : commence par la query en premier
    merged.sort((a, b) => {
      const an = normalize(a.nom || '');
      const bn = normalize(b.nom || '');
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
}
