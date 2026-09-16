# Note de présentation — Échange en langage naturel avec l'API RGP

*Projet SÉSAME / carte-bdsp — page « RGP »*

## 1. Objet et périmètre

**Objet.** Offrir à un militaire une page **« RGP »** dans laquelle il dialogue en **langage
naturel** avec le registre des procédures RGP (les **UNA** — `unité/numéro/année`). À partir
d'une simple phrase, l'assistant :

- **crée** une procédure (allocation d'un numéro d'UNA) ;
- **modifie** une procédure existante (urgence, sensibilité, groupe, synthèse…) ;
- **consulte** la base (fiche d'un UNA, listes filtrées, comptages, répartitions, synthèses).

**Exemples de demandes traitées** (validées sur données réelles) :
- « Je rentre d'une intervention sur un cambriolage, donne-moi un numéro de PV attribué au
  groupe B et classé urgent. » → procédure **15127/126/2026** créée.
- « Bascule le 15127/128/2026 en sensible. » → modification appliquée.
- « Le 15127/123/2026 est-il associé à une commune ? » → réponse en langage naturel.
- « Présente-moi, par mois, le nombre de procédures liées à des cambriolages, sous forme de
  tableau. » → tableau de synthèse.

**Périmètre.** Version d'expérimentation centrée sur l'**unité 15127** (COB de
Segré-en-Anjou Bleu). Trois familles d'actions : **création**, **modification**,
**consultation**.

**Hors périmètre** (à ce stade) : gestion multi-unités, suppression d'un UNA (l'API ne
l'expose pas), étape de confirmation avant écriture (choix assumé, cf. §2), mémoire
conversationnelle entre questions.

## 2. Postulat de départ

- **L'API RGP est un service REST, pas un service conversationnel.** Elle sait allouer un
  numéro d'UNA de façon atomique, modifier et consulter — mais elle ne « comprend » pas une
  phrase. Il faut donc un composant qui **traduit** le langage naturel en actions.
- **Les données sont à diffusion restreinte.** Le traitement par un modèle de langage doit
  rester **interne** : on s'appuie sur la plateforme **IAka** (LLM hébergé), jamais sur un
  LLM externe.
- **La compréhension du langage doit rester fiable et sûre.** Une création d'UNA est
  **irréversible**. La lecture, elle, est sans risque.
- **Décision d'usage.** Pour l'expérimentation, l'exécution est **autonome** (pas d'étape de
  confirmation manuelle avant écriture). Ce choix est documenté et assumé.

## 3. Démarche suivie

La solution a été construite de manière **itérative et pilotée par des tests réels**, chaque
étape validée en conditions réelles avant la suivante.

1. **Cadrage** — définition du besoin, du périmètre et des contraintes (données restreintes,
   irréversibilité de l'écriture, LLM interne).
2. **Exploration de la plateforme IAka** — mise en évidence de ses capacités : workflows
   (agents + outils), nœud de condition piloté par un modèle, connecteurs (MCP) vers une API
   ou une base PostgreSQL.
3. **Prototypage du « cerveau » côté IAka** — un workflow qui analyse la demande, la route
   (écriture / lecture) et exécute l'action.
4. **Tests réels successifs** — création, modification, consultation, puis questions
   analytiques (répartitions, synthèses spatio-temporelles), sur la vraie base.
5. **Résolution des obstacles au fil des tests**, notamment :
   - fiabilité de l'exécution des outils (l'agent doit *appeler* l'outil, pas le *décrire*) ;
   - accès à la base en lecture (création d'un rôle **read-only dédié**, ouverture réseau
     maîtrisée) ;
   - injection de la **date du jour** (le modèle ne la connaît pas et interprétait mal
     « cette année ») ;
   - **intégrité des chiffres** : les comptages sont calculés par la base (SQL `GROUP BY`),
     jamais par le modèle ;
   - **présentation** : convergence vers un rendu **markdown** piloté par le prompt (tableaux,
     listes, mise en gras), pour que le format s'adapte à la demande sans retoucher le code.
6. **Convergence** — architecture stabilisée : un workflow IAka à **agents outillés** (MCP),
   un relais applicatif mince, un rendu markdown côté interface.

## 4. L'architecture mise en place

**Vue d'ensemble.**

```
Utilisateur (page RGP, chat)
        │  prompt en langage naturel
        ▼
Front SÉSAME (React)  ──►  Proxy applicatif (Node)  ──►  Plateforme IAka (workflow)
        ▲                        │  /api/rgp/chat            │  agents + outils (MCP)
        │  markdown rendu        │  (date du jour, relais)   ├─►  API HTTP RGP  (écriture)
        └────────────────────────┘                          └─►  Base PostgreSQL rgp (lecture)
```

**Composants.**

- **Interface (front).** Une page « RGP » = une zone de chat. Elle envoie la demande et
  **affiche la réponse de l'assistant en markdown** (phrase, tableau, liste selon le cas).
  Le format est décidé par l'assistant ; l'interface ne fait que le rendre.
- **Proxy applicatif.** Relais léger entre le front et IAka. Il :
  - **préfixe la date du jour** au prompt (pour les demandes relatives : « ce mois »,
    « cette année ») ;
  - déclenche le workflow IAka et attend le résultat ;
  - **réessaie** si aucun outil n'a été réellement exécuté (robustesse) ;
  - renvoie au front la réponse de l'assistant.
- **Plateforme IAka (le « cerveau »).** Le workflow analyse la demande, la **route** vers la
  branche adéquate et **exécute** l'action via ses outils. (Détail dans la note dédiée :
  *Chaîne agentique IAka*.)
- **API HTTP RGP** pour les **écritures** : elle encapsule l'allocation atomique du numéro
  d'UNA — jamais contournée.
- **Base PostgreSQL RGP** pour les **lectures** : interrogée en **SQL read-only** via un rôle
  dédié, sans aucun droit d'écriture.

**Principes de sécurité et de fiabilité.**

- **LLM interne** (IAka) : les données restreintes ne sortent pas du périmètre.
- **Séparation lecture / écriture.** La lecture passe par un rôle **read-only** (aucune
  écriture possible, même en cas d'erreur du modèle) ; l'écriture passe par l'**API HTTP**
  (allocation atomique préservée). Aucune écriture n'est faite en SQL direct.
- **Intégrité des données.** Les chiffres et enregistrements proviennent de la base ; le
  modèle **met en forme** mais ne **recalcule** pas.
- **Robustesse.** Le proxy rejoue une demande dont l'action n'a pas été réellement exécutée.

**État.** Les quatre familles d'actions (création, modification, consultation, analyse) sont
**validées de bout en bout sur données réelles**. L'interface, le proxy et les tests sont
livrés dans le dépôt ; le workflow est construit dans IAka (cf. note dédiée).
