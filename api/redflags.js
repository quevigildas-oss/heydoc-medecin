// /api/redflags.js
// DOKITA — Brique 2 : garde-fou "red flags" (signes de gravité)
// V1.0 — 2026-08 : structure de données + fonctions pures d'évaluation.
//
// RÔLE : couche de SÉCURITÉ DÉTERMINISTE (hors LLM). Le LLM (AfriBot) mène la
//        conversation ; ce module définit les signes de gravité à vérifier, interprète
//        les réponses du patient de façon déterministe, et produit un CONTEXTE CLINIQUE
//        réutilisable (triage immédiat + désambiguïsation des formes de maladie + prévention).
//
// SOURCE DE VÉRITÉ : DOKITA_referentiel_red_flags_V1.2 (OMS ETAT/IMCI + SATS + relecture
//        Dr Fouani Hugues). Les formulations "question_patient" sont des propositions à
//        VALIDER MÉDICALEMENT (relecture Fouani en cours) — ajustables sans toucher au code
//        d'évaluation (ce sont des chaînes de données).
//
// PRINCIPE DE CONCEPTION :
//   - Red flags EN DUR ici (jamais en base de données) : la sécurité vitale ne doit pas
//     pouvoir être altérée par une requête SQL ou une panne réseau. Versionné, revu, déployé.
//   - Niveaux : 'urgence' (🔴) | 'prioritaire' (🟠) | 'standard' (🟡).
//   - Actions figées par niveau (cf. ACTIONS ci-dessous), personnalisables via champ 'action'.
//   - Motif 'universel' : toujours vérifié, quel que soit le motif de consultation.
//
// ⚠️ Ce fichier ne DÉCIDE rien tout seul : il fournit données + fonctions pures. L'intégration
//    au flux (poser les questions, déclencher le workflow) se fait dans rag.js (étape 3).

'use strict';

// ────────────────────────────────────────────────────────────────────────────
// NIVEAUX & ACTIONS (figées par niveau)
// ────────────────────────────────────────────────────────────────────────────
const NIVEAUX = { URGENCE: 'urgence', PRIORITAIRE: 'prioritaire', STANDARD: 'standard' };

// Poids pour calculer le niveau max détecté (urgence > prioritaire > standard).
const NIVEAU_POIDS = { urgence: 3, prioritaire: 2, standard: 1 };

// Actions par défaut selon le niveau. 'escalade_medecin_prioritaire' = workflow 🔴 :
// message d'orientation directe au patient (non-alarmiste) + escalade médecin prioritaire,
// SIMULTANÉS et immédiats (jamais d'attente conditionnelle). Le texte exact des messages
// est géré côté rag.js/front (règle "diriger sans alarmer").
const ACTION_PAR_NIVEAU = {
  urgence:     'escalade_medecin_prioritaire',
  prioritaire: 'signaler_medecin_consultation_prioritaire',
  standard:    'poursuite_normale'
};

// ────────────────────────────────────────────────────────────────────────────
// STRUCTURE D'UN RED FLAG
//   id            : identifiant stable (unique)
//   motif         : motif de présentation ('universel' | 'fievre' | 'douleur_abdominale' | ...)
//   signe         : libellé en langage MÉDECIN (dossier, traçabilité)
//   niveau        : 'urgence' | 'prioritaire' | 'standard'
//   question      : question en langage PATIENT (proposition, à valider médicalement)
//   options       : choix fermés proposés au patient (format aligné sur [OPTIONS:] du bot)
//   declenche_si  : liste des réponses (parmi options) qui rendent le red flag POSITIF
//   source        : traçabilité clinique
//   action        : (optionnel) surcharge l'action par défaut du niveau
//   deja_dans_bot : (optionnel) true si la question existe déjà dans le questionnaire AfriBot
//                   (grossesse, chroniques) → à réutiliser, pas reposer.
//   note          : (optionnel) remarque (ex. "protocole dédié", "hub seulement")
// ────────────────────────────────────────────────────────────────────────────

