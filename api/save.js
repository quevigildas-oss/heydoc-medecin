// /api/save.js
// DOKITA — Sauvegarde consultation dans Supabase
// V4.3 — 2026-03-28
// Remplace Make webhook → Notion
// Accepte les deux formats de champs (ancien: nom/age/poids, nouveau: patient_nom/patient_age/patient_poids)
// + medecin_id

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
  const IS_TEST      = process.env.DOKITA_ENV !== 'prod';

  try {
    const body = req.body;

    if (!body || !body.patient_id) {
      return res.status(400).json({ error: 'patient_id requis' });
    }

    // ── Résolution des champs — accepte ancien format (nom/age/poids) ET nouveau (patient_nom/patient_age/patient_poids) ──
    const patientNom   = body.patient_nom   || body.nom   || '';
    const patientAge   = body.patient_age   !== undefined ? body.patient_age   : body.age;
    const patientPoids = body.patient_poids !== undefined ? body.patient_poids : body.poids;
    const patientVille = body.patient_ville || body.ville || 'Non renseignée';
    const patientVoyage= body.patient_voyage|| body.voyage|| 'Aucun';

    // ── ID consultation : utiliser celui du client si fourni, sinon générer ──
    const now     = new Date();
    const ts      = now.getTime();
    const dateStr = now.toISOString().slice(0, 10).replace(/-/g, '');
    const hStr    = String(now.getHours()).padStart(2, '0') + String(now.getMinutes()).padStart(2, '0');
    const consultationId = body.consultation_id || `DOS-${body.patient_id}-${dateStr}-${hStr}-${String(ts).slice(-4)}`;

    // ── Construire le payload Supabase ──
    const payload = {
      consultation_id:      consultationId,

      // Patient
      patient_id:           body.patient_id        || '',
      patient_nom:          patientNom,
      patient_age:          parseInt(patientAge)   || null,
      patient_poids:        parseFloat(patientPoids)|| null,
      patient_ville:        patientVille,
      patient_voyage:       patientVoyage,

      // Médecin assigné
      medecin_id:           body.medecin_id        || null,

      // Consultation Dr. AfriBot
      symptomes:            body.symptomes          || '',
      diagnostic_ia:        body.diagnostic_ia      || body.diagnostic || '',

      // Recommandations OMS
      examens_recommandes:  body.examens_recommandes|| body.examens     || '',
      recommandations_oms:  body.recommandations_oms|| body.recommandations || '',
      medicaments_oms:      body.medicaments_oms    || '',
      contre_indications:   body.contre_indications || '',
      sources_oms:          body.sources_oms        || body.sources     || '',

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

    console.log(`✅ Consultation créée — ID: ${consultationId} | medecin_id: ${payload.medecin_id} | is_test: ${IS_TEST}`);

    // ── Créer les examens si présents ──
    if (consultId && payload.examens_recommandes) {
      const examensTexte = payload.examens_recommandes;

      const lignes = examensTexte.split(/[,|\n]/)
        .map(l => l.trim())
        .filter(l => l.length > 3);

      const examensPayload = lignes.map(type_examen => ({
        consultation_id:       consultId,
        patient_id:            payload.patient_id,
        type_examen:           type_examen.replace(/^(✅|⚠️|OUI|NON|—)\s*/i, '').trim(),
        obligatoire:           /obligatoire/i.test(type_examen),
        source_recommandation: payload.sources_oms || '',
        statut:                'prescrit',
        is_test:               IS_TEST
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
          console.log(`✅ ${examensPayload.length} examens créés`);
        } else {
          console.warn('⚠️ Erreur création examens:', await examRes.text());
        }
      }
    }

    return res.status(200).json({
      success:         true,
      consultation_id: consultationId,
      uuid:            consultId,
      is_test:         IS_TEST
    });

  } catch (e) {
    console.error('Save error:', e);
    return res.status(500).json({ error: e.message });
  }
}
