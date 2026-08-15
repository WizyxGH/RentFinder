# Confidentialité

Le dépôt est **public** (§26). Ce document décrit où vit chaque donnée
sensible, et les mécanismes qui empêchent structurellement une fuite — pas
seulement la vigilance de celui qui commite.

## Cartographie des données

| Donnée                                             | Où elle vit                                                    | Où elle ne va JAMAIS                                                                                  |
| -------------------------------------------------- | -------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------- |
| Profil locataire (nom, revenus, garant…) (§25)     | `localStorage` du navigateur ; ou `TENANT_*` dans `.env` local | dépôt, bundle                                                                                         |
| Points de référence — travail, gare (§20)          | `REFERENCE_*` dans `.env` local                                | dépôt ; l'interface n'affiche que des libellés neutres (« Travail : 17 min »), jamais les coordonnées |
| Identifiants privés (accès abonné BEP)             | `BEP_SUBSCRIBER_*` dans `.env` local                           | dépôt, logs (expurgés)                                                                                |
| Annonces collectées, statuts, contacts             | fichier SQLite local `data/local.db`                           | le dépôt (`data/` est gitignoré)                                                                      |
| Coordonnées des annonceurs (téléphones d'agences…) | SQLite local                                                   | logs (expurgation automatique), fixtures (anonymisées)                                                |

## Les barrières

1. **Projet 100% local** — la base est un fichier gitignoré, le serveur n'écoute
   que sur `127.0.0.1` : aucune donnée n'est publiée ni exposée sur le réseau.
2. **`.gitignore` strict** — `.env*`, `data/`, `*.db`, captures brutes. Testé
   par `tests/security/secrets.test.ts`.
3. **Scanner maison** (`pnpm check:secrets`) — JWT, clés AWS/GitHub, clés
   privées, affectations de secrets, e-mails réels, téléphones français.
   Bloquant en CI. Échappatoires : domaine `example.invalid`, plage
   `06 00 00 00 xx`, commentaire `secret-scan-ignore` pour un cas légitime.
   Le scanner n'imprime jamais la valeur détectée en entier.
4. **Gitleaks en CI** — second scanner, sur l'historique complet.
5. **Expurgation des logs** (`core/logger.ts`) — appliquée à l'écriture : clés
   sensibles par nom (token, cookie, password, tenant, phone, email…) et motifs
   dans les chaînes libres (JWT, e-mails, téléphones). Testée (§55, §62).

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
- ne les republie pas : elles restent dans la base locale, jamais publiée ;
- ne les journalise pas (expurgation automatique) ;
- les efface avec la ligne quand l'annonce est purgée.

## Si un secret a fuité malgré tout

1. **Révoquer/changer immédiatement** l'identifiant concerné (ex. mot de passe
   de l'accès abonné BEP). La révocation prime sur le nettoyage : un commit
   poussé est compromis même après réécriture d'historique.
2. Purger l'historique (`git filter-repo`) et forcer la poussée.
3. Chercher la cause : quelle barrière aurait dû l'attraper ? La renforcer et
   ajouter le cas au scanner.