const RED_FLAGS = [

  // ══════════ PARTIE A — SIGNES UNIVERSELS (motif: 'universel') ══════════
  // A/B — Voies aériennes & Respiration
  { id:'u_respiration_severe', motif:'universel', niveau:'urgence',
    signe:"Difficulté à respirer sévère / respiration très rapide ou laborieuse",
    question:"Avez-vous du mal à respirer en ce moment ?", options:['Oui, beaucoup','Un peu','Non'],
    declenche_si:['Oui, beaucoup'], source:'OMS ETAT' },
  { id:'u_cyanose', motif:'universel', niveau:'urgence',
    signe:"Cyanose — coloration bleutée (peau noire : paume des mains, ongles, lèvres)",
    question:"Vos ongles, paumes ou lèvres sont-ils devenus bleus ou violacés ?", options:['Oui','Non','Je ne sais pas'],
    declenche_si:['Oui'], source:'OMS ETAT · adaptation Fouani (peau noire)' },
  { id:'u_bruits_respi', motif:'universel', niveau:'urgence',
    signe:"Bruits respiratoires anormaux au repos (stridor, geignement)",
    question:"Entendez-vous un sifflement ou un bruit anormal quand vous respirez au repos ?", options:['Oui','Non'],
    declenche_si:['Oui'], source:'OMS ETAT' },
  { id:'u_etouffement', motif:'universel', niveau:'urgence',
    signe:"Impossibilité de parler/pleurer par manque d'air ; étouffement",
    question:"Arrivez-vous à parler normalement, ou le souffle vous manque-t-il ?", options:['Je parle normalement','Le souffle manque','Je m\'étouffe'],
    declenche_si:['Le souffle manque','Je m\'étouffe'], source:'OMS ETAT' },

  // C — Circulation / Conscience
  { id:'u_saignement', motif:'universel', niveau:'urgence',
    signe:"Saignement abondant non contrôlé",
    question:"Avez-vous un saignement important qui ne s'arrête pas ?", options:['Oui','Non'],
    declenche_si:['Oui'], source:'OMS ETAT' },
  { id:'u_conscience', motif:'universel', niveau:'urgence',
    signe:"Trouble de conscience : léthargie, difficile à réveiller, inconscience",
    question:"La personne est-elle anormalement endormie ou difficile à réveiller ?", options:['Oui','Non'],
    declenche_si:['Oui'], source:'OMS IMCI' },
  { id:'u_convulsions', motif:'universel', niveau:'urgence',
    signe:"Convulsions en cours ou récentes",
    question:"Avez-vous (ou la personne) fait des convulsions récemment ?", options:['Oui','Non'],
    declenche_si:['Oui'], source:'OMS IMCI' },
  { id:'u_confusion', motif:'universel', niveau:'urgence',
    signe:"Confusion / désorientation d'apparition brutale",
    question:"Y a-t-il une confusion soudaine (ne reconnaît pas les lieux ou les gens) ?", options:['Oui','Non'],
    declenche_si:['Oui'], source:'OMS ETAT' },

  // D — Déshydratation (enfant surtout)
  { id:'u_ne_boit_pas', motif:'universel', niveau:'urgence',
    signe:"Ne peut pas boire ni téter",
    question:"L'enfant arrive-t-il à boire ou téter ?", options:['Oui','Non, refuse'],
    declenche_si:['Non, refuse'], source:'OMS IMCI' },
  { id:'u_vomit_tout', motif:'universel', niveau:'urgence',
    signe:"Vomit absolument tout",
    question:"Vomit-il tout ce qu'il avale ?", options:['Oui, tout','Non'],
    declenche_si:['Oui, tout'], source:'OMS IMCI' },
  { id:'u_deshydratation', motif:'universel', niveau:'urgence',
    signe:"Yeux enfoncés + pli cutané lent + léthargie (déshydratation sévère)",
    question:"Les yeux sont-ils enfoncés et la peau garde-t-elle le pli quand on la pince ?", options:['Oui','Non'],
    declenche_si:['Oui'], source:'OMS IMCI' },

  // Signes vitaux critiques (au hub, si mesurables) — seuils par âge à compléter
  { id:'u_temperature', motif:'universel', niveau:'urgence',
    signe:"Température : hypothermie < 35°C ou hyperthermie > 38°C",
    question:"Température corporelle (si mesurable)", options:['< 35°C','35–38°C','> 38°C'],
    declenche_si:['< 35°C','> 38°C'], source:'Fouani / SATS', note:'hub — si mesurable' },

  // ══════════ PARTIE B — RED FLAGS PAR MOTIF ══════════

  // B.1 — FIÈVRE
  { id:'fievre_raideur_nuque', motif:'fievre', niveau:'urgence',
    signe:"Raideur de la nuque / photophobie (méningite)",
    question:"Arrivez-vous à baisser le menton jusqu'à toucher la poitrine, ou est-ce trop raide ou douloureux ?",
    options:['Oui, sans problème','Non, trop raide ou douloureux'], declenche_si:['Non, trop raide ou douloureux'], source:'OMS IMCI' },
  { id:'fievre_convulsions', motif:'fievre', niveau:'urgence',
    signe:"Convulsions associées",
    question:"Y a-t-il eu des convulsions avec la fièvre ?", options:['Oui','Non'], declenche_si:['Oui'], source:'OMS IMCI' },
  { id:'fievre_conscience', motif:'fievre', niveau:'urgence',
    signe:"Trouble de conscience / prostration",
    question:"La personne est-elle anormalement abattue ou difficile à réveiller ?", options:['Oui','Non'], declenche_si:['Oui'], source:'OMS IMCI' },
  { id:'fievre_purpura', motif:'fievre', niveau:'urgence',
    signe:"Éruption qui ne s'efface pas à la pression (purpura)",
    question:"Y a-t-il des taches rouges ou violettes qui ne pâlissent PAS quand on appuie dessus ?", options:['Oui','Non','Pas de taches'],
    declenche_si:['Oui'], source:'clinique' },
  { id:'fievre_respiration', motif:'fievre', niveau:'urgence',
    signe:"Difficulté respiratoire associée",
    question:"Avez-vous du mal à respirer avec la fièvre ?", options:['Oui','Non'], declenche_si:['Oui'], source:'OMS IMCI' },
  { id:'fievre_ne_boit_pas', motif:'fievre', niveau:'urgence',
    signe:"Incapacité à boire / vomissements incoercibles",
    question:"Arrivez-vous à boire, ou vomissez-vous tout ?", options:['Je bois','Je vomis tout'], declenche_si:['Je vomis tout'], source:'OMS IMCI' },
  { id:'fievre_douleurs_osseuses', motif:'fievre', niveau:'urgence',
    signe:"Douleurs osseuses (crise drépanocytaire)",
    question:"Avez-vous de fortes douleurs dans les os ou les articulations ?", options:['Oui','Non'], declenche_si:['Oui'],
    source:'Dr Fouani (drépanocytose)' },
  { id:'fievre_nourrisson', motif:'fievre', niveau:'prioritaire',
    signe:"Fièvre chez nourrisson < 3 mois",
    question:"L'enfant fébrile a-t-il moins de 3 mois ?", options:['Oui','Non'], declenche_si:['Oui'], source:'OMS IMCI' },
  { id:'fievre_prolongee', motif:'fievre', niveau:'urgence',
    signe:"Fièvre > 7 jours sans amélioration",
    question:"La fièvre dure-t-elle depuis plus de 7 jours ?", options:['Oui','Non'], declenche_si:['Oui'], source:'Dr Fouani (relevé en urgence)' },
  { id:'fievre_enceinte', motif:'fievre', niveau:'prioritaire',
    signe:"Femme enceinte fébrile",
    question:"Êtes-vous enceinte ou allaitante ?", options:['Oui, enceinte','Non','En cours d\'allaitement'], declenche_si:['Oui, enceinte'],
    source:'questionnaire AfriBot', deja_dans_bot:true },

  // B.2 — DOULEUR THORACIQUE
  { id:'thorax_irradiation', motif:'douleur_thoracique', niveau:'urgence',
    signe:"Douleur qui irradie bras gauche / mâchoire / dos",
    question:"La douleur se propage-t-elle vers le bras gauche, la mâchoire ou le dos ?", options:['Oui','Non'], declenche_si:['Oui'], source:'clinique/SATS' },
  { id:'thorax_coronarien', motif:'douleur_thoracique', niveau:'urgence',
    signe:"Douleur + sueurs + essoufflement (syndrome coronarien)",
    question:"La douleur s'accompagne-t-elle de sueurs et d'essoufflement ?", options:['Oui','Non'], declenche_si:['Oui'], source:'clinique/SATS' },
  { id:'thorax_respiration', motif:'douleur_thoracique', niveau:'urgence',
    signe:"Difficulté respiratoire sévère",
    question:"Avez-vous beaucoup de mal à respirer ?", options:['Oui','Non'], declenche_si:['Oui'], source:'OMS ETAT' },
  { id:'thorax_syncope', motif:'douleur_thoracique', niveau:'urgence',
    signe:"Palpitations + malaise / perte de connaissance",
    question:"Avez-vous des palpitations avec malaise ou perte de connaissance ?", options:['Oui','Non'], declenche_si:['Oui'], source:'clinique' },
  { id:'thorax_poignard', motif:'douleur_thoracique', niveau:'urgence',
    signe:"Douleur brutale « en coup de poignard » + essoufflement",
    question:"La douleur est-elle apparue brutalement, très intense, avec essoufflement ?", options:['Oui','Non'], declenche_si:['Oui'], source:'clinique' },

  // B.3 — DIFFICULTÉ RESPIRATOIRE / TOUX
  { id:'respi_repos', motif:'respiratoire', niveau:'urgence',
    signe:"Respiration rapide/laborieuse au repos",
    question:"Respirez-vous vite ou avec effort même au repos ?", options:['Oui','Non'], declenche_si:['Oui'], source:'OMS ETAT' },
  { id:'respi_cyanose', motif:'respiratoire', niveau:'urgence',
    signe:"Cyanose",
    question:"Vos lèvres, ongles ou paumes sont-ils bleutés ?", options:['Oui','Non'], declenche_si:['Oui'], source:'OMS ETAT · Fouani' },
  { id:'respi_stridor', motif:'respiratoire', niveau:'urgence',
    signe:"Stridor / geignement / tirage",
    question:"Entendez-vous un bruit anormal, ou la peau se creuse-t-elle entre les côtes en respirant ?", options:['Oui','Non'], declenche_si:['Oui'], source:'OMS IMCI' },
  { id:'respi_phrase', motif:'respiratoire', niveau:'urgence',
    signe:"Incapacité à finir une phrase",
    question:"Arrivez-vous à finir une phrase sans reprendre votre souffle ?", options:['Oui','Non'], declenche_si:['Non'], source:'clinique' },
  { id:'respi_hemoptysie', motif:'respiratoire', niveau:'prioritaire',
    signe:"Crachats de sang (hémoptysie)",
    question:"Crachez-vous du sang ?", options:['Oui','Non'], declenche_si:['Oui'], source:'clinique' },
  { id:'respi_toux_chronique', motif:'respiratoire', niveau:'prioritaire',
    signe:"Toux > 2-3 semaines (suspicion TB)",
    question:"Toussez-vous depuis plus de 2 à 3 semaines ?", options:['Oui','Non'], declenche_si:['Oui'], source:'OMS (TB)' },

  // B.4 — DOULEUR ABDOMINALE
  { id:'abdo_rigide', motif:'douleur_abdominale', niveau:'urgence',
    signe:"Ventre dur, rigide, très douloureux (abdomen chirurgical)",
    question:"Votre ventre est-il très dur et extrêmement douloureux au toucher ?", options:['Oui','Non'], declenche_si:['Oui'], source:'clinique' },
  { id:'abdo_choc', motif:'douleur_abdominale', niveau:'urgence',
    signe:"Douleur brutale intense + choc",
    question:"La douleur est-elle apparue brutalement et très forte ?", options:['Oui','Non'], declenche_si:['Oui'], source:'clinique' },
  { id:'abdo_hemorragie', motif:'douleur_abdominale', niveau:'urgence',
    signe:"Vomissements de sang / selles noires",
    question:"Avez-vous vomi du sang ou eu des selles noires comme du goudron ?", options:['Oui','Non'], declenche_si:['Oui'], source:'clinique' },
  { id:'abdo_occlusion', motif:'douleur_abdominale', niveau:'urgence',
    signe:"Occlusion : plus de selles ni de gaz + ventre gonflé",
    question:"N'avez-vous plus de selles NI de gaz, avec un ventre gonflé ?", options:['Oui','Non'], declenche_si:['Oui'], source:'clinique' },
  { id:'abdo_geu', motif:'douleur_abdominale', niveau:'urgence',
    signe:"Grossesse possible + douleur pelvienne + saignement (GEU)",
    question:"Êtes-vous peut-être enceinte, avec une douleur du bas-ventre et un saignement ?", options:['Oui','Non'], declenche_si:['Oui'], source:'clinique' },
  { id:'abdo_ictere', motif:'douleur_abdominale', niveau:'prioritaire',
    signe:"Ictère : jaunisse des conjonctives (blanc de l'œil jaune)",
    question:"Le blanc de vos yeux est-il devenu jaune ?", options:['Oui','Non'], declenche_si:['Oui'], source:'Dr Fouani' },
  { id:'abdo_appendicite', motif:'douleur_abdominale', niveau:'prioritaire',
    signe:"Douleur fosse iliaque droite + fièvre (appendicite)",
    question:"Avez-vous une douleur en bas à droite du ventre avec de la fièvre ?", options:['Oui','Non'], declenche_si:['Oui'], source:'clinique' },
  { id:'abdo_enceinte', motif:'douleur_abdominale', niveau:'prioritaire',
    signe:"Femme enceinte + douleur abdominale",
    question:"Êtes-vous enceinte ?", options:['Oui, enceinte','Non','En cours d\'allaitement'], declenche_si:['Oui, enceinte'],
    source:'questionnaire AfriBot', deja_dans_bot:true },

  // B.5 — CÉPHALÉE
  { id:'cephalee_tonnerre', motif:'cephalee', niveau:'urgence',
    signe:"Céphalée brutale « en coup de tonnerre », maximale d'emblée",
    question:"Le mal de tête est-il apparu brutalement, très fort d'un coup ?", options:['Oui','Non'], declenche_si:['Oui'], source:'clinique' },
  { id:'cephalee_meningee', motif:'cephalee', niveau:'urgence',
    signe:"Céphalée + raideur de nuque + fièvre",
    question:"Le mal de tête s'accompagne-t-il d'une nuque raide et de fièvre ?", options:['Oui','Non'], declenche_si:['Oui'], source:'OMS IMCI' },
  { id:'cephalee_conscience', motif:'cephalee', niveau:'urgence',
    signe:"Céphalée + trouble de conscience / confusion",
    question:"Le mal de tête s'accompagne-t-il de confusion ou de somnolence anormale ?", options:['Oui','Non'], declenche_si:['Oui'], source:'clinique' },
  { id:'cephalee_deficit', motif:'cephalee', niveau:'urgence',
    signe:"Céphalée + déficit neuro (faiblesse, parole, vision)",
    question:"Avez-vous une faiblesse, un trouble de la parole ou de la vision avec le mal de tête ?", options:['Oui','Non'], declenche_si:['Oui'], source:'clinique' },
  { id:'cephalee_convulsions', motif:'cephalee', niveau:'urgence',
    signe:"Céphalée + convulsions",
    question:"Y a-t-il eu des convulsions avec le mal de tête ?", options:['Oui','Non'], declenche_si:['Oui'], source:'clinique' },
  { id:'cephalee_vomissements', motif:'cephalee', niveau:'prioritaire',
    signe:"Céphalée + vomissements en jet",
    question:"Avez-vous des vomissements violents (en jet) avec le mal de tête ?", options:['Oui','Non'], declenche_si:['Oui'], source:'clinique' },

  // B.6 — SYMPTÔMES NEUROLOGIQUES
  { id:'neuro_avc', motif:'neurologique', niveau:'urgence',
    signe:"Faiblesse/paralysie brutale d'un côté (AVC)",
    question:"Avez-vous une faiblesse ou paralysie soudaine d'un côté du corps ?", options:['Oui','Non'], declenche_si:['Oui'], source:'clinique' },
  { id:'neuro_parole_vision', motif:'neurologique', niveau:'urgence',
    signe:"Trouble brutal de la parole / de la vision",
    question:"Avez-vous eu un trouble soudain de la parole ou de la vision ?", options:['Oui','Non'], declenche_si:['Oui'], source:'clinique' },
  { id:'neuro_convulsions', motif:'neurologique', niveau:'urgence',
    signe:"Convulsions",
    question:"Avez-vous fait des convulsions ?", options:['Oui','Non'], declenche_si:['Oui'], source:'OMS IMCI' },
  { id:'neuro_pc', motif:'neurologique', niveau:'urgence',
    signe:"Perte de connaissance",
    question:"Avez-vous perdu connaissance ?", options:['Oui','Non'], declenche_si:['Oui'], source:'clinique' },
  { id:'neuro_confusion', motif:'neurologique', niveau:'urgence',
    signe:"Confusion / désorientation nouvelle",
    question:"Y a-t-il une confusion ou désorientation nouvelle ?", options:['Oui','Non'], declenche_si:['Oui'], source:'OMS ETAT' },

  // B.7 — VOMISSEMENTS / DIARRHÉE
  { id:'diarrhee_ne_garde_rien', motif:'vomissements_diarrhee', niveau:'urgence',
    signe:"Ne peut rien garder / vomit tout",
    question:"Arrivez-vous à garder les liquides, ou vomissez-vous tout ?", options:['Je garde','Je vomis tout'], declenche_si:['Je vomis tout'], source:'OMS IMCI' },
  { id:'diarrhee_sang', motif:'vomissements_diarrhee', niveau:'urgence',
    signe:"Sang dans les selles / vomissements de sang",
    question:"Y a-t-il du sang dans les selles ou les vomissements ?", options:['Oui','Non'], declenche_si:['Oui'], source:'clinique' },
  { id:'diarrhee_lethargie_enfant', motif:'vomissements_diarrhee', niveau:'urgence',
    signe:"Diarrhée + léthargie chez l'enfant",
    question:"L'enfant avec diarrhée est-il anormalement abattu ou endormi ?", options:['Oui','Non'], declenche_si:['Oui'], source:'OMS IMCI' },
  { id:'diarrhee_prolongee_enfant', motif:'vomissements_diarrhee', niveau:'urgence',
    signe:"Diarrhée > plusieurs jours chez enfant/nourrisson",
    question:"La diarrhée de l'enfant dure-t-elle depuis plusieurs jours ?", options:['Oui','Non'], declenche_si:['Oui'], source:'Dr Fouani (relevé en urgence)' },

  // B.8 — SYMPTÔMES URINAIRES / GÉNITAUX (＋ signes génitaux, Fouani)
  { id:'urin_anurie', motif:'urinaire_genital', niveau:'urgence',
    signe:"Absence totale d'urine (anurie)",
    question:"Avez-vous complètement cessé d'uriner depuis longtemps ?", options:['Oui','Non'], declenche_si:['Oui'], source:'clinique' },
  { id:'genital_torsion', motif:'urinaire_genital', niveau:'urgence',
    signe:"Douleur scrotale aiguë (torsion testiculaire)",
    question:"Avez-vous une douleur brutale et intense à un testicule ?", options:['Oui','Non','Non concerné'], declenche_si:['Oui'], source:'Dr Fouani' },
  { id:'genital_priapisme', motif:'urinaire_genital', niveau:'urgence',
    signe:"Priapisme — érection douloureuse prolongée (drépanocytose)",
    question:"Avez-vous une érection douloureuse qui ne cesse pas ?", options:['Oui','Non','Non concerné'], declenche_si:['Oui'], source:'Dr Fouani (drépanocytose)' },
  { id:'urin_pyelonephrite', motif:'urinaire_genital', niveau:'prioritaire',
    signe:"Douleur lombaire + fièvre + frissons (pyélonéphrite)",
    question:"Avez-vous une douleur dans le dos (côté) avec fièvre et frissons ?", options:['Oui','Non'], declenche_si:['Oui'], source:'clinique' },
  { id:'urin_hematurie', motif:'urinaire_genital', niveau:'prioritaire',
    signe:"Sang dans les urines",
    question:"Y a-t-il du sang dans vos urines ?", options:['Oui','Non'], declenche_si:['Oui'], source:'clinique' },
  { id:'urin_enceinte', motif:'urinaire_genital', niveau:'prioritaire',
    signe:"Douleur/brûlure urinaire + fièvre chez femme enceinte",
    question:"Êtes-vous enceinte, avec brûlure urinaire et fièvre ?", options:['Oui','Non'], declenche_si:['Oui'], source:'clinique' },

  // B.9 — SANTÉ DE LA FEMME / GROSSESSE
  { id:'femme_saignement', motif:'femme_grossesse', niveau:'urgence',
    signe:"Saignement vaginal abondant",
    question:"Avez-vous un saignement vaginal abondant ?", options:['Oui','Non'], declenche_si:['Oui'], source:'clinique' },
  { id:'femme_grossesse_saignement', motif:'femme_grossesse', niveau:'urgence',
    signe:"Grossesse + saignement / douleur abdominale",
    question:"Êtes-vous enceinte, avec saignement ou douleur du ventre ?", options:['Oui','Non'], declenche_si:['Oui'], source:'clinique' },
  { id:'femme_preeclampsie', motif:'femme_grossesse', niveau:'urgence',
    signe:"Grossesse + céphalée sévère + troubles visuels (pré-éclampsie)",
    question:"Enceinte, avez-vous un fort mal de tête avec troubles de la vision ?", options:['Oui','Non'], declenche_si:['Oui'], source:'clinique' },
  { id:'femme_eclampsie', motif:'femme_grossesse', niveau:'urgence',
    signe:"Grossesse + convulsions (éclampsie)",
    question:"Enceinte, avez-vous fait des convulsions ?", options:['Oui','Non'], declenche_si:['Oui'], source:'clinique' },
  { id:'femme_grossesse_fievre', motif:'femme_grossesse', niveau:'prioritaire',
    signe:"Grossesse + fièvre",
    question:"Êtes-vous enceinte avec de la fièvre ?", options:['Oui','Non'], declenche_si:['Oui'], source:'clinique' },

  // B.10 — SANTÉ MENTALE (protocole dédié — formulations À VALIDER avec soin particulier)
  { id:'mental_suicide', motif:'sante_mentale', niveau:'urgence',
    signe:"Idées suicidaires / propos sur vouloir mourir",
    question:"[PROTOCOLE DÉDIÉ — formulation à concevoir et valider médicalement, ne pas poser comme une simple question à choix]",
    options:[], declenche_si:[], source:'protocole dédié', note:'NE PAS traiter comme un red flag ordinaire — protocole spécifique requis' },
  { id:'mental_agitation', motif:'sante_mentale', niveau:'urgence',
    signe:"Agitation dangereuse / propos de violence",
    question:"[à rédiger avec précaution]", options:[], declenche_si:[], source:'protocole dédié', note:'protocole spécifique' },
  { id:'mental_psychose', motif:'sante_mentale', niveau:'urgence',
    signe:"Rupture avec la réalité (hallucinations, délire)",
    question:"Voyez-vous ou entendez-vous des choses que les autres ne perçoivent pas ?", options:['Oui','Non'], declenche_si:['Oui'],
    source:'Dr Fouani (relevé en urgence)', note:'formulation à valider' },

  // B.11 — TRAUMATISME / PLAIES / MORSURES
  { id:'trauma_saignement', motif:'traumatisme', niveau:'urgence',
    signe:"Saignement abondant non contrôlé",
    question:"Avez-vous un saignement important qui ne s'arrête pas ?", options:['Oui','Non'], declenche_si:['Oui'], source:'OMS ETAT' },
  { id:'trauma_haute_energie', motif:'traumatisme', niveau:'urgence',
    signe:"Traumatisme à haute énergie (chute, accident)",
    question:"Le traumatisme vient-il d'une chute de hauteur ou d'un accident violent ?", options:['Oui','Non'], declenche_si:['Oui'], source:'SATS' },
  { id:'trauma_cranien', motif:'traumatisme', niveau:'urgence',
    signe:"Trouble de conscience après traumatisme crânien",
    question:"Après un choc à la tête, y a-t-il eu perte de connaissance ou confusion ?", options:['Oui','Non'], declenche_si:['Oui'], source:'clinique' },
  { id:'trauma_morsure', motif:'traumatisme', niveau:'prioritaire',
    signe:"Morsure de serpent / animal (rage, envenimation)",
    question:"Avez-vous été mordu par un serpent ou un animal ?", options:['Oui','Non'], declenche_si:['Oui'], source:'clinique' },
  { id:'trauma_plaie_diabetique', motif:'traumatisme', niveau:'prioritaire',
    signe:"Plaie qui ne cicatrise pas chez diabétique",
    question:"Êtes-vous diabétique avec une plaie qui ne guérit pas ?", options:['Oui','Non'], declenche_si:['Oui'], source:'clinique' },
  { id:'trauma_brulure', motif:'traumatisme', niveau:'prioritaire',
    signe:"Brûlure étendue",
    question:"Avez-vous une brûlure sur une grande surface du corps ?", options:['Oui','Non'], declenche_si:['Oui'], source:'clinique' },
];

