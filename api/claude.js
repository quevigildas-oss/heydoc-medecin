// api/claude.js — Proxy Vercel sécurisé pour API Anthropic
// V4.3 — 2026-03-28
// FIXES :
//   - temperature: 0 (résultats déterministes — pas de variance entre validations)
//   - System prompt strict — Claude se base UNIQUEMENT sur les données du prompt
//     et non sur sa mémoire médicale personnelle

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, x-dokita-key');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const dokitaToken = req.headers['x-dokita-key'];
  if (!dokitaToken || dokitaToken !== process.env.DOKITA_SECRET) {
    return res.status(401).json({ error: 'Non autorisé' });
  }

  const apiKey = process.env.ANTHROPIC_KEY;
  if (!apiKey) return res.status(500).json({ error: 'ANTHROPIC_KEY non configurée' });

  try {
    const { prompt, system } = req.body;
    if (!prompt) return res.status(400).json({ error: 'prompt requis' });

    const systemPrompt = system ||
      'Tu es un validateur de prescription Dokita. ' +
      'Ton rôle est de comparer ce que le médecin a prescrit avec les recommandations OMS fournies dans le prompt. ' +
      'RÈGLE ABSOLUE : Tu te bases UNIQUEMENT sur les données OMS présentes dans le prompt (champs EXAMENS RECOMMANDÉS OMS, MÉDICAMENTS OMS, CONTRE-INDICATIONS OMS). ' +
      'Tu n\'utilises JAMAIS ta propre connaissance médicale pour compléter, corriger ou remplacer ces données. ' +
      'Si un champ OMS est absent ou vide, tu indiques "Référence OMS non disponible" et tu ne le remplace pas par ta propre connaissance. ' +
      'Tu ne proposes JAMAIS de traitement alternatif qui ne figure pas explicitement dans les champs OMS du prompt. ' +
      'Tu n\'inventes JAMAIS de fourchette de dosage — tu utilises uniquement celles présentes dans le prompt. ' +
      'Si les données OMS du prompt sont insuffisantes pour statuer, tu réponds VERDICT: EN_ATTENTE avec une explication.';

    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-20250514',
        max_tokens: 1024,
        temperature: 0,
        system: systemPrompt,
        messages: [{ role: 'user', content: prompt }]
      })
    });

    const data = await response.json();

    if (!response.ok) {
      return res.status(response.status).json({ error: data.error?.message || 'Erreur API' });
    }

    const text = data.content?.[0]?.text || '';
    return res.status(200).json({ answer: text });

  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
}
