// /api/rag.js
// DOKITA — API RAG Supabase pgvector + Claude
// Remplace /api/relevance (Relevance AI)

export default async function handler(req, res) {
  // CORS
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

  const { messages, patient } = req.body;
  if (!messages || !messages.length) {
    return res.status(400).json({ error: 'messages requis' });
  }

  const SUPABASE_URL = process.env.SUPABASE_URL;
  const SUPABASE_KEY = process.env.SUPABASE_KEY;
  const OPENAI_KEY   = process.env.OPENAI_KEY;
  const CLAUDE_KEY   = process.env.ANTHROPIC_KEY;

  try {
    // 1. Extraire la dernière question du patient
    const lastMsg = messages[messages.length - 1].content || '';

    // 2. Créer embedding OpenAI
    const embRes = await fetch('https://api.openai.com/v1/embeddings', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${OPENAI_KEY}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        model: 'text-embedding-3-small',
        input: lastMsg.slice(0, 8000)
      })
    });
    const embData = await embRes.json();
    const embedding = embData?.data?.[0]?.embedding;
    console.log('Embedding OK:', !!embedding, 'OpenAI error:', embData?.error?.message || 'none');

    // 3. Recherche Supabase pgvector
    let chunks = [];
    if (embedding) {
      const searchRes = await fetch(`${SUPABASE_URL}/rest/v1/rpc/search_medical`, {
        method: 'POST',
        headers: {
          'apikey': SUPABASE_KEY,
          'Authorization': `Bearer ${SUPABASE_KEY}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          query_embedding: embedding,
          match_count: 5
        })
      });
      chunks = await searchRes.json();
      console.log('Chunks found:', Array.isArray(chunks) ? chunks.length : 'error', typeof chunks === 'object' && !Array.isArray(chunks) ? JSON.stringify(chunks).slice(0,200) : '');
    }

    // 4. Construire contexte médical
    const contexteMedial = Array.isArray(chunks) && chunks.length > 0
      ? chunks.map(c => `[Source: ${c.source}]\n${c.content}`).join('\n\n---\n\n')
      : '';

    // 5. Construire prompt Claude
    const systemPrompt = `Tu es Dr. AfriBot, un assistant médical spécialisé dans les maladies africaines et tropicales.

SOURCES AUTORISÉES :
Tu disposes des guidelines médicales OMS/MSF suivantes pour cette consultation :

${contexteMedial || 'Aucune source médicale trouvée pour cette requête.'}

INSTRUCTIONS :
- Base tes recommandations UNIQUEMENT sur les sources ci-dessus
- Si les sources ne couvrent pas la question, dis-le clairement
- Cite toujours la source utilisée
- Adapte les dosages à l'âge et au poids du patient
- Réponds en français

PROTOCOLE CONSULTATION GUIDÉE :
PHASE 1 — ACCUEIL
Commence TOUJOURS par : "Bonjour ! 👋 Je suis Dr. AfriBot..."

PHASE 2 — COLLECTE SYMPTÔMES
Guide le patient étape par étape pour collecter :
- Symptômes principaux et durée
- Fièvre (température si possible)
- Contexte (voyage, zone endémique)
- Médicaments déjà pris

PHASE 3 — ANALYSE ET ORIENTATION
- Suspicions diagnostiques avec probabilités
- Examens recommandés
- En attendant la consultation : conseils pratiques

PHASE 4 — RÉSUMÉ CONSULTATION
Quand le patient envoie "RESUME_CONSULTATION", génère UNIQUEMENT ce JSON :
{
  "nom": "Patient",
  "age": "X",
  "poids": "X",
  "ville": "X",
  "voyage": "X",
  "symptomes": "...",
  "diagnostic": "...",
  "recommandations": "...",
  "examens": "...",
  "medicaments_oms": "...",
  "contre_indications": "...",
  "sources": "..."
}

LANGUE : Réponds TOUJOURS dans la même langue que le patient.`;

    // 6. Appel Claude
    const claudeRes = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'x-api-key': CLAUDE_KEY,
        'anthropic-version': '2023-06-01',
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-20250514',
        max_tokens: 1500,
        system: systemPrompt,
        messages: messages
      })
    });
    const claudeData = await claudeRes.json();
    const answer = claudeData?.content?.[0]?.text || '';
    console.log('Claude status:', claudeRes.status);
    console.log('Claude error:', claudeData?.error?.message || 'none');
    console.log('Answer length:', answer.length);

    return res.status(200).json({
      answer,
      chunks_used: Array.isArray(chunks) ? chunks.length : 0,
      debug: claudeData?.error ? claudeData.error : null
    });

  } catch (e) {
    console.error('RAG error:', e);
    return res.status(500).json({ error: e.message });
  }
}