// ────────────────────────────────────────────────────────────────────────────
// FONCTIONS PURES (aucun effet de bord — testables isolément)
// ────────────────────────────────────────────────────────────────────────────

// Liste des motifs distincts (hors 'universel').
function listerMotifs() {
  return [...new Set(RED_FLAGS.map(rf => rf.motif))].filter(m => m !== 'universel');
}

// Red flags à vérifier pour un motif donné = universels (toujours) + ceux du motif.
// motif peut être null/inconnu → on renvoie au moins les universels.
function redFlagsPourMotif(motif) {
  const universels = RED_FLAGS.filter(rf => rf.motif === 'universel');
  const duMotif = motif ? RED_FLAGS.filter(rf => rf.motif === motif) : [];
  return [...universels, ...duMotif];
}

// Un red flag est-il POSITIF selon la réponse du patient ?
// reponse = chaîne (le choix retenu). Comparaison tolérante à la casse/espaces.
function estPositif(redFlag, reponse) {
  if (!reponse || !redFlag.declenche_si || redFlag.declenche_si.length === 0) return false;
  const norm = s => String(s).trim().toLowerCase();
  const r = norm(reponse);
  return redFlag.declenche_si.some(d => norm(d) === r);
}

// Évalue un ensemble de réponses et produit le CONTEXTE CLINIQUE.
// reponses = objet { [redFlagId]: reponseChoisie }.
// faitsProfil = objet optionnel { grossesse:bool, age:number, age_pediatrique:bool, ... }
//   (la grossesse vient du profil/bot, PAS d'un red flag — cf. conception).
// Retourne :
//   { red_flags_positifs:[{id,signe,niveau,motif,source}], niveau_max, gravite,
//     action, grossesse, age, age_pediatrique }
function evaluerContexteClinique(reponses, faitsProfil, motif) {
  reponses = reponses || {};
  faitsProfil = faitsProfil || {};
  const positifs = [];
  for (const rf of RED_FLAGS) {
    const rep = reponses[rf.id];
    if (rep !== undefined && estPositif(rf, rep)) {
      positifs.push({ id: rf.id, signe: rf.signe, niveau: rf.niveau, motif: rf.motif, source: rf.source });
    }
  }
  // niveau max détecté
  let niveauMax = null, poidsMax = 0;
  for (const p of positifs) {
    const poids = NIVEAU_POIDS[p.niveau] || 0;
    if (poids > poidsMax) { poidsMax = poids; niveauMax = p.niveau; }
  }
  const gravite = positifs.some(p => p.niveau === 'urgence');
  const action = niveauMax ? (ACTION_PAR_NIVEAU[niveauMax] || 'poursuite_normale') : 'poursuite_normale';

  // Checklist médecin = red flags 🟠 (prioritaire) du motif NON vérifiés avec le patient.
  // On liste ceux qui n'ont pas de réponse positive connue → à contrôler en consultation.
  let checklist_medecin = [];
  if (motif) {
    const rep = redFlagsMotifReparti(motif);
    checklist_medecin = rep.checklist_medecin
      .filter(rf => !positifs.some(p => p.id === rf.id)) // pas déjà remonté comme positif
      .map(rf => ({ id: rf.id, signe: rf.signe, niveau: rf.niveau, source: rf.source }));
  }

  return {
    red_flags_positifs: positifs,
    niveau_max: niveauMax,                 // 'urgence' | 'prioritaire' | null
    gravite: gravite,                      // true si au moins un red flag urgence
    action: action,                        // action à déclencher (workflow rag.js)
    checklist_medecin: checklist_medecin,  // 🟠 à vérifier par le médecin (non demandés au patient)
    // faits de profil (source distincte des red flags), utiles au triage + désambiguïsation Bug A
    grossesse: faitsProfil.grossesse === true,
    age: (typeof faitsProfil.age === 'number') ? faitsProfil.age : null,
    age_pediatrique: faitsProfil.age_pediatrique === true ||
                     (typeof faitsProfil.age === 'number' && faitsProfil.age < 5)
  };
}

