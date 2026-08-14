# Système de contact

## Deux modes, une hiérarchie claire

|                       | Mode MANUEL (défaut)              | Mode AUTOMATIQUE (option, OFF)                                                                      |
| --------------------- | --------------------------------- | --------------------------------------------------------------------------------------------------- |
| Qui déclenche l'envoi | **l'utilisateur, toujours** (§22) | le système, sous garde-fous stricts (§23)                                                           |
| État actuel           | fonctionnel                       | garde-fous implémentés et testés ; **aucun envoi implémenté** (§42 : pas avant une collecte fiable) |
| Interrupteur          | —                                 | `AUTO_CONTACT_ENABLED`, `false` par défaut                                                          |

## Mode manuel (§22)

Parcours dans la fiche annonce (`ContactPanel`) :

1. Les coordonnées **publiquement disponibles** sont affichées avec leur
   provenance (« coordonnées issues de : laforet ») (§21). Aucune coordonnée
   n'est devinée ni obtenue en contournant une protection — absente, elle est
   dite absente.
2. Le message est composé localement à partir du profil (stocké dans le
   navigateur uniquement) et de l'annonce.
3. Quatre actions, toutes à la main de l'utilisateur :
   - **Modifier** — éditer le texte ;
   - **Copier** — presse-papiers ;
   - **Ouvrir** — `mailto:` pré-rempli, `tel:`, ou formulaire de l'annonce ;
   - **J'ai envoyé** — consigne le contact (aucun envoi : l'enregistrement du
     fait, pour le suivi §35 et les statistiques §33).

L'interface l'affirme en toutes lettres : « Rien n'est envoyé automatiquement.
Vous déclenchez l'envoi vous-même. » — et les tests E2E le verrouillent.

## Messages (§24)

Templates dans `packages/shared/src/message.ts` (partagés frontend/collecteur) :

- `agency-first-contact` — sobre, avec référence de l'annonce en objet ;
- `private-first-contact` — plus direct, pour un particulier ;
- `follow-up` — relance brève (§34).

Principe de **minimisation** : le premier message contient qui je suis, ce que
je vise, ma solvabilité en une phrase, ma disponibilité. Le dossier locataire
complet (bulletins, avis d'imposition, pièce d'identité) n'est **jamais** joint
ni détaillé au premier contact — il se transmet après accord, hors de l'outil.

Choix du canal, par ordre de préférence : e-mail (trace écrite) → formulaire
(canal prévu par l'agence) → téléphone (rapide, mais sans message).

## Mode automatique — garde-fous (§23)

`evaluateAutoContact()` (`contact/guards.ts`) est le **seul** point autorisé à
répondre « oui ». Refus par défaut ; le premier échec arrête l'évaluation :

1. interrupteur global OFF → refus (prime sur tout) ;
2. source `manualOnly` → refus (Laforêt l'est : premier contact via formulaire
   d'agence, l'automatiser sans supervision n'est pas approprié) ;
3. annonce déjà contactée → refus (un seul contact par annonce, jamais deux) ;
4. seuils : match ≥ 90, opportunité ≥ 90, proba visite ≥ 80, risque ≤ 20 ;
5. quotas glissants : ≤ 3/h, ≤ 10/j, ≤ 5/source/j ;
6. cooldown ≥ 600 s entre deux envois ;
7. un canal automatisable doit exister (e-mail ou formulaire).

Chaque décision rend une `reason` explicite, journalisée. Le journal
`contact_attempts` trace tout envoi (canal, déclencheur, message, relance n°).

Les 15 tests de `tests/integration/auto-contact.test.ts` couvrent chaque
garde-fou individuellement — c'est le scénario 5 du §53.

## Relances (§34)

MVP : la fiche montre l'historique des contacts ; une relance manuelle utilise
le template `follow-up` et incrémente `followUpIndex`. L'automatisation des
relances (arrêt dès réponse, limite de relances) est prévue en V2 — le schéma
(`follow_up_index`, `outcome`) est déjà prêt.

## Suivi (§35)

Statuts : Nouveau → À contacter → Contacté → Réponse reçue → Visite proposée →
Visite programmée → Visité → Refusé / Loué / Ignoré. Changement via le sélecteur
de la fiche (`PATCH /api/listings/:id`), événements conservés pour les
statistiques futures (§33).
