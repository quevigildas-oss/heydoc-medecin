// /api/search-med.js
// DOKITA Pro — Autocomplétion médicaments depuis Supabase
// Remplace MEDS_DB hardcodée dans Dokita Pro V4.1
// GET /api/search-med?q=artém → retourne les médicaments correspondants

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

  // Retourner vide si moins de 2 caractères
  if (q.length < 2) {
    return res.status(200).json([]);
  }

  try {
    // Recherche ilike (insensible casse + accents) sur le nom
    const url = `${SUPABASE_URL}/rest/v1/medicaments` +
      `?nom=ilike.*${encodeURIComponent(q)}*` +
      `&actif=eq.true` +
      `&select=nom,classe,dosages` +
      `&limit=8` +
      `&order=nom.asc`;

    const sbRes = await fetch(url, {
      headers: {
        'apikey':        SUPABASE_KEY,
        'Authorization': `Bearer ${SUPABASE_KEY}`,
        'Content-Type':  'application/json'
      }
    });

    if (!sbRes.ok) {
      const err = await sbRes.text();
      console.error('search-med Supabase error:', err);
      return res.status(500).json({ error: err });
    }

    const data = await sbRes.json();

    // Retourner au même format que MEDS_DB pour compatibilité avec le code existant
    // [{nom, classe, dosages:[{dose, conditionnements:[]}]}]
    return res.status(200).json(data || []);

  } catch (e) {
    console.error('search-med error:', e);
    return res.status(500).json({ error: e.message });
  }
}