// ────────────────────────────────────────────────────────────────────────────
// FILTRE D'ENTRÉE & RÉPARTITION PATIENT / MÉDECIN (V1.1 — 2026-08)
// ────────────────────────────────────────────────────────────────────────────
// Objectif : garder le questionnaire de sécurité SUPPORTABLE (cible : 3-4 questions
// de sécurité, ~10 questions max au total dans le chat). Décisions :
//   1) FILTRE D'ENTRÉE : une seule question groupée (6 signes vitaux numérotés),
//      posée en tout premier, couvre les universels les plus critiques.
//   2) MOTIF → on ne POSE AU PATIENT que les red flags 'urgence' (🔴) du motif,
//      APRÈS avoir retiré ceux déjà couverts par le filtre d'entrée (déduplication).
//   3) Les red flags 'prioritaire' (🟠) du motif ne sont PAS demandés au patient :
//      ils sont transmis au MÉDECIN comme CHECKLIST à vérifier en consultation
//      (« merci de contrôler ces signes »). Réduit le risque sans alourdir le chat.

// Les 6 red flags composant le filtre d'entrée (ids explicites — pas de détection par mots-clés).
const FILTRE_ENTREE_IDS = [
  'u_respiration_severe', // 1. Difficulté à respirer
  'u_conscience',         // 2. Perte de connaissance / ne se réveille pas
  'u_convulsions',        // 3. Convulsions
  'u_saignement',         // 4. Saignement abondant
  'u_cyanose',            // 5. Lèvres/ongles/paumes bleus
  'u_ne_boit_pas'         // 6. (enfant) Ne peut plus boire ni téter
];

