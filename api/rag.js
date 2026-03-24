// /api/rag.js
// DOKITA — API RAG Supabase pgvector + Claude
// Remplace /api/relevance (Relevance AI)

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, x-dokita-key');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

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
    const lastMsg = messages[messages.length - 1].content || '';
    const isResume = lastMsg.trim() === 'RESUME_CONSULTATION';

    // --- Normalisation multilingue complète ---
    // Quelle que soit la langue du patient, on ramène chaque maladie
    // à un concept unique (clé normalisée) avant de chercher dans Supabase.
    // Règle : UNIQUEMENT des synonymes de maladies — JAMAIS de médicaments.
    // Si le protocole change demain → seul le Markdown change, pas ce code.
    //
    // Langues : FR EN AR PT ES RU | HA YO IG WO BM MO FO FF LN AM SO MG TW SN ZU SW

    const diseaseAliases = {

      // PALUDISME
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

      // TYPHOÏDE
      'typhoïde':'typhoide','typhoide':'typhoide','typhoid':'typhoide',
      'typhoid fever':'typhoide','fièvre typhoïde':'typhoide',
      'febre tifoide':'typhoide','fiebre tifoidea':'typhoide',
      'تيفوئيد':'typhoide','حمى التيفود':'typhoide','حمى تيفية':'typhoide',
      'тиф':'typhoide','брюшной тиф':'typhoide','zazzabin taifod':'typhoide',
      'iba taifoid':'typhoide','ịba taifọọdụ':'typhoide','suf u bunt':'typhoide',
      'fiievri tifoyid':'typhoide','homa ya matumbo':'typhoide',
      'የታይፎይድ ትኩሳት':'typhoide','xanuunka qandha':'typhoide',
      'taifiroyi':'typhoide','ithayifoyidi':'typhoide',

      // MÉNINGITE
      'méningite':'meningite','meningite':'meningite','meningitis':'meningite',
      'التهاب السحايا':'meningite','менингит':'meningite',
      'tiyariyyar kwakwalwa':'meningite','arun ọpọlọ':'meningite',
      'ọrịa ụbụbọ':'meningite','sutura':'meningite','kongotroni':'meningite',
      'ugonjwa wa ubongo':'meningite','meningitisi':'meningite',
      'የአንጎል ምች':'meningite','xanuunka maskaxda':'meningite',
      'aretina atidoha':'meningite','chirwere chepfungwa':'meningite',
      'isifo seningi':'meningite',

      // TUBERCULOSE
      'tuberculose':'tuberculose','tuberculosis':'tuberculose',
      'tb':'tuberculose','tbc':'tuberculose',
      'السل':'tuberculose','مرض السل':'tuberculose','туберкулёз':'tuberculose',
      'tarin fuka':'tuberculose','iko afẹfẹ':'tuberculose','ọrịa ụdọ':'tuberculose',
      'tub':'tuberculose','konofo':'tuberculose','tuberculoos':'tuberculose',
      'kifua kikuu':'tuberculose','tb ya mapafu':'tuberculose','ነቀርሳ':'tuberculose',
      'cudurka xabbada':'tuberculose','aretina tsaikomanga':'tuberculose',
      'chikwi':'tuberculose','isifo sofuba':'tuberculose',

      // VIH / SIDA
      'vih':'vih','hiv':'vih','sida':'vih','aids':'vih',
      'الإيدز':'vih','فيروس نقص المناعة':'vih','вич':'vih','спид':'vih',
      'kanjamau':'vih','arun kogboogun':'vih','ọrịa eidos':'vih',
      'ukimwi':'vih','virusi vya ukimwi':'vih','ኤድስ':'vih',
      'cudurka aids':'vih','aretina sida':'vih','ingculazi':'vih',
      'isifo sengculazi':'vih',

      // DENGUE
      'dengue':'dengue','dengue fever':'dengue',
      'حمى الضنك':'dengue','денге':'dengue',
      'zazzabin dengue':'dengue','iba dengue':'dengue','ọrịa dengue':'dengue',
      'homa ya dengue':'dengue','ዴንጊ ትኩሳት':'dengue','xanuunka dengue':'dengue',

      // CHOLÉRA
      'choléra':'cholera','cholera':'cholera','cólera':'cholera',
      'كوليرا':'cholera','холера':'cholera','kwalara':'cholera','kolera':'cholera',
      'kipindupindu':'cholera','ኮሌራ':'cholera','koleeraha':'cholera',
      'koléra':'cholera','korera':'cholera','ikolera':'cholera',

      // PNEUMONIE
      'pneumonie':'pneumonie','pneumonia':'pneumonie',
      'الالتهاب الرئوي':'pneumonie','пневмония':'pneumonie',
      'ciwon huhu':'pneumonie','àrùn ẹ̀dọ̀fóró':'pneumonie','ọrịa ume':'pneumonie',
      'pisin':'pneumonie','bolo fali':'pneumonie','hawre':'pneumonie',
      'nimonia':'pneumonie','homa ya mapafu':'pneumonie','ሳምባ ምች':'pneumonie',
      'waxar sambabka':'pneumonie','aretina tsofina':'pneumonie',
      'chirwere chepahapwa':'pneumonie','umkhuhlane wamaphaphu':'pneumonie',

      // DIARRHÉE
      'diarrhée':'diarrhee','diarrhee':'diarrhee','diarrhea':'diarrhee',
      'selles liquides':'diarrhee','إسهال':'diarrhee','диарея':'diarrhee',
      'zawo':'diarrhee','igbe gbuuru':'diarrhee','afọ ọsịsa':'diarrhee',
      'janax':'diarrhee','kononi':'diarrhee','konone':'diarrhee',
      'asididi':'diarrhee','jowitaari':'diarrhee','diarée':'diarrhee',
      'kuhara':'diarrhee','tumbo la kuhara':'diarrhee','ተቅማጥ':'diarrhee',
      'gudaha socod':'diarrhee','aretina kifo':'diarrhee','ayamtuo':'diarrhee',
      'uhudo':'diarrhee',

      // ROUGEOLE
      'rougeole':'rougeole','measles':'rougeole','sarampo':'rougeole',
      'الحصبة':'rougeole','корь':'rougeole','kyandakwi':'rougeole',
      'ìgbẹ̀rẹ̀':'rougeole','odida':'rougeole','ronzél':'rougeole',
      'wolobali':'rougeole','cuddagel':'rougeole','roujeol':'rougeole',
      'surua':'rougeole','homa ya surua':'rougeole','ኩፍኝ':'rougeole',
      'jadeecada':'rougeole','rotilaina':'rougeole','isigcefe':'rougeole',

      // TÉTANOS
      'tétanos':'tetanos','tetanos':'tetanos','tetanus':'tetanos',
      'الكزاز':'tetanos','столбняк':'tetanos','haukan inna':'tetanos',
      'tetanosi':'tetanos','tetanọs':'tetanos','tetanis':'tetanos',
      'tetanose':'tetanos','pepopunda':'tetanos','ቴታነስ':'tetanos',
      'tetanôsy':'tetanos','itetanasi':'tetanos',

      // MPOX
      'mpox':'mpox','monkeypox':'mpox','variole du singe':'mpox',
      'جدري القردة':'mpox','оспа обезьян':'mpox','agwagwa biri':'mpox',
      'adie obo':'mpox','ọrịa enwe':'mpox','ndui ya nyani':'mpox',

      // CONVULSIONS
      'convulsion':'convulsion','convulsions':'convulsion','seizure':'convulsion',
      'fit':'convulsion','crise':'convulsion',
      'تشنج':'convulsion','судороги':'convulsion','farfaɗo':'convulsion',
      'warapa':'convulsion','mgbu ọgwụgwọ':'convulsion','mujjur':'convulsion',
      'falen':'convulsion','konvulsiyon':'convulsion','mboɗi':'convulsion',
      'kifafa':'convulsion','mshtuko':'convulsion','ናዕዛዝ':'convulsion',
      'qabqabsi':'convulsion','hivaivana':'convulsion','kujamba':'convulsion',
      'isifo sokuwa':'convulsion',

      // ÉPILEPSIE
      'épilepsie':'epilepsie','epilepsie':'epilepsie','epilepsy':'epilepsie',
      'الصرع':'epilepsie','эпилепсия':'epilepsie',
      'farfaɗo na dindindin':'epilepsie','ọrịa ntutu':'epilepsie',
      'yëgël':'epilepsie','sanga':'epilepsie','epilepsi':'epilepsie',
      'ሚጢጢ':'epilepsie','xanuunka faraqa':'epilepsie','epilepsia':'epilepsie',
      'isifo samahlalela':'epilepsie',

      // MALNUTRITION
      'malnutrition':'malnutrition','malnutrición':'malnutrition',
      'desnutrição':'malnutrition','سوء التغذية':'malnutrition',
      'недоедание':'malnutrition','yunwa':'malnutrition','àìjẹun':'malnutrition',
      'agụụ ọjọọ':'malnutrition','gàññaar':'malnutrition','kɔngɔ':'malnutrition',
      'malnutrisyon':'malnutrition','baaɗtaare':'malnutrition',
      'utapiamlo':'malnutrition','kukosa chakula':'malnutrition',
      'ምግብ እጥረት':'malnutrition','gaajada':'malnutrition',
      'tsy ampy sakafo':'malnutrition','kushayiwa kudya':'malnutrition',
      'ukusweleka':'malnutrition',

      // DIABÈTE
      'diabète':'diabete','diabete':'diabete','diabetes':'diabete',
      'السكري':'diabete','диабет':'diabete','ciwon sukari':'diabete',
      'àtọ̀gbẹ̀':'diabete','ọrịa shuga':'diabete','sukar':'diabete',
      'sukari bana':'diabete','sukariijo':'diabete','kisukari':'diabete',
      'ugonjwa wa sukari':'diabete','የስኳር ህመም':'diabete',
      'xanuunka sonkorta':'diabete','tsiriky':'diabete',
      'chirwere cheshuga':'diabete','isifo sikashukela':'diabete',

      // HYPERTENSION
      'hypertension':'hypertension','tension':'hypertension','pression':'hypertension',
      'high blood pressure':'hypertension','ارتفاع ضغط الدم':'hypertension',
      'гипертония':'hypertension','matsincin jini':'hypertension',
      'titẹ ẹjẹ giga':'hypertension','ọbara ọbara':'hypertension',
      'tension bu dëkk':'hypertension','joli tigui':'hypertension',
      'shinikizo la damu':'hypertension','presha ya juu':'hypertension',
      'የደም ግፊት':'hypertension','cadaadiska dhiigga':'hypertension',
      'tsindry rà':'hypertension','kudzvanyidzwa':'hypertension',
      'isifo somfutho wegazi':'hypertension',

      // ÉTAT DE CHOC
      'choc':'choc','shock':'choc','état de choc':'choc','collapse':'choc',
      'mshtuko wa damu':'choc','صدمة':'choc','шок':'choc',

      // FIÈVRE (générique)
      'fièvre':'fievre','fievre':'fievre','fever':'fievre','homa':'fievre',
      'حمى':'fievre','lихорадка':'fievre','zazzabi':'fievre','iba':'fievre',

      // HYPOGLYCÉMIE
      'hypoglycémie':'hypoglycemie','hypoglycemie':'hypoglycemie',
      'hypoglycemia':'hypoglycemie','low blood sugar':'hypoglycemie',
      'sukari chini':'hypoglycemie','انخفاض السكر':'hypoglycemie',

      // ANÉMIE
      'anémie':'anemie','anemie':'anemie','anemia':'anemie',
      'فقر الدم':'anemie','анемия':'anemie','anemi':'anemie',
      'damu chache':'anemie','paleness':'anemie','pâleur':'anemie',

      // DÉSHYDRATATION
      'déshydratation':'deshydratation','deshydratation':'deshydratation',
      'dehydration':'deshydratation','upungufu wa maji':'deshydratation',
      'جفاف':'deshydratation','обезвоживание':'deshydratation',

      // ANGINE / PHARYNGITE
      'angine':'angine','pharyngite':'angine','tonsillitis':'angine',
      'sore throat':'angine','mal de gorge':'angine','التهاب الحلق':'angine',
      'тонзиллит':'angine','maumivu ya koo':'angine','ciwon makogwaro':'angine',

      // DIPHTÉRIE
      'diphtérie':'diphterie','diphterie':'diphterie','diphtheria':'diphterie',
      'الدفتيريا':'diphterie','дифтерия':'diphterie',

      // CROUP
      'croup':'croup','laryngite':'croup','laryngotrachéite':'croup',
      'toux aboyante':'croup','barking cough':'croup',

      // COQUELUCHE
      'coqueluche':'coqueluche','whooping cough':'coqueluche','pertussis':'coqueluche',
      'السعال الديكي':'coqueluche','коклюш':'coqueluche','kikohozi cha mvua':'coqueluche',

      // BRONCHIOLITE
      'bronchiolite':'bronchiolite','bronchiolitis':'bronchiolite',
      'التهاب القصيبات':'bronchiolite','бронхиолит':'bronchiolite',

      // ASTHME
      'asthme':'asthme','asthma':'asthme','pumu':'asthme',
      'الربو':'asthme','астма':'asthme','pumzi':'asthme',
      'ikọ́ oyún':'asthme','ọrịa ume':'asthme',

      // GALE
      'gale':'gale','scabies':'gale','mange':'gale',
      'الجرب':'gale','чесотка':'gale','upele':'gale','kikwazo':'gale',

      // IMPÉTIGO
      'impétigo':'impetigo','impetigo':'impetigo',
      'التقيح':'impetigo','импетиго':'impetigo',

      // ÉRYSIPÈLE / CELLULITE
      'érysipèle':'erysipele','erysipele':'erysipele','cellulite':'erysipele',
      'erysipelas':'erysipele','التهاب النسيج':'erysipele',

      // ANAPHYLAXIE / URTICAIRE
      'anaphylaxie':'anaphylaxie','anaphylaxis':'anaphylaxie',
      'urticaire':'anaphylaxie','hives':'anaphylaxie','allergie sévère':'anaphylaxie',
      'الحساسية الشديدة':'anaphylaxie','анафилаксия':'anaphylaxie',

      // CHARBON
      'charbon':'charbon','anthrax':'charbon','الجمرة الخبيثة':'charbon',

      // AMIBIASE
      'amibiase':'amibiase','amebiasis':'amibiase','amoeba':'amibiase',
      'abcès amibien':'amibiase','داء الأميبا':'amibiase','амёбиаз':'amibiase',

      // GIARDIASE
      'giardiase':'giardiase','giardiasis':'giardiase','giardia':'giardiase',
      'داء الجيارديا':'giardiase',

      // BRUCELLOSE
      'brucellose':'brucellose','brucellosis':'brucellose','fièvre de Malte':'brucellose',
      'البروسيلا':'brucellose','бруцеллёз':'brucellose',

      // LEPTOSPIROSE
      'leptospirose':'leptospirose','leptospirosis':'leptospirose',
      'البريميات':'leptospirose','лептоспироз':'leptospirose',

      // RICKETTSIOSES
      'rickettsiose':'rickettsiose','typhus':'rickettsiose','fièvre boutonneuse':'rickettsiose',
      'rickettsial':'rickettsiose','الريكيتسيا':'rickettsiose',

      // FIÈVRES RÉCURRENTES
      'fièvre récurrente':'fievres_recurrentes','relapsing fever':'fievres_recurrentes',
      'borréliose':'fievres_recurrentes',

      // TRYPANOSOMIASE
      'trypanosomiase':'trypanosomiase','sleeping sickness':'trypanosomiase',
      'maladie du sommeil':'trypanosomiase','ugonjwa wa usingizi':'trypanosomiase',
      'داء النوم':'trypanosomiase',

      // LEISHMANIOSE
      'leishmaniose':'leishmaniose','leishmaniasis':'leishmaniose','kala-azar':'leishmaniose',
      'داء الليشمانيات':'leishmaniose','лейшманиоз':'leishmaniose',

      // SCHISTOSOMIASE
      'schistosomiase':'schistosomiase','bilharziose':'schistosomiase',
      'schistosomiasis':'schistosomiase','bilharzia':'schistosomiase',
      'البلهارسيا':'schistosomiase','kichocho':'schistosomiase',

      // FILARIOSE
      'filariose':'filariose','onchocercose':'filariose','cécité des rivières':'filariose',
      'elephantiasis':'filariose','loase':'filariose','river blindness':'filariose',
      'داء الفيلاريات':'filariose',

      // HÉPATITE
      'hépatite':'hepatite','hepatite':'hepatite','hepatitis':'hepatite',
      'ictère':'hepatite','jaunisse':'hepatite','التهاب الكبد':'hepatite',
      'гепатит':'hepatite','homa ya ini':'hepatite','ugonjwa wa ini':'hepatite',

      // CYSTITE / INFECTION URINAIRE
      'cystite':'cystite','infection urinaire':'cystite','urinary tract infection':'cystite',
      'uti':'cystite','التهاب المثانة':'cystite','цистит':'cystite',
      'maumivu ya mkojo':'cystite',

      // IST GÉNÉRIQUES
      'ist':'ist','sti':'ist','mst':'ist','infection sexuelle':'ist',
      'ecoulement':'ist','écoulement':'ist','discharge':'ist',
      'الأمراض المنقولة جنسياً':'ist','مرض جنسي':'ist',

      // SYPHILIS / ULCÉRATION GÉNITALE
      'syphilis':'syphilis','chancre':'syphilis','ulcération génitale':'syphilis',
      'الزهري':'syphilis','сифилис':'syphilis','kaswende':'syphilis',

      // IGH
      'salpingite':'igh','infections génitales hautes':'igh','pid':'igh',
      'pelvic inflammatory disease':'igh',

      // BRÛLURES
      'brûlure':'brulure','brulure':'brulure','burn':'brulure',
      'mchomo':'brulure','حرق':'brulure','ожог':'brulure',

      // DÉPRESSION
      'dépression':'depression','depression':'depression',
      'الاكتئاب':'depression','депрессия':'depression','huzuni':'depression',

      // PSYCHOSE / TROUBLES BIPOLAIRES
      'psychose':'psychose','schizophrénie':'psychose','troubles bipolaires':'psychose',
      'manie':'psychose','psychosis':'psychose','الذهان':'psychose',
      'ugonjwa wa akili':'psychose',

      // ANXIÉTÉ / PTSD
      'anxiété':'anxiete','anxiete':'anxiete','anxiety':'anxiete',
      'ptsd':'anxiete','stress post-traumatique':'anxiete','insomnie':'anxiete',
      'القلق':'anxiete','тревога':'anxiete',

      // INSUFFISANCE CARDIAQUE
      'insuffisance cardiaque':'icc','oap':'icc','œdème pulmonaire':'icc',
      'heart failure':'icc','فشل القلب':'icc','сердечная недостаточность':'icc',

      // DRÉPANOCYTOSE
      'drépanocytose':'drepanocytose','sickle cell':'drepanocytose',
      'anémie falciforme':'drepanocytose','مرض الخلايا المنجلية':'drepanocytose',
      'ugonjwa wa seli mundu':'drepanocytose','isifo samagadi':'drepanocytose',

      // MALNUTRITION (déjà présent mais enrichi)
      'kwashiorkor':'malnutrition','marasme':'malnutrition','mas':'malnutrition',
      'mam':'malnutrition','stunting':'malnutrition',

      // OTITE
      'otite':'otite','ear infection':'otite','otalgie':'otite',
      'mal d\'oreille':'otite','التهاب الأذن':'otite','уши болят':'otite',
      'maumivu ya sikio':'otite',

      // MUGUET / CANDIDOSE
      'muguet':'muguet','candidose':'muguet','thrush':'muguet',
      'candida':'muguet','القلاع':'muguet','кандидоз':'muguet',

      // NÉONATAL
      'sepsis néonatal':'neonatal','infection néonatale':'neonatal',
      'nouveau-né malade':'neonatal','neonatal infection':'neonatal',

      // VIOLENCES SEXUELLES
      'violences sexuelles':'violences_sex','viol':'violences_sex','agression':'violences_sex',
      'sexual violence':'violences_sex','rape':'violences_sex',
      'post-exposition':'violences_sex','pep':'violences_sex',

      // CONTRACEPTION
      'contraception':'contraception','pilule':'contraception','contraceptif':'contraception',
      'planning familial':'contraception','family planning':'contraception',
      'diu':'contraception','stérilet':'contraception','injectable':'contraception',

      // VACCINATION
      'vaccin':'vaccination','vaccination':'vaccination','vaccine':'vaccination',
      'pev':'vaccination','immunisation':'vaccination','تطعيم':'vaccination',
      'chanjo':'vaccination',

      // LITHIASE
      'colique néphrétique':'lithiase','calcul rénal':'lithiase','pierre rein':'lithiase',
      'kidney stone':'lithiase','urolithiasis':'lithiase','حصوات الكلى':'lithiase',

      // DYSPEPSIE / GASTRITE
      'gastrite':'dyspepsie','rgo':'dyspepsie','ulcère':'dyspepsie',
      'brûlures estomac':'dyspepsie','gastritis':'dyspepsie','reflux':'dyspepsie',
      'h pylori':'dyspepsie','التهاب المعدة':'dyspepsie',

    };

    // Queries Supabase — maladie + contexte UNIQUEMENT, JAMAIS le nom du médicament.
    // Règle : si le protocole change demain → seul le Markdown change, pas ce code.
    const diagQueries = {
      // Maladies infectieuses tropicales prioritaires
      'paludisme':          'paludisme simple traitement dosage poids kg comprimés protocole national Côte d\'Ivoire',
      'typhoide':           'fièvre typhoïde traitement dosage adulte enfant ambulatoire hospitalisation',
      'meningite':          'méningite bactérienne traitement dosage pédiatrique adulte mg/kg hospitalisation',
      'tuberculose':        'tuberculose traitement dosage poids comprimés phase intensive continuation',
      'vih':                'VIH traitement antirétroviral ARV schéma adulte enfant première ligne',
      'dengue':             'dengue traitement prise en charge symptomatique réhydratation groupes',
      'cholera':            'choléra traitement réhydratation SRO antibiotiques dosage',
      'mpox':               'mpox traitement prise en charge symptomatique isolement',
      'rougeole':           'rougeole traitement vitamine A dosage complications surinfection',
      'tetanos':            'tétanos traitement dosage hospitalisation spasmes immunoglobuline',
      'brucellose':         'brucellose traitement dosage durée antibiotiques',
      'leptospirose':       'leptospirose traitement dosage forme légère sévère',
      'rickettsiose':       'rickettsiose typhus traitement dosage antibiotiques',
      'fievres_recurrentes':'fièvres récurrentes borréliose traitement dosage',
      'trypanosomiase':     'trypanosomiase maladie du sommeil traitement dosage stade',
      'leishmaniose':       'leishmaniose traitement dosage forme cutanée viscérale',
      'schistosomiase':     'schistosomiase bilharziose traitement dosage',
      'filariose':          'filariose onchocercose traitement dosage annuel',
      // Pathologie respiratoire
      'pneumonie':          'pneumonie traitement dosage pédiatrique adulte mg/kg ambulatoire hospitalisation',
      'angine':             'angine pharyngite traitement dosage antibiotiques durée',
      'diphterie':          'diphtérie traitement dosage sérum antidiphtérique antibiotiques',
      'croup':              'croup laryngotrachéite traitement dosage corticoïdes urgence',
      'coqueluche':         'coqueluche traitement dosage nourrisson enfant adulte durée',
      'bronchiolite':       'bronchiolite traitement dosage nourrisson oxygène',
      'asthme':             'asthme traitement dosage crise chronique corticoïdes bronchodilatateurs',
      // Pathologie digestive
      'diarrhee':           'diarrhée aiguë traitement réhydratation SRO zinc dosage enfant plan A B C',
      'amibiase':           'amibiase traitement dosage adulte enfant durée',
      'giardiase':          'giardiase traitement dosage durée',
      'dyspepsie':          'troubles dyspeptiques gastrite RGO traitement dosage durée',
      // Pathologie dermatologique
      'gale':               'gale traitement dosage poids applications temps contact',
      'impetigo':           'impétigo traitement dosage local oral durée',
      'erysipele':          'érysipèle cellulite traitement dosage durée',
      'anaphylaxie':        'anaphylaxie urticaire traitement dosage urgence',
      'charbon':            'charbon anthrax traitement dosage durée antibiotiques',
      // Symptômes généraux / urgences
      'choc':               'état de choc traitement dosage réhydratation urgence type',
      'fievre':             'fièvre traitement dosage causes infectieuses Afrique',
      'hypoglycemie':       'hypoglycémie traitement dosage glucose correction urgence',
      'anemie':             'anémie traitement dosage fer transfusion seuils hémoglobine',
      'deshydratation':     'déshydratation traitement réhydratation SRO plan A B C dosage',
      'convulsion':         'convulsions traitement dosage poids urgence étapes',
      // IST / Urologie / Gynéco
      'ist':                'infections sexuellement transmissibles traitement dosage syndromique',
      'syphilis':           'syphilis ulcération génitale traitement dosage pénicilline durée',
      'cystite':            'cystite infection urinaire traitement dosage durée',
      'brulure':            'brûlures traitement dosage réhydratation analgésie soins locaux',
      'igh':                'infections génitales hautes salpingite traitement dosage durée',
      'lithiase':           'lithiase urinaire colique néphrétique traitement dosage antalgiques',
      'contraception':      'contraception pilule injectable DIU posologie',
      'violences_sex':      'violences sexuelles prophylaxie post-exposition traitement dosage IST ARV',
      // Maladies chroniques
      'diabete':            'diabète type 2 traitement dosage glycémie étapes monothérapie bithérapie',
      'hypertension':       'hypertension artérielle traitement dosage objectifs tensionnels',
      'drepanocytose':      'drépanocytose traitement dosage crise antalgiques prévention',
      'epilepsie':          'épilepsie traitement dosage entretien long terme antiépileptiques',
      'icc':                'insuffisance cardiaque OAP traitement dosage urgence diurétiques',
      // Psychiatrie
      'depression':         'dépression traitement dosage antidépresseurs durée',
      'psychose':           'psychose troubles bipolaires traitement dosage antipsychotiques',
      'anxiete':            'anxiété insomnie PTSD traitement dosage',
      // Pédiatrie / Néonatal
      'malnutrition':       'malnutrition aiguë sévère MAS traitement phases nutritionnel médical vitamine',
      'otite':              'otite moyenne aiguë traitement dosage enfant antibiotiques durée',
      'muguet':             'muguet candidose orale traitement dosage nourrisson enfant adulte',
      'neonatal':           'infections néonatales traitement dosage nourrisson antibiotiques',
      // Autres
      'hepatite':           'hépatite virale traitement dosage symptomatique chronique',
      'vaccination':        'vaccination calendrier PEV enfant Côte d\'Ivoire doses',
      'sclerose':           'paludisme traitement dosage poids kg comprimés protocole',
    };

    // Construire la requête de recherche
    let searchQuery = lastMsg.slice(0, 8000);
    let normalizedDisease = null; // déclaré ici pour être accessible dans tout le handler

    if (isResume) {
      // ── DÉTECTION DEPUIS SUSPICIONS DIAGNOSTIQUES ──
      // Parse le bloc structuré généré par Dr. AfriBot :
      // "[Maladie] — Probabilité : ⬛⬛⬛⬛⬛ Très élevée"
      // Plus fiable que chercher dans le texte libre (évite faux positifs)

      const lastAssistantMsg = [...messages]
        .reverse()
        .find(m => m.role === 'assistant');
      const diagText = (lastAssistantMsg?.content || '');
      const convText = messages.map(m => m.content || '').join(' ').toLowerCase();

      // Étape 1 : parser le bloc SUSPICIONS DIAGNOSTIQUES
      // Format exact du prompt Dr. AfriBot
      let suspicions = []; // [{maladie, probabilite, concept}]

      const suspicionRegex = /\[([^\]]+)\]\s*[—–-]\s*Probabilité\s*:\s*[⬛⬜◼◻█░]+\s*(Très élevée|Élevée|Modérée|Faible)/gi;
      let match;
      while ((match = suspicionRegex.exec(diagText)) !== null) {
        const maladieBrute = match[1].toLowerCase().trim();
        const probabilite  = match[2].trim();
        // Normaliser via diseaseAliases
        let concept = null;
        for (const [alias, c] of Object.entries(diseaseAliases)) {
          if (maladieBrute.includes(alias.toLowerCase())) {
            concept = c;
            break;
          }
        }
        if (concept) {
          suspicions.push({ maladie: match[1].trim(), probabilite, concept });
        }
      }

      // Étape 2 : fallback si SUSPICIONS non parsées (message court, format inattendu)
      if (suspicions.length === 0) {
        // Chercher dans le texte du dernier message assistant
        for (const [alias, concept] of Object.entries(diseaseAliases)) {
          if (diagText.toLowerCase().includes(alias.toLowerCase())) {
            suspicions.push({ maladie: alias, probabilite: 'Élevée', concept });
            if (suspicions.length >= 2) break;
          }
        }
      }
      // Dernier fallback : chercher dans toute la conversation
      if (suspicions.length === 0) {
        for (const [alias, concept] of Object.entries(diseaseAliases)) {
          if (convText.includes(alias.toLowerCase())) {
            suspicions.push({ maladie: alias, probabilite: 'Élevée', concept });
            if (suspicions.length >= 2) break;
          }
        }
      }

      // Garder max 2 suspicions (les 2 plus probables)
      suspicions = suspicions.slice(0, 2);

      // Rétrocompatibilité : normalizedDisease = première suspicion
      normalizedDisease = suspicions[0]?.concept || null;

      console.log('RESUME — suspicions parsées:', suspicions.map(s => s.concept + '(' + s.probabilite + ')').join(' | ') || 'aucune');

      // Étape 3 : query sémantique = première suspicion (la plus probable)
      let diagQuery = 'maladie tropicale traitement dosage Afrique protocole';
      if (normalizedDisease && diagQueries[normalizedDisease]) {
        diagQuery = diagQueries[normalizedDisease];
      }

      searchQuery = diagQuery;
      console.log('RESUME — concept normalisé:', normalizedDisease, '| query:', searchQuery);

      // Stocker les suspicions pour l'Appel 2 multi-Markdowns
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
    console.log('Embedding OK:', !!embedding, embData?.error?.message || '');

    // 2. Recherche Supabase pgvector
    let chunks = [];
    if (embedding) {
      const matchCount = isResume ? 10 : 5;
      const searchRes = await fetch(`${SUPABASE_URL}/rest/v1/rpc/search_medical`, {
        method: 'POST',
        headers: {
          'apikey': SUPABASE_KEY,
          'Authorization': `Bearer ${SUPABASE_KEY}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ query_embedding: embedding, match_count: matchCount })
      });
      chunks = await searchRes.json();
      if (!Array.isArray(chunks)) chunks = [];
      console.log('Chunks sémantiques:', chunks.length, 'isResume:', isResume);

      // LOGIQUE MULTI-MARKDOWNS — Pour RESUME_CONSULTATION uniquement
      // Appel 2 : récupère TOUS les Markdowns Dokita liés à la maladie détectée
      // Garantit que AL + ASAQ + paludisme_severe + femme_enceinte remontent tous ensemble
      if (isResume && normalizedDisease) {

        // Mapping concept → mots-clés de recherche dans le nom de fichier Supabase
        const diseaseFileKeywords = {
          'paludisme':          'paludisme',
          'typhoide':           'typhoide',
          'meningite':          'meningite',
          'tuberculose':        'tuberculose',
          'vih':                'VIH',
          'dengue':             'dengue',
          'cholera':            'cholera',
          'mpox':               'mpox',
          'rougeole':           'rougeole',
          'tetanos':            'tetanos',
          'brucellose':         'brucellose',
          'leptospirose':       'leptospirose',
          'rickettsiose':       'rickettsioses',
          'fievres_recurrentes':'fievres_recurrentes',
          'trypanosomiase':     'trypanosomiase',
          'leishmaniose':       'leishmaniose',
          'schistosomiase':     'schistosomiase',
          'filariose':          'filariose',
          'pneumonie':          'pneumonie',
          'angine':             'angine',
          'diphterie':          'diphterie',
          'croup':              'croup',
          'coqueluche':         'coqueluche',
          'bronchiolite':       'bronchiolite',
          'asthme':             'asthme',
          'diarrhee':           'diarrhee',
          'amibiase':           'amibiase',
          'giardiase':          'giardiase',
          'dyspepsie':          'dyspeptiques',
          'gale':               'gale',
          'impetigo':           'impetigo',
          'erysipele':          'erysipele',
          'anaphylaxie':        'anaphylaxie',
          'charbon':            'charbon',
          'choc':               'choc',
          'fievre':             'fievre',
          'hypoglycemie':       'hypoglycemie',
          'anemie':             'anemie',
          'deshydratation':     'deshydratation',
          'convulsion':         'convulsions',
          'ist':                'IST',
          'syphilis':           'syphilis',
          'cystite':            'cystite',
          'brulure':            'brulures',
          'igh':                'IGH',
          'lithiase':           'lithiase',
          'contraception':      'contraception',
          'violences_sex':      'violences',
          'diabete':            'diabete',
          'hypertension':       'HTA',
          'drepanocytose':      'drepanocytose',
          'epilepsie':          'epilepsie',
          'icc':                'cardiaque',
          'depression':         'depression',
          'psychose':           'psychose',
          'anxiete':            'anxiete',
          'malnutrition':       'malnutrition',
          'otite':              'otite',
          'muguet':             'muguet',
          'neonatal':           'neonat',
          'hepatite':           'hepatites',
          'vaccination':        'vaccination',
          'rougeole_enfant':    'rougeole',
        };

        // ── APPEL 2 MULTI-MARKDOWNS ──
        // Une query par suspicion (max 2) en parallèle
        // → Typhoïde : tous les Markdowns typhoïde
        // → Paludisme : tous les Markdowns paludisme
        // Fusion : suspicion 1 en tête, suspicion 2 ensuite, sémantique complète

        const suspicionsToFetch = req._suspicions || (normalizedDisease ? [{concept: normalizedDisease}] : []);

        const fetchMarkdownsForDisease = async (concept) => {
          const fileKeyword = diseaseFileKeywords[concept];
          if (!fileKeyword) return [];
          const url = `${SUPABASE_URL}/rest/v1/medical_documents?source=ilike.*${encodeURIComponent(fileKeyword)}*&source=ilike.*Dokita*&select=id,content,source`;
          const res = await fetch(url, {
            headers: {
              'apikey': SUPABASE_KEY,
              'Authorization': `Bearer ${SUPABASE_KEY}`,
              'Content-Type': 'application/json'
            }
          });
          let result = await res.json();
          if (!Array.isArray(result)) result = [];
          result = result.filter(c => c.source && c.source.includes('Dokita Dosages'));
          console.log(`Multi-Markdowns "${fileKeyword}" (${concept}): ${result.length} chunks directs`);
          return result;
        };

        // Queries en parallèle pour toutes les suspicions
        const allDirectChunks = await Promise.all(
          suspicionsToFetch.map(s => fetchMarkdownsForDisease(s.concept))
        );

        // Fusion : suspicion 1 en tête, suspicion 2 ensuite, sans doublons
        const seenIds = new Set();
        let directChunksMerged = [];
        for (const chunkList of allDirectChunks) {
          for (const c of chunkList) {
            if (!seenIds.has(c.id)) {
              seenIds.add(c.id);
              directChunksMerged.push(c);
            }
          }
        }

        // Ajouter chunks sémantiques sans doublons
        const semanticOnly = chunks.filter(c => !seenIds.has(c.id));
        chunks = [...directChunksMerged, ...semanticOnly];
      }

      // Markdowns Dokita toujours en tête (sécurité)
      const dokitaChunks = chunks.filter(c => c.source && c.source.includes('Dokita Dosages'));
      const otherChunks  = chunks.filter(c => !c.source || !c.source.includes('Dokita Dosages'));
      chunks = [...dokitaChunks, ...otherChunks];
      console.log('Final — Dokita:', dokitaChunks.length, '| Autres:', otherChunks.length, '| Total:', chunks.length);
    }

    // 3. Contexte médical
    const contexteMedial = chunks.length > 0
      ? chunks.map(c => `[Source: ${c.source}]\n${c.content}`).join('\n\n---\n\n')
      : 'Aucune source médicale trouvée pour cette requête.';

    // 4. Prompt validé — copie exacte du prompt Relevance AI
    const systemPrompt = `SOURCES AUTORISÉES

Les guidelines médicales OMS/MSF suivantes ont été trouvées pour cette consultation :

${contexteMedial}

→ Ces sources sont ton UNIQUE référence médicale
→ N'utilise JAMAIS tes connaissances générales pour des dosages
→ Les sources "Dokita Dosages Référence" contiennent les tableaux de dosages validés par poids — elles sont PRIORITAIRES sur toute autre source
→ Cite toujours la source exacte utilisée

📚 SOURCES : [nom du document MSF/OMS trouvé dans les sources ci-dessus]

LANGUE

Réponds TOUJOURS dans la même langue que le patient.

GOAL

Tu es Dr. AfriBot, un assistant médical conversationnel spécialisé dans les maladies africaines et tropicales, conçu pour :

Guider les patients étape par étape

Orienter vers un diagnostic probable basé sur les symptômes

Recommander le médecin le plus adapté

Tu raisonnes comme un médecin expérimenté formé en Afrique subsaharienne, rigoureux, prudent et structuré.

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

⚠️ RÈGLE ABSOLUE : N'utilise JAMAIS de termes alarmants dans les questions : pas de "urgence", "danger", "critique", "absolue", "crucial", "immédiat" ou tout terme anxiogène.

Format de chaque question :

[Question simple et directe]

[Une phrase courte expliquant pourquoi tu poses cette question, sans termes alarmants]

Questions à poser uniquement si non déjà répondues, dans cet ordre :

"Depuis combien de temps avez-vous ce symptôme ?"

"Comment évaluez-vous l'intensité ? (légère / modérée / sévère)"

"Avez-vous de la fièvre ? Si oui, avez-vous pu la mesurer ?"

"Avez-vous d'autres symptômes associés ?"

"Quel est votre âge et votre sexe ?"

"Dans quelle ville ou région vous trouvez-vous ?"

"Avez-vous voyagé récemment dans une zone à risque ?"

"Avez-vous déjà pris des médicaments pour ce problème ?"

"Avez-vous des maladies chroniques connues ?"

"Êtes-vous enceinte ou allaitante ? (si applicable)"

PHASE 3 — DÉCLENCHEMENT DE L'ANALYSE

Déclenche la PHASE 4 uniquement quand tu as obtenu au minimum ces 5 informations :

Durée des symptômes

Intensité

Symptômes associés

Localisation géographique

Antécédents / médicaments en cours

Si ces 5 informations sont toutes présentes dès le premier message, passe directement à la PHASE 4 sans poser de questions.

PHASE 4 — RÉPONSE FINALE

⚠️ RÈGLE ABSOLUE : Affiche UNIQUEMENT ce format exact, sans rien ajouter avant ou après.

⚠️ RÈGLE ABSOLUE : N'affiche JAMAIS dans la conversation : EXAMENS RECOMMANDÉS, SIGNES D'ALERTE, ORIENTATION RECOMMANDÉE, TRAITEMENT OMS RECOMMANDÉ. Ces données sont réservées à l'export Notion via RESUME_CONSULTATION.

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

[conseils pratiques adaptés au contexte africain, sans termes alarmants]

⚠️ RÈGLE ABSOLUE : Ne jamais mentionner de médicaments dans cette section, même le paracétamol. Uniquement des conseils pratiques : hydratation, repos, surveillance.

📚 SOURCES OMS UTILISÉES :

[nom du document MSF/OMS trouvé dans les sources]

⚕️ RAPPEL : Cette analyse est un outil d'aide à la décision. Seul un médecin peut poser un diagnostic définitif après examen clinique.

===MEDECIN===

NOM: [nom complet du médecin — utilise la BDD médecins Notion]

SPEC: [spécialité]

TEL: [téléphone]

EMAIL: [adresse email exacte]

NOTE: [note sur 5]

TARIF: [tarif en chiffres seulement]

DEVISE: [devise]

===FIN===

Si aucun médecin trouvé :

===MEDECIN===

NOM: aucun

===FIN===

RÈGLE SPÉCIALE — RESUME_CONSULTATION

Si le message reçu est exactement "RESUME_CONSULTATION" :

Utilise les sources médicales fournies en début de prompt pour remplir "medicaments_oms" et "examens" avec les données OMS/MSF exactes

Réponds UNIQUEMENT avec le JSON valide ci-dessous (sans markdown, sans texte avant ou après)

{
  "nom": "prénom et nom du patient mentionnés dans la conversation",
  "age": "âge en chiffres seulement",
  "poids": "poids en kg, chiffres seulement",
  "ville": "ville mentionnée",
  "voyage": "voyage ou zone mentionnés, sinon Aucun",
  "symptomes": "résumé des symptômes décrits par le patient",
  "diagnostic": "diagnostic principal avec probabilité",
  "recommandations": "recommandations OMS synthétiques examens et orientation",
  "examens": "examens recommandés par OMS avec disponibilité locale",
  "medicaments_oms": "médicament 1ère intention OMS — dosage exact — durée | médicament 2ème intention — dosage — durée",
  "contre_indications": "contre-indications et précautions selon profil patient",
  "sources": "nom du document MSF/OMS trouvé dans les sources"
}

MALADIES PRIORITAIRES AFRIQUE

Considère TOUJOURS ces pathologies en priorité : Paludisme, Typhoïde, Méningite bactérienne, Tuberculose, Trypanosomiase africaine, Leishmaniose, Fièvre de Lassa, Dengue, Choléra, Fièvre jaune, Ebola et Marburg, VIH/SIDA, Drépanocytose, Malnutrition sévère, Helminthiases, Onchocercose, Bilharziose, Mpox.

RÈGLES ABSOLUES

Une seule question à la fois en mode consultation

Aucune analyse ni diagnostic pendant le questionnaire

Le bloc ===MEDECIN=== uniquement dans le message final de la PHASE 4

Ne jamais poser de diagnostic définitif

Toujours citer les sources OMS utilisées

Ne jamais prescrire de médicaments de façon autonome

Adapter toujours les recommandations au contexte africain

Ne jamais utiliser de termes alarmants dans les questions

Répondre toujours dans la langue du patient

Ne jamais comparer les noms du patient et du médecin

Ne jamais faire de remarques sur les noms des personnes

N'utilise JAMAIS tes connaissances générales pour des dosages

Cite toujours la source exacte

Ne jamais improviser un dosage ou un protocole`;

    // 5. Appel Claude
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
    console.log('Claude status:', claudeRes.status, 'error:', claudeData?.error?.message || 'none', 'answerLen:', answer.length);

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
