// api/claude.js — Proxy Vercel sécurisé pour API Anthropic
// Clé dans variable d'environnement Vercel : ANTHROPIC_KEY

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const apiKey = process.env.ANTHROPIC_KEY;
  if (!apiKey) return res.status(500).json({ error: 'ANTHROPIC_KEY non configurée' });

  try {
    const { prompt, system } = req.body;
    if (!prompt) return res.status(400).json({ error: 'prompt requis' });

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
        system: system || 'Tu es un expert en pharmacologie clinique et protocoles OMS Afrique subsaharienne.',
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