// Déduplication : red flags de MOTIF dont le concept est déjà couvert par le filtre d'entrée
// → on ne les repose pas. Mappé EXPLICITEMENT par id (fiable, pas de heuristique de texte).
// clé = id du red flag de motif à NE PAS reposer ; valeur = id du filtre qui le couvre.
const COUVERT_PAR_FILTRE = {
  'fievre_respiration':   'u_respiration_severe',
  'fievre_convulsions':   'u_convulsions',
  'fievre_conscience':    'u_conscience',
  'fievre_ne_boit_pas':   'u_ne_boit_pas',
  'respi_cyanose':        'u_cyanose',
  'cephalee_convulsions': 'u_convulsions',
  'neuro_convulsions':    'u_convulsions',
  'neuro_pc':             'u_conscience',
  'femme_eclampsie':      'u_convulsions',
  'trauma_saignement':    'u_saignement'
};

// Renvoie les red flags du FILTRE D'ENTRÉE (objets complets), dans l'ordre d'affichage.
function redFlagsFiltreEntree() {
  return FILTRE_ENTREE_IDS
    .map(id => RED_FLAGS.find(rf => rf.id === id))
    .filter(Boolean);
}

// Pour un motif donné, sépare les red flags en 2 groupes :
//   - a_poser_patient : les 🔴 (urgence) du motif, NON couverts par le filtre d'entrée.
//   - checklist_medecin : les 🟠 (prioritaire) du motif — à vérifier par le médecin, pas demandés.
// Retourne { a_poser_patient:[...], checklist_medecin:[...] }.
function redFlagsMotifReparti(motif) {
  const duMotif = motif ? RED_FLAGS.filter(rf => rf.motif === motif) : [];
  const a_poser_patient = duMotif.filter(rf =>
    rf.niveau === 'urgence' &&
    !COUVERT_PAR_FILTRE[rf.id] &&
    Array.isArray(rf.options) && rf.options.length > 0 // exclut santé mentale (protocole dédié, options vides)
  );
  const checklist_medecin = duMotif.filter(rf => rf.niveau === 'prioritaire');
  return { a_poser_patient, checklist_medecin };
}


