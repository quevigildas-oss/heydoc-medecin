// /api/save.js
// DOKITA — Sauvegarde consultation dans Supabase
// Remplace Make webhook → Notion
// Appelé depuis Dokita V4.2 après RESUME_CONSULTATION

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, x-dokita-key');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  // Auth
  const dokitaKey = req.headers['x-dokita-key'];
  if (dokitaKey !== process.env.DOKITA_SECRET) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const SUPABASE_URL = process.env.SUPABASE_URL;
  const SUPABASE_KEY = process.env.SUPABASE_KEY;
  const IS_TEST      = process.env.DOKITA_ENV !== 'prod'; // true en dev, false en prod

  try {
    const body = req.body;

    // ── Valider les champs minimum requis ──
    if (!body || !body.patient_id) {
      return res.status(400).json({ error: 'patient_id requis' });
    }

    // ── Générer un ID consultation unique ──
    const now     = new Date();
    const ts      = now.getTime();
    const dateStr = now.toISOString().slice(0, 10).replace(/-/g, '');
    const hStr    = String(now.getHours()).padStart(2, '0') + String(now.getMinutes()).padStart(2, '0');
    const consultationId = `DOS-${body.patient_id}-${dateStr}-${hStr}-${String(ts).slice(-4)}`;

    // ── Construire le payload Supabase ──
    const payload = {
      consultation_id:      consultationId,

      // Patient
      patient_id:           body.patient_id        || '',
      patient_nom:          body.nom                || '',
      patient_age:          parseInt(body.age)      || null,
      patient_poids:        parseFloat(body.poids)  || null,
      patient_ville:        body.ville              || 'Non renseignée',
      patient_voyage:       body.voyage             || 'Aucun',

      // Consultation Dr. AfriBot
      symptomes:            body.symptomes          || '',
      diagnostic_ia:        body.diagnostic         || '',

      // Recommandations OMS depuis Supabase pgvector
      // ⚠️ Ces champs sont masqués au médecin jusqu'à soumission prescription
      examens_recommandes:  body.examens            || '',
      recommandations_oms:  body.recommandations    || '',
      medicaments_oms:      body.medicaments_oms    || '',
      contre_indications:   body.contre_indications || '',
      sources_oms:          body.sources            || '',

      // Statut initial
      statut:               'en_attente',
      validation_ia:        'EN_ATTENTE',

      // Environnement
      is_test:              IS_TEST
    };

    // ── Insérer dans Supabase ──
    const insertRes = await fetch(`${SUPABASE_URL}/rest/v1/consultations`, {
      method: 'POST',
      headers: {
        'apikey':        SUPABASE_KEY,
        'Authorization': `Bearer ${SUPABASE_KEY}`,
        'Content-Type':  'application/json',
        'Prefer':        'return=representation'
      },
      body: JSON.stringify(payload)
    });

    if (!insertRes.ok) {
      const err = await insertRes.text();
      console.error('Supabase insert error:', err);
      return res.status(500).json({ error: 'Erreur Supabase', detail: err });
    }

    const inserted = await insertRes.json();
    const consultId = inserted?.[0]?.id || null;

    console.log(`✅ Consultation créée — ID: ${consultationId} | is_test: ${IS_TEST} | uuid: ${consultId}`);

    // ── Créer les examens si obligatoires ──
    // Extraction simple depuis le texte examens_recommandes
    if (consultId && payload.examens_recommandes) {
      const examensTexte = payload.examens_recommandes;

      // Détecter les examens obligatoires (contient "OUI" ou "obligatoire")
      const lignes = examensTexte.split(/[,|\n]/)
        .map(l => l.trim())
        .filter(l => l.length > 3);

      const examensPayload = lignes.map(type_examen => ({
        consultation_id:      consultId,
        patient_id:           payload.patient_id,
        type_examen:          type_examen.replace(/^(✅|⚠️|OUI|NON)\s*/i, '').trim(),
        obligatoire:          /obligatoire|✅\s*OUI/i.test(type_examen),
        source_recommandation: payload.sources_oms || '',
        statut:               'prescrit',
        is_test:              IS_TEST
      })).filter(e => e.type_examen.length > 2);

      if (examensPayload.length > 0) {
        const examRes = await fetch(`${SUPABASE_URL}/rest/v1/examens`, {
          method: 'POST',
          headers: {
            'apikey':        SUPABASE_KEY,
            'Authorization': `Bearer ${SUPABASE_KEY}`,
            'Content-Type':  'application/json',
            'Prefer':        'return=minimal'
          },
          body: JSON.stringify(examensPayload)
        });

        if (examRes.ok) {
          console.log(`✅ ${examensPayload.length} examens créés pour consultation ${consultationId}`);
        } else {
          console.warn('⚠️ Erreur création examens:', await examRes.text());
        }
      }
    }

    // ── Retourner succès ──
    return res.status(200).json({
      success:         true,
      consultation_id: consultationId,
      uuid:            consultId,
      is_test:         IS_TEST,
      examens_crees:   payload.examens_recommandes ? true : false
    });

  } catch (e) {
    console.error('Save error:', e);
    return res.status(500).json({ error: e.message });
  }
}
