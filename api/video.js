// /api/video.js
// DOKITA — Création room vidéo/audio Daily.co
// POST /api/video
// Body : { consultation_id, patient_nom, medecin_nom, mode } (mode = 'audio' | 'video')
// Retourne : { room_url, token_medecin, token_patient, room_name }
// V1.0 — 12 avril 2026

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, x-dokita-key');

  if (req.method === 'OPTIONS') return res.status(200).end();

  const dokitaKey = req.headers['x-dokita-key'];
  if (dokitaKey !== process.env.DOKITA_SECRET) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const DAILY_KEY = process.env.DAILY_API_KEY;
  if (!DAILY_KEY) {
    return res.status(500).json({ error: 'DAILY_API_KEY non configurée' });
  }

  // ── DELETE — Fermer/supprimer une room ──
  if (req.method === 'DELETE') {
    const { room_name } = req.body || {};
    if (!room_name) return res.status(400).json({ error: 'room_name requis' });
    try {
      await fetch(`https://api.daily.co/v1/rooms/${room_name}`, {
        method: 'DELETE',
        headers: { 'Authorization': `Bearer ${DAILY_KEY}` }
      });
      return res.status(200).json({ success: true });
    } catch(e) {
      return res.status(500).json({ error: e.message });
    }
  }

  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { consultation_id, patient_nom, medecin_nom, mode } = req.body || {};
  if (!consultation_id) return res.status(400).json({ error: 'consultation_id requis' });

  const isAudio = mode === 'audio'; // true = audio seul, false = vidéo

  try {
    // ── 1. Créer la room Daily.co ──
    const roomName = `dokita-${consultation_id.slice(-12)}-${Date.now().toString(36)}`;
    const expireAt = Math.floor(Date.now() / 1000) + (2 * 60 * 60); // expire dans 2h

    const roomRes = await fetch('https://api.daily.co/v1/rooms', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${DAILY_KEY}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        name: roomName,
        privacy: 'private', // accès uniquement via token
        properties: {
          exp: expireAt,
          max_participants: 2,
          // Mode audio uniquement si demandé
          start_video_off: isAudio,
          start_audio_off: false,
          // Désactiver les features inutiles pour consultation médicale
          enable_chat: false,
          enable_screenshare: false,
          enable_recording: false,
          // Interface épurée
          lang: 'fr'
        }
      })
    });

    if (!roomRes.ok) {
      const err = await roomRes.text();
      console.error('Daily.co room error:', err);
      return res.status(500).json({ error: 'Erreur création room Daily.co', detail: err });
    }

    const room = await roomRes.json();
    const roomUrl = room.url; // ex: https://dokita.daily.co/dokita-xxxx

    // ── 2. Créer token médecin (owner = peut admettre le patient) ──
    const tokenMedecinRes = await fetch('https://api.daily.co/v1/meeting-tokens', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${DAILY_KEY}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        properties: {
          room_name: roomName,
          exp: expireAt,
          is_owner: true, // médecin = owner
          user_name: medecin_nom || 'Médecin Dokita',
          user_id: 'medecin',
          start_video_off: isAudio,
          start_audio_off: false
        }
      })
    });

    const tokenMedecinData = await tokenMedecinRes.json();
    const tokenMedecin = tokenMedecinData.token;

    // ── 3. Créer token patient ──
    const tokenPatientRes = await fetch('https://api.daily.co/v1/meeting-tokens', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${DAILY_KEY}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        properties: {
          room_name: roomName,
          exp: expireAt,
          is_owner: false,
          user_name: patient_nom || 'Patient',
          user_id: 'patient',
          start_video_off: isAudio,
          start_audio_off: false
        }
      })
    });

    const tokenPatientData = await tokenPatientRes.json();
    const tokenPatient = tokenPatientData.token;

    console.log(`✅ Room créée: ${roomName} | mode: ${isAudio ? 'audio' : 'vidéo'} | expire: ${new Date(expireAt * 1000).toISOString()}`);

    return res.status(200).json({
      success:        true,
      room_name:      roomName,
      room_url:       roomUrl,
      token_medecin:  tokenMedecin,
      token_patient:  tokenPatient,
      mode:           isAudio ? 'audio' : 'video',
      expire_at:      expireAt,
      // URL patient avec token intégré (pour le lien WhatsApp)
      url_patient:    `${roomUrl}?t=${tokenPatient}`
    });

  } catch (e) {
    console.error('video.js error:', e);
    return res.status(500).json({ error: e.message });
  }
}