// ────────────────────────────────────────────────────────────────────────────
// GROUPAGE (V1.2 — 2026-08) : une seule question numérotée par motif
// ────────────────────────────────────────────────────────────────────────────
// Décision : pour tenir la cible (~3-4 questions de sécurité), on ne pose pas N
// questions oui/non par motif, mais UNE question groupée numérotée (comme le filtre
// d'entrée). Le patient répond avec le(s) numéro(s) ou "Aucun".
//
// ⚠️ À FAIRE (noté au master) : rédiger un 'libelle_court' par red flag pour l'affichage
//    en liste (plus lisible que la 'question' individuelle). En attendant (B2), on réutilise
//    la 'question'. Validation Dr Fouani.
//
// parseNumeros : extrait de façon TOLÉRANTE les numéros d'une réponse patient libre.
//   Accepte "1, 3", "1 et 3", "le 1 et le 5", "1;3", "134" (→ 1,3,4 si <= max), etc.
//   Retourne un tableau d'entiers (1-indexés) valides (entre 1 et max).
function parseNumeros(reponse, max) {
  if (!reponse) return [];
  const txt = String(reponse).toLowerCase();
  // "aucun" / "non" / "rien" → aucun numéro
  if (/\b(aucun|aucune|non|rien|ras)\b/.test(txt)) return [];
  // extraire toutes les séquences de chiffres
  const trouves = (txt.match(/\d+/g) || [])
    .flatMap(seq => seq.length > 1 && Number(seq) > max
      ? seq.split('').map(Number)   // "135" → [1,3,5] si 135 > max (chiffres collés)
      : [Number(seq)])
    .filter(n => n >= 1 && n <= max);
  return [...new Set(trouves)]; // dédoublonne
}

