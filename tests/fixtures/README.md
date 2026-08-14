# Fixtures de test

Ces fichiers alimentent les tests de parsing des scrapers (§50). Ils permettent
de tester `HTML → parser → données normalisées` **sans jamais appeler un site
distant**, ce qui rend la suite déterministe et exécutable hors ligne (§59).

## Règles impératives

1. **Aucune donnée personnelle réelle.** Le dépôt est public (§26). Les noms,
   téléphones, e-mails et adresses présents dans les fixtures sont **fictifs**.
   Les numéros utilisent la plage `06 00 00 00 xx`, les e-mails le domaine
   `example.invalid`, réservé par la RFC 2606 et non routable.

2. **La structure HTML doit rester fidèle.** C'est tout l'intérêt d'une fixture :
   elle reproduit l'imbrication, les classes et les entités du site réel, telles
   qu'observées à la date indiquée en commentaire en tête de fichier. Seul le
   *contenu* est remplacé.

3. **Ne jamais reformater une fixture.** Prettier les ignore volontairement
   (voir `.prettierignore`) : un reformatage changerait les espaces significatifs
   et invaliderait le test qu'elle sert à écrire.

## Comment produire une nouvelle fixture

```bash
# 1. Récupérer une page réelle (une seule requête, User-Agent honnête)
curl -A "RentFinderBot/0.1" https://exemple.fr/annonces > /tmp/page.html

# 2. La réduire à 3–6 annonces représentatives, remplacer toute donnée
#    personnelle par une valeur fictive, puis l'enregistrer ici.

# 3. Écrire le test correspondant à côté du parser.
```

Prévoir systématiquement une seconde fixture « dégradée » couvrant les cas
limites exigés par le §50 : champ manquant, prix inhabituel, surface absente,
structure légèrement modifiée.

## Inventaire

| Fixture | Source | Observée le | Contenu |
| --- | --- | --- | --- |
| `laforet/nice-page1.html` | laforet.com | 2026-08-14 | Page nominale, 5 annonces |
| `laforet/nice-degraded.html` | laforet.com | 2026-08-14 | Cas limites : prix absent, surface absente, format de prix inhabituel, balisage modifié |
