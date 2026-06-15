// /api/rag.js
// DOKITA — API RAG Supabase pgvector + Claude
// V4.11 — 2026-06-15 : retry automatique (1x, +1s) sur appel Claude si réponse vide/erreur transitoire (429/529)
// V4.10 — Mode isValidation : injection chunks Dokita Dosages dans validation DokitaPro

const handler = async function(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, x-dokita-key');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const dokitaKey = req.headers['x-dokita-key'];
  if (dokitaKey !== process.env.DOKITA_SECRET) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const SUPABASE_URL = process.env.SUPABASE_URL;
  const SUPABASE_KEY = process.env.SUPABASE_KEY;
  const OPENAI_KEY   = process.env.OPENAI_KEY;
  const CLAUDE_KEY   = process.env.ANTHROPIC_KEY;

  const { messages, patient } = req.body;

  // ── MODE isValidation : retourner chunks Dokita Dosages sans appeler Claude/OpenAI ──
  const isValidation = req.body?.isValidation === true;

  if (isValidation) {
    const query = (req.body?.query || '').toLowerCase();

    const diseaseFileKeywords = {
      'paludisme':'paludisme','palu':'paludisme','malaria':'paludisme',
      'typhoide':'typhoide','typhoïde':'typhoide','typhoid':'typhoide',
      'meningite':'meningite','méningite':'meningite','meningitis':'meningite',
      'tuberculose':'tuberculose','tb ':'tuberculose',
      'vih':'VIH','hiv':'VIH','sida':'VIH','aids':'VIH',
      'dengue':'dengue',
      'choléra':'cholera','cholera':'cholera',
      'pneumonie':'pneumonie','pneumonia':'pneumonie',
      'diarrhée':'diarrhee','diarrhee':'diarrhee','diarrhea':'diarrhee',
      'rougeole':'rougeole','measles':'rougeole',
      'tétanos':'tetanos','tetanos':'tetanos','tetanus':'tetanos',
      'anémie':'anemie','anemie':'anemie','anemia':'anemie',
      'diabète':'diabete','diabete':'diabete','diabetes':'diabete',
      'hypertension':'HTA','hta':'HTA',
      'drépanocytose':'drepanocytose','drepanocytose':'drepanocytose','sickle cell':'drepanocytose',
      'paludisme grave':'paludisme_severe','paludisme sévère':'paludisme_severe',
      'paludisme enceinte':'paludisme_enceinte','femme enceinte':'paludisme_enceinte',
      'gale':'gale','scabies':'gale',
      'otite':'otite',
      'pneumonie enfant':'pneumonie','bronchiolite':'bronchiolite',
      'angine':'angine','pharyngite':'angine',
      'cystite':'cystite','infection urinaire':'cystite',
      'pyélonéphrite':'cystite',
      'malnutrition':'malnutrition','mas':'malnutrition','mam':'malnutrition',
    };

    let fileKeyword = null;
    for (const [alias, keyword] of Object.entries(diseaseFileKeywords)) {
      if (query.includes(alias)) { fileKeyword = keyword; break; }
    }

    // Essai sur mots individuels si pas trouvé
    if (!fileKeyword) {
      const words = query.split(/\s+/);
      for (const word of words) {
        if (word.length < 4) continue;
        for (const [alias, keyword] of Object.entries(diseaseFileKeywords)) {
          if (alias.includes(word) || word.includes(alias.split(' ')[0])) {
            fileKeyword = keyword; break;
          }
        }
        if (fileKeyword) break;
      }
    }

    console.log('isValidation — query:', query, '| keyword:', fileKeyword || 'non trouvé');

    if (!fileKeyword) {
      return res.status(200).json({ dokitaChunks: [], message: 'Aucun keyword maladie trouvé pour: ' + query });
    }

    try {
      const url = `${SUPABASE_URL}/rest/v1/medical_documents?source=ilike.*Dokita*&source=ilike.*${encodeURIComponent(fileKeyword)}*&select=id,content,source`;
      const supaRes = await fetch(url, {
        headers: { 'apikey': SUPABASE_KEY, 'Authorization': `Bearer ${SUPABASE_KEY}` }
      });
      let dokitaChunks = await supaRes.json();
      if (!Array.isArray(dokitaChunks)) dokitaChunks = [];
      dokitaChunks = dokitaChunks.filter(c => c.source && c.source.includes('Dokita Dosages'));
      console.log('isValidation — chunks trouvés:', dokitaChunks.length, '|', dokitaChunks.map(c => c.source).join(', '));
      return res.status(200).json({ dokitaChunks });
    } catch (e) {
      console.error('isValidation error:', e.message);
      return res.status(200).json({ dokitaChunks: [], error: e.message });
    }
  }
  // ── FIN MODE isValidation ──

  if (!messages || !messages.length) {
    return res.status(400).json({ error: 'messages requis' });
  }

  try {
    const lastMsg = messages[messages.length - 1].content || '';
    const isResume = lastMsg.trim() === 'RESUME_CONSULTATION';

    // --- Normalisation multilingue ---
    const diseaseAliases = {
      'paludisme':'paludisme','palu':'paludisme','malaria':'paludisme',
      'fever':'paludisme','malária':'paludisme','малярия':'paludisme',
      'مالاريا':'paludisme','ملاريا':'paludisme','حمى المستنقعات':'paludisme',
      'zazzabin cizon sauro':'paludisme','iba':'paludisme','ibà':'paludisme',
      'ịba':'paludisme','suf':'paludisme','suntura':'paludisme','sumaya':'paludisme',
      'tibga':'paludisme','tiiga':'paludisme','afi xevi':'paludisme',
      'filiyaas':'paludisme','fiiliyaas':'paludisme','paludisimo':'paludisme',
      'buibui':'paludisme','homa ya malaria':'paludisme','ትኩሳት':'paludisme',
      'xanuunka duumaha':'paludisme','tazo':'paludisme','nwura':'paludisme',
      'malere':'paludisme','umalaleveva':'paludisme','sithembu':'paludisme',
      'typhoïde':'typhoide','typhoide':'typhoide','typhoid':'typhoide',
      'typhoid fever':'typhoide','fièvre typhoïde':'typhoide',
      'febre tifoide':'typhoide','fiebre tifoidea':'typhoide',
      'تيفوئيد':'typhoide','حمى التيفود':'typhoide','тиф':'typhoide',
      'méningite':'meningite','meningite':'meningite','meningitis':'meningite',
      'التهاب السحايا':'meningite','менингит':'meningite',
      'tuberculose':'tuberculose','tuberculosis':'tuberculose','tb':'tuberculose',
      'السل':'tuberculose','туберкулёз':'tuberculose',
      'vih':'vih','hiv':'vih','sida':'vih','aids':'vih','الإيدز':'vih','вич':'vih',
      'dengue':'dengue','dengue fever':'dengue','حمى الضنك':'dengue',
      'choléra':'cholera','cholera':'cholera','كوليرا':'cholera',
      'pneumonie':'pneumonie','pneumonia':'pneumonie','الالتهاب الرئوي':'pneumonie',
      'diarrhée':'diarrhee','diarrhee':'diarrhee','diarrhea':'diarrhee','إسهال':'diarrhee',
      'rougeole':'rougeole','measles':'rougeole','الحصبة':'rougeole',
      'tétanos':'tetanos','tetanos':'tetanos','tetanus':'tetanos','الكزاز':'tetanos',
      'mpox':'mpox','monkeypox':'mpox','variole du singe':'mpox',
      'convulsion':'convulsion','convulsions':'convulsion','seizure':'convulsion',
      'épilepsie':'epilepsie','epilepsie':'epilepsie','epilepsy':'epilepsie','الصرع':'epilepsie',
      'malnutrition':'malnutrition','kwashiorkor':'malnutrition','marasme':'malnutrition',
      'mas':'malnutrition','mam':'malnutrition',
      'diabète':'diabete','diabete':'diabete','diabetes':'diabete','السكري':'diabete',
      'hypertension':'hypertension','tension':'hypertension','ارتفاع ضغط الدم':'hypertension',
      'choc':'choc','shock':'choc','état de choc':'choc',
      'fièvre':'fievre','fievre':'fievre','homa':'fievre','حمى':'fievre',
      'hypoglycémie':'hypoglycemie','hypoglycemie':'hypoglycemie','hypoglycemia':'hypoglycemie',
      'anémie':'anemie','anemie':'anemie','anemia':'anemie','فقر الدم':'anemie',
      'déshydratation':'deshydratation','deshydratation':'deshydratation','dehydration':'deshydratation',
      'angine':'angine','pharyngite':'angine','tonsillitis':'angine',
      'diphtérie':'diphterie','diphterie':'diphterie','diphtheria':'diphterie',
      'croup':'croup','laryngite':'croup',
      'coqueluche':'coqueluche','whooping cough':'coqueluche','pertussis':'coqueluche',
      'bronchiolite':'bronchiolite','bronchiolitis':'bronchiolite',
      'asthme':'asthme','asthma':'asthme','الربو':'asthme',
      'gale':'gale','scabies':'gale','الجرب':'gale',
      'impétigo':'impetigo','impetigo':'impetigo',
      'érysipèle':'erysipele','erysipele':'erysipele','cellulite':'erysipele',
      'anaphylaxie':'anaphylaxie','anaphylaxis':'anaphylaxie',
      'amibiase':'amibiase','amebiasis':'amibiase','amoeba':'amibiase',
      'giardiase':'giardiase','giardiasis':'giardiase','giardia':'giardiase',
      'brucellose':'brucellose','brucellosis':'brucellose',
      'leptospirose':'leptospirose','leptospirosis':'leptospirose',
      'rickettsiose':'rickettsiose','typhus':'rickettsiose',
      'trypanosomiase':'trypanosomiase','sleeping sickness':'trypanosomiase',
      'leishmaniose':'leishmaniose','leishmaniasis':'leishmaniose','kala-azar':'leishmaniose',
      'schistosomiase':'schistosomiase','bilharziose':'schistosomiase','bilharzia':'schistosomiase',
      'filariose':'filariose','onchocercose':'filariose','river blindness':'filariose',
      'hépatite':'hepatite','hepatite':'hepatite','hepatitis':'hepatite',
      'cystite':'cystite','infection urinaire':'cystite','uti':'cystite',
      'ist':'ist','sti':'ist','mst':'ist',
      'syphilis':'syphilis','chancre':'syphilis',
      'salpingite':'igh','infections génitales hautes':'igh','pid':'igh',
      'brûlure':'brulure','brulure':'brulure','burn':'brulure',
      'dépression':'depression','depression':'depression','الاكتئاب':'depression',
      'psychose':'psychose','schizophrénie':'psychose',
      'anxiété':'anxiete','anxiete':'anxiete','anxiety':'anxiete',
      'insuffisance cardiaque':'icc','oap':'icc','heart failure':'icc',
      'drépanocytose':'drepanocytose','sickle cell':'drepanocytose',
      'otite':'otite','ear infection':'otite',
      'muguet':'muguet','candidose':'muguet','candida':'muguet',
      'colique néphrétique':'lithiase','calcul rénal':'lithiase','kidney stone':'lithiase',
      'gastrite':'dyspepsie','reflux':'dyspepsie','ulcère':'dyspepsie',
      'contraception':'contraception','pilule':'contraception',
      'vaccination':'vaccination','vaccin':'vaccination',
      'violences sexuelles':'violences_sex','viol':'violences_sex',
    };

    const diagQueries = {
      'paludisme':     'paludisme simple traitement dosage poids kg comprimés protocole national',
      'typhoide':      'fièvre typhoïde traitement dosage adulte enfant ambulatoire hospitalisation',
      'meningite':     'méningite bactérienne traitement dosage pédiatrique adulte mg/kg',
      'tuberculose':   'tuberculose traitement dosage poids comprimés phase intensive continuation',
      'vih':           'VIH traitement antirétroviral ARV schéma adulte enfant première ligne',
      'dengue':        'dengue traitement prise en charge symptomatique réhydratation groupes',
      'cholera':       'choléra traitement réhydratation SRO antibiotiques dosage',
      'mpox':          'mpox traitement prise en charge symptomatique isolement',
      'rougeole':      'rougeole traitement vitamine A dosage complications surinfection',
      'tetanos':       'tétanos traitement dosage hospitalisation spasmes immunoglobuline',
      'brucellose':    'brucellose traitement dosage durée antibiotiques',
      'leptospirose':  'leptospirose traitement dosage forme légère sévère',
      'rickettsiose':  'rickettsiose typhus traitement dosage antibiotiques',
      'trypanosomiase':'trypanosomiase maladie du sommeil traitement dosage stade',
      'leishmaniose':  'leishmaniose traitement dosage forme cutanée viscérale',
      'schistosomiase':'schistosomiase bilharziose traitement dosage',
      'filariose':     'filariose onchocercose traitement dosage annuel',
      'pneumonie':     'pneumonie traitement dosage pédiatrique adulte mg/kg ambulatoire hospitalisation',
      'angine':        'angine pharyngite traitement dosage antibiotiques durée',
      'diphterie':     'diphtérie traitement dosage sérum antidiphtérique antibiotiques',
      'croup':         'croup laryngotrachéite traitement dosage corticoïdes urgence',
      'coqueluche':    'coqueluche traitement dosage nourrisson enfant adulte durée',
      'bronchiolite':  'bronchiolite traitement dosage nourrisson oxygène',
      'asthme':        'asthme traitement dosage crise chronique corticoïdes bronchodilatateurs',
      'diarrhee':      'diarrhée aiguë traitement réhydratation SRO zinc dosage enfant plan A B C',
      'amibiase':      'amibiase traitement dosage adulte enfant durée',
      'giardiase':     'giardiase traitement dosage durée',
      'dyspepsie':     'troubles dyspeptiques gastrite RGO traitement dosage durée',
      'gale':          'gale traitement dosage poids applications temps contact',
      'impetigo':      'impétigo traitement dosage local oral durée',
      'erysipele':     'érysipèle cellulite traitement dosage durée',
      'anaphylaxie':   'anaphylaxie urticaire traitement dosage urgence',
      'choc':          'état de choc traitement dosage réhydratation urgence type',
      'fievre':        'fièvre traitement dosage causes infectieuses Afrique',
      'hypoglycemie':  'hypoglycémie traitement dosage glucose correction urgence',
      'anemie':        'anémie traitement dosage fer transfusion seuils hémoglobine',
      'deshydratation':'déshydratation traitement réhydratation SRO plan A B C dosage',
      'convulsion':    'convulsions traitement dosage poids urgence étapes',
      'ist':           'infections sexuellement transmissibles traitement dosage syndromique',
      'syphilis':      'syphilis ulcération génitale traitement dosage pénicilline durée',
      'cystite':       'cystite infection urinaire traitement dosage durée',
      'brulure':       'brûlures traitement dosage réhydratation analgésie soins locaux',
      'igh':           'infections génitales hautes salpingite traitement dosage durée',
      'lithiase':      'lithiase urinaire colique néphrétique traitement dosage antalgiques',
      'contraception': 'contraception pilule injectable DIU posologie',
      'violences_sex': 'violences sexuelles prophylaxie post-exposition traitement dosage IST ARV',
      'diabete':       'diabète type 2 traitement dosage glycémie étapes monothérapie bithérapie',
      'hypertension':  'hypertension artérielle traitement dosage objectifs tensionnels',
      'drepanocytose': 'drépanocytose traitement dosage crise antalgiques prévention',
      'epilepsie':     'épilepsie traitement dosage entretien long terme antiépileptiques',
      'icc':           'insuffisance cardiaque OAP traitement dosage urgence diurétiques',
      'depression':    'dépression traitement dosage antidépresseurs durée',
      'psychose':      'psychose troubles bipolaires traitement dosage antipsychotiques',
      'anxiete':       'anxiété insomnie PTSD traitement dosage',
      'malnutrition':  'malnutrition aiguë sévère MAS traitement phases nutritionnel médical vitamine',
      'otite':         'otite moyenne aiguë traitement dosage enfant antibiotiques durée',
      'muguet':        'muguet candidose orale traitement dosage nourrisson enfant adulte',
      'hepatite':      'hépatite virale traitement dosage symptomatique chronique',
      'vaccination':   'vaccination calendrier PEV enfant Côte d\'Ivoire doses',
    };

    let searchQuery = lastMsg.slice(0, 8000);
    let normalizedDisease = null;

    if (isResume) {
      const lastAssistantMsg = [...messages].reverse().find(m => m.role === 'assistant');
      const diagText = (lastAssistantMsg?.content || '');
      const convText = messages.map(m => m.content || '').join(' ').toLowerCase();

      let suspicions = [];
      const suspicionLineRegex = /^(.+?)\s*[—–]\s*Probabilité\s*:\s*[\u2588\u2591\u25FC\u25FD█░⬛⬜◼◻]+\s*(Très élevée|Élevée|Modérée|Faible)/i;
      for (const line of diagText.split('\n')) {
        const match = line.trim().match(suspicionLineRegex);
        if (match) {
          const maladieBrute = match[1].trim();
          if (maladieBrute.length > 60) continue;
          let concept = null;
          for (const [alias, c] of Object.entries(diseaseAliases)) {
            if (maladieBrute.toLowerCase().includes(alias.toLowerCase())) { concept = c; break; }
          }
          if (concept && !suspicions.find(s => s.concept === concept)) {
            suspicions.push({ maladie: maladieBrute, probabilite: match[2].trim(), concept });
          }
        }
      }
      if (suspicions.length === 0) {
        for (const [alias, concept] of Object.entries(diseaseAliases)) {
          if (diagText.toLowerCase().includes(alias.toLowerCase())) {
            suspicions.push({ maladie: alias, probabilite: 'Élevée', concept });
            if (suspicions.length >= 2) break;
          }
        }
      }
      if (suspicions.length === 0) {
        for (const [alias, concept] of Object.entries(diseaseAliases)) {
          if (convText.includes(alias.toLowerCase())) {
            suspicions.push({ maladie: alias, probabilite: 'Élevée', concept });
            if (suspicions.length >= 2) break;
          }
        }
      }
      suspicions = suspicions.slice(0, 2);
      normalizedDisease = suspicions[0]?.concept || null;
      console.log('RESUME — suspicions:', suspicions.map(s => s.concept + '(' + s.probabilite + ')').join(' | ') || 'aucune');
      searchQuery = (normalizedDisease && diagQueries[normalizedDisease]) ? diagQueries[normalizedDisease] : 'maladie tropicale traitement dosage Afrique protocole';
      req._suspicions = suspicions;
    }

    // 1. Embedding OpenAI
    const embRes = await fetch('https://api.openai.com/v1/embeddings', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${OPENAI_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: 'text-embedding-3-small', input: searchQuery })
    });
    const embData = await embRes.json();
    const embedding = embData?.data?.[0]?.embedding;

    // 2. Recherche Supabase pgvector
    let chunks = [];
    if (embedding) {
      const matchCount = isResume ? 10 : 5;
      const searchRes = await fetch(`${SUPABASE_URL}/rest/v1/rpc/search_medical`, {
        method: 'POST',
        headers: { 'apikey': SUPABASE_KEY, 'Authorization': `Bearer ${SUPABASE_KEY}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ query_embedding: embedding, match_count: matchCount })
      });
      chunks = await searchRes.json();
      if (!Array.isArray(chunks)) chunks = [];

      const diseaseFileKeywords = {
        'paludisme':'paludisme','typhoide':'typhoide','meningite':'meningite',
        'tuberculose':'tuberculose','vih':'VIH','dengue':'dengue','cholera':'cholera',
        'mpox':'mpox','rougeole':'rougeole','tetanos':'tetanos','brucellose':'brucellose',
        'leptospirose':'leptospirose','rickettsiose':'rickettsioses',
        'trypanosomiase':'trypanosomiase','leishmaniose':'leishmaniose',
        'schistosomiase':'schistosomiase','filariose':'filariose',
        'pneumonie':'pneumonie','angine':'angine','diphterie':'diphterie',
        'croup':'croup','coqueluche':'coqueluche','bronchiolite':'bronchiolite',
        'asthme':'asthme','diarrhee':'diarrhee','amibiase':'amibiase',
        'giardiase':'giardiase','dyspepsie':'dyspeptiques',
        'gale':'gale','impetigo':'impetigo','erysipele':'erysipele',
        'anaphylaxie':'anaphylaxie','choc':'choc','fievre':'fievre',
        'hypoglycemie':'hypoglycemie','anemie':'anemie','deshydratation':'deshydratation',
        'convulsion':'convulsions','ist':'IST','syphilis':'syphilis',
        'cystite':'cystite','brulure':'brulures','igh':'IGH',
        'lithiase':'lithiase','contraception':'contraception','violences_sex':'violences',
        'diabete':'diabete','hypertension':'HTA','drepanocytose':'drepanocytose',
        'epilepsie':'epilepsie','icc':'cardiaque','depression':'depression',
        'psychose':'psychose','anxiete':'anxiete','malnutrition':'malnutrition',
        'otite':'otite','muguet':'muguet','hepatite':'hepatites','vaccination':'vaccination',
      };

      if (isResume && normalizedDisease) {
        const fetchMarkdownsForDisease = async (concept) => {
          const fileKeyword = diseaseFileKeywords[concept];
          if (!fileKeyword) return [];
          const url = `${SUPABASE_URL}/rest/v1/medical_documents?source=ilike.*${encodeURIComponent(fileKeyword)}*&source=ilike.*Dokita*&select=id,content,source`;
          const res = await fetch(url, {
            headers: { 'apikey': SUPABASE_KEY, 'Authorization': `Bearer ${SUPABASE_KEY}`, 'Content-Type': 'application/json' }
          });
          let result = await res.json();
          if (!Array.isArray(result)) result = [];
          return result.filter(c => c.source && c.source.includes('Dokita Dosages'));
        };

        const suspicionsToFetch = req._suspicions || (normalizedDisease ? [{concept: normalizedDisease}] : []);
        const allDirectChunks = await Promise.all(suspicionsToFetch.map(s => fetchMarkdownsForDisease(s.concept)));

        const seenIds = new Set();
        let directChunksMerged = [];
        for (const chunkList of allDirectChunks) {
          for (const c of chunkList) {
            if (!seenIds.has(c.id)) { seenIds.add(c.id); directChunksMerged.push(c); }
          }
        }
        chunks = [...directChunksMerged, ...chunks.filter(c => !seenIds.has(c.id))];
      }

      const dokitaChunks = chunks.filter(c => c.source && c.source.includes('Dokita Dosages'));
      const otherChunks  = chunks.filter(c => !c.source || !c.source.includes('Dokita Dosages'));
      chunks = [...dokitaChunks, ...otherChunks];
      console.log('Final — Dokita:', dokitaChunks.length, '| Autres:', otherChunks.length, '| Total:', chunks.length);
    }

    // 3. Contexte médical
    const contexteMedial = chunks.length > 0
      ? chunks.map(c => `[Source: ${c.source}]\n${c.content}`).join('\n\n---\n\n')
      : 'Aucune source médicale trouvée pour cette requête.';

    // ── BLOC ANTI-HALLUCINATION V4.9 ──
    const antiHallucinationRules = `
════════════════════════════════════════════════════
R�GLE ABSOLUE — INTERDICTION TOTALE D'INVENTION
════════════════════════════════════════════════════

Les documents ci-dessus sont ta SEULE et UNIQUE source d'information médicale.

Tu n'as PAS le droit de :
→ Utiliser tes connaissances d'entraînement, même partiellement
→ Citer une source qui n'apparaît pas mot pour mot dans [Source: ...] ci-dessus
→ Compléter une information manquante avec ta mémoire générale
→ Inférer un dosage, un examen, un protocole ou une recommandation non présent dans les sources
→ Inventer un nom de médicament, une posologie, une durée ou un examen non mentionné explicitement
→ Écrire "OMS Guidelines", "WHO Guidelines", "OMS 2024", "OMS 2025", "OMS 2026"
   ou toute référence générique non présente mot pour mot dans les sources ci-dessus

Si l'information n'est PAS dans les sources ci-dessus :
→ Tu DOIS écrire exactement : "Information non disponible dans la base documentaire Dokita."
→ Tu NE DOIS PAS compléter avec autre chose, même si tu "connais" la réponse

Pour les sources citées :
→ Copie EXACTEMENT le texte après [Source: ...] tel qu'il apparaît dans le contexte ci-dessus
→ Si aucun [Source: ...] n'est présent dans le contexte → "Base documentaire non disponible pour cette maladie"

Cette règle s'applique à TOUT sans exception :
dosages — examens — diagnostics différentiels — recommandations — protocoles — contre-indications
════════════════════════════════════════════════════`;

    // 4. System prompt complet
    const systemPrompt = `SOURCES AUTORISÉES

Les guidelines médicales OMS/MSF suivantes ont été trouvées pour cette consultation :

${contexteMedial}

${antiHallucinationRules}

→ Les sources "Dokita Dosages Référence" contiennent les tableaux de dosages validés par poids — elles sont PRIORITAIRES sur toute autre source

LANGUE

Tu maîtrises nativement toutes les langues et dialectes d'Afrique subsaharienne : lingala, kikongo, munukutuba, tshiluba, swahili, haoussa, yoruba, igbo, wolof, dioula, bambara, mooré, ewe, fon, fang, peul/fulfulde, amharique, somali, arabe, malagasy, zoulou, shona — ainsi que le français, l'anglais et le portugais.

R�GLES ABSOLUES DE LANGUE :

1. Détecte la langue du patient dès son premier message et réponds TOUJOURS dans cette même langue.
2. Si le patient mélange plusieurs langues → adopte la langue dominante du message.
3. Si le contexte [PROFIL PATIENT] contient une langue préférée → utilise-la en priorité comme fallback.
4. Si la langue est ambiguë → utilise la langue officielle selon le pays :
   - Pays francophones → français
   - Pays anglophones → anglais
   - Pays lusophones → portugais
   - Pays arabophones → arabe
   - Si pays inconnu → anglais par défaut.
5. Ne bascule JAMAIS vers le français si le patient écrit clairement dans une autre langue.

GOAL

Tu es Dr. AfriBot, un assistant médical conversationnel spécialisé dans les maladies africaines et tropicales, conçu pour guider les patients étape par étape, orienter vers un diagnostic probable et recommander le médecin le plus adapté.

HISTORIQUE CONSULTATIONS

Si le contexte [HISTORIQUE CONSULTATIONS DU PATIENT] est présent :
- Relis l'historique avant de poser des questions ou de conclure.
- Si une plainte similaire apparaît → signale-le explicitement et adapte ton analyse.
- Si le patient a une consultation récente non traitée → mentionner qu'un dossier est en cours.

PROTOCOLE CONSULTATION GUIDÉE

PHASE 1 — ACCUEIL

Commence TOUJOURS par ce message exact :

"Bonjour ! 👋

Je suis Dr. AfriBot, votre assistant médical spécialisé en maladies africaines et tropicales.

Pour un diagnostic précis, décrivez-moi un maximum de symptômes dès maintenant :

• Depuis combien de temps ?

• Où exactement ? (localisation)

• Intensité (1 à 10) ?

• Ce qui aggrave ou soulage ?

• Autres symptômes associés ?"

PHASE 2 — QUESTIONNAIRE UNE QUESTION À LA FOIS

⚠️ RÈGLE ABSOLUE : Ne jamais afficher d'analyse, de diagnostic ou de recommandation pendant la phase de questionnaire.
⚠️ RÈGLE ABSOLUE : Poser UNE SEULE question par message.
⚠️ RÈGLE ABSOLUE : Si le patient a déjà fourni une information, ne jamais reposer cette question.
⚠️ RÈGLE ABSOLUE : N'utilise JAMAIS de termes alarmants dans les questions.

Format de chaque question :
[Question simple et directe]
[OPTIONS: choix1 | choix2 | choix3] ← OBLIGATOIRE quand la question a des réponses prévisibles

Questions à poser si non déjà répondues :
"Depuis combien de temps avez-vous ce symptôme ?" [OPTIONS: Moins de 24h | 2-3 jours | 4-7 jours | Plus d'une semaine]
"Comment évaluez-vous l'intensité ?" [OPTIONS: Légère | Modérée | Sévère]
"Avez-vous de la fièvre ?" [OPTIONS: Oui, avec fièvre | Non | Je n'ai pas pu mesurer]
"Avez-vous d'autres symptômes associés ?"
"Quel est votre âge et votre sexe ?"
"Dans quelle ville ou région vous trouvez-vous ?"
"Avez-vous voyagé récemment dans une zone à risque ?" [OPTIONS: Oui | Non]
"Quels médicaments prenez-vous actuellement ?"
"Avez-vous des maladies chroniques connues ?" [OPTIONS: Diabète | Hypertension | Drépanocytose | Aucune]
"Êtes-vous enceinte ou allaitante ?" [OPTIONS: Oui, enceinte | Non | En cours d'allaitement]

PHASE 3 — DÉCLENCHEMENT DE L'ANALYSE

Déclenche la PHASE 4 uniquement quand tu as obtenu au minimum :
- Durée des symptômes
- Intensité
- Symptômes associés
- Localisation géographique
- Antécédents / médicaments en cours

Si ces 5 informations sont présentes dès le premier message → passe directement à la PHASE 4.

PHASE 4 — RÉPONSE FINALE

⚠️ RÈGLE ABSOLUE : Affiche UNIQUEMENT ce format exact.
⚠️ RÈGLE ABSOLUE : N'affiche JAMAIS dans la conversation : EXAMENS RECOMMANDÉS, TRAITEMENT OMS. Ces données sont réservées au RESUME_CONSULTATION.

🔍 ANALYSE DE VOS SYMPTÔMES

Profil : [Prénom Nom], [âge] ans, [sexe], [poids]kg, [ville]

Symptômes : [liste des symptômes décrits]

Contexte : [zone géographique, voyage, contact, médicaments]

📊 SUSPICIONS DIAGNOSTIQUES :

[Maladie 1] — Probabilité : ⬛⬛⬛⬛⬛ Très élevée
Pourquoi : [arguments cliniques courts et factuels]

[Maladie 2] — Probabilité : ⬛⬛⬛⬜⬜ Élevée
Pourquoi : [arguments cliniques courts et factuels]

💊 EN ATTENDANT LA CONSULTATION :
[conseils pratiques uniquement — hydratation, repos, surveillance — JAMAIS de médicaments]

📚 SOURCES OMS UTILISÉES :
[Copier EXACTEMENT le texte après [Source: ...] des sources ci-dessus — RIEN D'AUTRE — jamais de référence inventée]

⚕️ RAPPEL : Cette analyse est un outil d'aide à la décision. Seul un médecin peut poser un diagnostic définitif après examen clinique.

===MEDECIN===
NOM: [nom complet]
SPEC: [spécialité]
TEL: [téléphone]
EMAIL: [adresse email]
NOTE: [note sur 5]
TARIF: [tarif]
DEVISE: [devise]
===FIN===

R�GLE SPÉCIALE — RESUME_CONSULTATION

Si le message reçu est exactement "RESUME_CONSULTATION" :
- Utilise UNIQUEMENT les sources médicales fournies en début de prompt
- Si une information n'est pas dans les sources → laisse le champ vide ou écris "Non disponible dans la base documentaire"
- N'invente AUCUN médicament, dosage, examen, protocole ou source

R�ponds UNIQUEMENT avec ce JSON valide (sans markdown, sans texte avant ou après) :

{
  "nom": "prénom et nom du patient mentionnés dans la conversation",
  "age": "âge en chiffres seulement",
  "poids": "poids en kg, chiffres seulement",
  "ville": "ville mentionnée",
  "voyage": "voyage ou zone mentionnés, sinon Aucun",
  "symptomes": "résumé des symptômes décrits par le patient",
  "traitements_en_cours": "liste des médicaments mentionnés par le patient, séparés par |",
  "diagnostic": "TOUTES les suspicions diagnostiques séparées par |",
  "recommandations": "recommandations UNIQUEMENT issues des sources ci-dessus — sinon vide",
  "examens": "TOUS les examens UNIQUEMENT issus des sources ci-dessus, séparés par | — sinon vide",
  "medicaments_oms": "UNIQUEMENT les médicaments présents dans les sources ci-dessus avec dosage exact — sinon vide",
  "contre_indications": "contre-indications UNIQUEMENT issues des sources ci-dessus — sinon vide",
  "note_historique": "résumé historique pertinent pour le médecin, vide si aucun",
  "sources": "Copier EXACTEMENT le texte après [Source: ...] des sources utilisées — RIEN D'AUTRE — jamais de référence inventée"
}

MALADIES PRIORITAIRES AFRIQUE

Considère TOUJOURS en priorité : Paludisme, Typhoïde, Méningite bactérienne, Tuberculose, Trypanosomiase, Leishmaniose, Dengue, Choléra, Fièvre jaune, VIH/SIDA, Drépanocytose, Malnutrition sévère, Helminthiases, Onchocercose, Bilharziose, Mpox.

R�GLES ABSOLUES FINALES

- Une seule question à la fois en mode consultation
- Aucune analyse ni diagnostic pendant le questionnaire
- Le bloc ===MEDECIN=== uniquement dans le message final de la PHASE 4
- Ne jamais poser de diagnostic définitif
- Répondre toujours dans la langue du patient
- N'utilise JAMAIS tes connaissances générales — ni pour des dosages, ni pour des examens, ni pour des diagnostics, ni pour des protocoles, ni pour des recommandations, ni pour des sources
- Cite toujours la source EXACTE telle qu'elle apparaît dans [Source: ...]
- Ne jamais improviser un dosage, un protocole ou une source
- Si l'information n'est pas dans les sources → "Information non disponible dans la base documentaire Dokita"`;

    // 5. Appel Claude — avec retry automatique si erreur transitoire (429/529/réponse vide)
    const claudeBody = JSON.stringify({
      model: 'claude-sonnet-4-6',
      max_tokens: 1500,
      system: systemPrompt,
      messages: messages
    });
    const callClaude = async () => {
      const r = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'x-api-key': CLAUDE_KEY,
          'anthropic-version': '2023-06-01',
          'Content-Type': 'application/json'
        },
        body: claudeBody
      });
      const d = await r.json();
      return { status: r.status, data: d };
    };

    let claudeCall = await callClaude();
    let answer = claudeCall.data?.content?.[0]?.text || '';

    if (!answer) {
      console.log('Claude retry — status:', claudeCall.status, 'error:', claudeCall.data?.error?.message || 'réponse vide');
      await new Promise(resolve => setTimeout(resolve, 1000));
      claudeCall = await callClaude();
      answer = claudeCall.data?.content?.[0]?.text || '';
    }

    const claudeData = claudeCall.data;
    console.log('Claude status:', claudeCall.status, 'answerLen:', answer.length, 'error:', claudeData?.error?.message || 'none');

    return res.status(200).json({
      answer,
      chunks_used: chunks.length,
      debug: claudeData?.error || null
    });

  } catch (e) {
    console.error('RAG error:', e);
    return res.status(500).json({ error: e.message });
  }
}

module.exports = handler;