// Construit la question groupée d'un motif : { texte, correspondance }.
//   texte = la question numérotée à faire poser par le bot (langage patient).
//   correspondance = tableau ordonné des ids [id1, id2, ...] → l'index+1 = le numéro affiché.
// Ne contient QUE les red flags 'a_poser_patient' (🔴 dédupliqués) du motif.
// Retourne null si le motif n'a aucun red flag à poser.
function questionGroupeeMotif(motif) {
  const { a_poser_patient } = redFlagsMotifReparti(motif);
  if (!a_poser_patient.length) return null;
  const correspondance = a_poser_patient.map(rf => rf.id);
  // B2 : on réutilise la 'question' individuelle comme libellé (à remplacer par libelle_court plus tard)
  const lignes = a_poser_patient.map((rf, i) =>
    (i + 1) + '. ' + (rf.libelle_court || rf.question || rf.signe));
  const texte =
    "Parmi ces signes, en avez-vous — ou la personne concernée — un ou plusieurs, maintenant ou récemment ?\n"
    + lignes.join('\n')
    + "\nIndiquez le(s) numéro(s) concerné(s) (ex. « 1, 3 »), ou « Aucun ».";
  return { texte, correspondance };
}

// Interprète la réponse numérotée du patient pour un motif, et renvoie les réponses
// au format attendu par evaluerContexteClinique : { [redFlagId]: reponseDeclenchante }.
// Les red flags cités (numéros) reçoivent leur 1re valeur déclenchante ; les autres du
// groupe reçoivent une valeur NON déclenchante (pour marquer "posé + négatif", pas "non posé").
function interpreterReponseGroupee(motif, reponsePatient) {
  const grp = questionGroupeeMotif(motif);
  if (!grp) return {};
  const nums = parseNumeros(reponsePatient, grp.correspondance.length);
  const citesIds = new Set(nums.map(n => grp.correspondance[n - 1]));
  const out = {};
  for (const id of grp.correspondance) {
    const rf = RED_FLAGS.find(x => x.id === id);
    if (!rf) continue;
    if (citesIds.has(id)) {
      // cité → valeur déclenchante (la 1re de declenche_si)
      out[id] = (rf.declenche_si && rf.declenche_si[0]) || 'Oui';
    } else {
      // non cité → valeur explicitement NON déclenchante (posé, négatif)
      const nonDecl = (rf.options || []).find(o => !(rf.declenche_si || []).includes(o));
      out[id] = nonDecl || 'Non';
    }
  }
  return out;
}

