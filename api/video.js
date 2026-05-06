// /api/video.js
// DOKITA — Creation room video/audio Daily.co
// V1.1 — Fix module.exports

const handler = async function(req, res) {
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
    return res.status(500).json({ error: 'DAILY_API_KEY non configuree' });
  }

  // DELETE — Fermer/supprimer une room
  if (req.method === 'DELETE') {
    const { room_name } = req.body || {};
    if (!room_name) return res.status(400).json({ error: 'room_name requis' });
    try {
      await fetch('https://api.daily.co/v1/rooms/' + room_name, {
        method:  'DELETE',
        headers: { 'Authorization': 'Bearer ' + DAILY_KEY }
      });
      return res.status(200).json({ success: true });
    } catch(e) {
      return res.status(500).json({ error: e.message });
    }
  }

  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { consultation_id, patient_nom, medecin_nom, mode } = req.body || {};
  if (!consultation_id) return res.status(400).json({ error: 'consultation_id requis' });

  const isAudio  = mode === 'audio';
  const expireAt = Math.floor(Date.now() / 1000) + (2 * 60 * 60);
  const roomName = 'dokita-' + consultation_id.slice(-12) + '-' + Date.now().toString(36);

  try {
    // 1. Creer la room Daily.co
    const roomRes = await fetch('https://api.daily.co/v1/rooms', {
      method:  'POST',
      headers: { 'Authorization': 'Bearer ' + DAILY_KEY, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name:     roomName,
        privacy:  'private',
        properties: {
          exp:              expireAt,
          max_participants: 2,
          start_video_off:  isAudio,
          start_audio_off:  false,
          enable_chat:      false,
          enable_screenshare: false,
          enable_recording: false,
          lang:             'fr'
        }
      })
    });

    if (!roomRes.ok) {
      const err = await roomRes.text();
      return res.status(500).json({ error: 'Erreur creation room Daily.co', detail: err });
    }

    const room    = await roomRes.json();
    const roomUrl = room.url;

    // 2. Token medecin
    const tokenMedRes = await fetch('https://api.daily.co/v1/meeting-tokens', {
      method:  'POST',
      headers: { 'Authorization': 'Bearer ' + DAILY_KEY, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        properties: {
          room_name:       roomName,
          exp:             expireAt,
          is_owner:        true,
          user_name:       medecin_nom || 'Medecin Dokita',
          user_id:         'medecin',
          start_video_off: isAudio,
          start_audio_off: false
        }
      })
    });
    const tokenMedecin = (await tokenMedRes.json()).token;

    // 3. Token patient
    const tokenPatRes = await fetch('https://api.daily.co/v1/meeting-tokens', {
      method:  'POST',
      headers: { 'Authorization': 'Bearer ' + DAILY_KEY, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        properties: {
          room_name:       roomName,
          exp:             expireAt,
          is_owner:        false,
          user_name:       patient_nom || 'Patient',
          user_id:         'patient',
          start_video_off: isAudio,
          start_audio_off: false
        }
      })
    });
    const tokenPatient = (await tokenPatRes.json()).token;

    console.log('Room creee: ' + roomName + ' | mode: ' + (isAudio ? 'audio' : 'video'));

    return res.status(200).json({
      success:       true,
      room_name:     roomName,
      room_url:      roomUrl,
      token_medecin: tokenMedecin,
      token_patient: tokenPatient,
      mode:          isAudio ? 'audio' : 'video',
      expire_at:     expireAt,
      url_patient:   roomUrl + '?t=' + tokenPatient
    });

  } catch (e) {
    console.error('video.js error:', e);
    return res.status(500).json({ error: e.message });
  }
};

module.exports = handler;
