# Confidentialité

Le dépôt est **public** (§26). Ce document décrit où vit chaque donnée
sensible, et les mécanismes qui empêchent structurellement une fuite — pas
seulement la vigilance de celui qui commite.

## Cartographie des données

| Donnée                                             | Où elle vit                                                                                                                       | Où elle ne va JAMAIS                                                                                             |
| -------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| Profil locataire (nom, revenus, garant…) (§25)     | `localStorage` du navigateur **uniquement** ; ou variables `TENANT_*` dans `.env` local / secrets Actions pour le futur mode auto | dépôt, API, Turso, bundle                                                                                        |
| Points de référence — travail, gare (§20)          | secrets GitHub Actions (`REFERENCE_*`) ; `.env` local                                                                             | dépôt ; l'interface n'affiche que des libellés neutres (« Travail : 17 min ») et des durées, pas les coordonnées |
| Jetons Turso / API                                 | secrets Actions, `wrangler secret`, `.env` local                                                                                  | dépôt, bundle, logs                                                                                              |
| Jeton d'accès frontend                             | saisi par l'utilisateur, `localStorage`                                                                                           | le bundle publié (il n'y est pas : vérifié par grep au déploiement)                                              |
| Annonces collectées, statuts, contacts             | Turso, derrière l'API à jeton                                                                                                     | GitHub Pages (qui ne sert que l'application)                                                                     |
| Coordonnées des annonceurs (téléphones d'agences…) | Turso                                                                                                                             | logs (expurgation automatique), fixtures (anonymisées)                                                           |

## Les six barrières

1. **`.gitignore` strict** — `.env*`, `config/private/`, `data/`, `*.db`,
   captures brutes. Testé par `tests/security/secrets.test.ts`.
2. **Scanner maison** (`pnpm check:secrets`) — JWT, URLs Turso, clés AWS/GitHub,
   clés privées, affectations de secrets, e-mails réels, téléphones français.
   Bloquant en CI. Échappatoires : domaine `example.invalid`, plage
   `06 00 00 00 xx`, commentaire `secret-scan-ignore` pour un cas légitime.
   Le scanner n'imprime jamais la valeur détectée en entier (les logs de CI
   sont publics).
3. **Gitleaks en CI** — second scanner, sur l'historique complet.
4. **Expurgation des logs** (`core/logger.ts`) — appliquée à l'écriture, pas à
   l'appel : clés sensibles par nom (token, cookie, tenant, phone, email…) et
   motifs dans les chaînes libres (JWT, e-mails, téléphones). Testée (§55, §62).
5. **Grep du bundle au déploiement** — le workflow Pages échoue si un motif de
   jeton ou d'URL Turso apparaît dans `frontend/dist`.
6. **API fermée par défaut** — sans `API_ACCESS_TOKEN` configuré côté serveur,
   le Worker répond 503 : une erreur de déploiement ne peut pas ouvrir les
   données.

## Conventions pour données fictives

Obligatoires dans les fixtures, mocks, tests et captures d'écran (§26, §50) :

- e-mails : domaine `example.invalid` (RFC 2606, non routable) ;
- téléphones : plage `06 00 00 00 xx` ;
- noms, agences : inventés (« Agence Fictive Nice », « Camille Martin ») ;
- jetons d'exemple : préfixe manifeste (`EXEMPLE`, `remplacer-par-…`).

Une fixture se construit à partir d'une page réelle dont on **remplace tout le
contenu personnel** en conservant la structure — voir `tests/fixtures/README.md`.

## Données des tiers

Les annonces contiennent des données de professionnels et de particuliers
(téléphones, e-mails publiés volontairement avec l'annonce). Le projet :

- ne collecte que ce qui est **publiquement affiché**, sans contourner de
  protection (§21) ;
- ne les republie pas : elles restent dans la base privée, derrière le jeton ;
- ne les journalise pas (expurgation automatique) ;
- les efface avec la ligne quand l'annonce est purgée.

## Si un secret a fuité malgré tout

1. **Révoquer immédiatement** (Turso : `turso db tokens revoke` ; API : changer
   le jeton partout). La révocation prime sur le nettoyage : un commit poussé
   doit être considéré comme compromis même après réécriture d'historique.
2. Purger l'historique (`git filter-repo`) et forcer la poussée.
3. Chercher la cause : quelle barrière aurait dû l'attraper ? La renforcer et
   ajouter le cas au scanner.