// Idem pour le FILTRE D'ENTRÉE (6 universels numérotés).
function questionFiltreEntree() {
  const flags = redFlagsFiltreEntree();
  const correspondance = flags.map(rf => rf.id);
  const lignes = flags.map((rf, i) => (i + 1) + '. ' + (rf.libelle_court || rf.signe.split('(')[0].trim()));
  const texte =
    "Avant de continuer, je vérifie quelques points importants. Est-ce que vous — ou la personne "
    + "concernée — présentez l'un de ces signes, maintenant ou tout récemment ?\n"
    + lignes.join('\n')
    + "\nIndiquez le(s) numéro(s) concerné(s) (ex. « 1, 3 »), ou « Aucun ».";
  return { texte, correspondance };
}

function interpreterReponseFiltre(reponsePatient) {
  const flags = redFlagsFiltreEntree();
  const correspondance = flags.map(rf => rf.id);
  const nums = parseNumeros(reponsePatient, correspondance.length);
  const citesIds = new Set(nums.map(n => correspondance[n - 1]));
  const out = {};
  for (const rf of flags) {
    if (citesIds.has(rf.id)) out[rf.id] = (rf.declenche_si && rf.declenche_si[0]) || 'Oui';
    else {
      const nonDecl = (rf.options || []).find(o => !(rf.declenche_si || []).includes(o));
      out[rf.id] = nonDecl || 'Non';
    }
  }
  return out;
}

// Génère le BLOC TEXTE complet de toutes les questions de sécurité par motif,
// prêt à être injecté dans le prompt système de rag.js (étape 3.1 brique 2).
// Chaque motif est préfixé de [RF-MOTIF:<motif>]. Le bot posera celle du motif identifié.
function blocQuestionsMotifsPourPrompt() {
  const motifs = listerMotifs();
  let bloc = '';
  for (const m of motifs) {
    const q = questionGroupeeMotif(m);
    if (q) {
      // intro adaptée au motif (transition naturelle après le filtre universel)
      bloc += '[RF-MOTIF:' + m + ']\n' + q.texte + '\n\n';
    }
  }
  return bloc.trim();
}

// Génère le TEXTE de la question filtre d'entrée, prêt pour le prompt.
function blocFiltrePourPrompt() {
  const f = questionFiltreEntree();
  return '[RF-FILTRE]\n' + f.texte;
}

module.exports = {
  NIVEAUX,
  ACTION_PAR_NIVEAU,
  RED_FLAGS,
  FILTRE_ENTREE_IDS,
  listerMotifs,
  redFlagsPourMotif,
  redFlagsFiltreEntree,
  redFlagsMotifReparti,
  estPositif,
  evaluerContexteClinique,
  parseNumeros,
  questionGroupeeMotif,
  interpreterReponseGroupee,
  questionFiltreEntree,
  interpreterReponseFiltre,
  blocQuestionsMotifsPourPrompt,
  blocFiltrePourPrompt
};
