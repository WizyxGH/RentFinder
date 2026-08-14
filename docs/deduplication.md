# Dédoublonnage et fusion

Fonctionnalité majeure du projet (§13) : une annonce présente sur quatre sites
doit produire **une seule fiche**, qui conserve les quatre occurrences et leurs
URLs d'origine.

## Vue d'ensemble

```
occurrences (toutes sources, actives + possiblyInactive)
   ↓  blockingKeys()        clés grossières → paires candidates (anti-O(n²))
   ↓  similarity()          score multi-signaux + verdict par paire
   ↓  union-find            fermeture transitive des paires "duplicate"
   ↓  mergeGroup()          une fiche par groupe, champs MergedField
AggregatedListing[]
```

Le regroupement porte sur **tout le corpus vivant**, pas seulement les annonces
du run : une annonce collectée aujourd'hui peut être le doublon d'une annonce
vue la semaine dernière sur une autre source.

## Étage 1 — blocage (`dedupe.ts`)

Comparer chaque paire coûterait O(n²) (§56). On ne compare que les annonces
partageant au moins une clé grossière :

- `phone:` / `email:` — normalisés (E.164, minuscules) par la normalisation ;
- `ref:` — référence d'agence (≥ 4 caractères) ;
- `area:{ville}:{tranche de 5 m²}` et `price:{ville}:{tranche de 50 €}` — avec
  chevauchement sur la tranche voisine pour ne pas rater les frontières.

Générosité voulue : rater une paire candidate produit un doublon visible, ce
qu'on cherche précisément à éviter. Garde-fou : un bucket > 200 entrées est
ignoré (dégénéré), et le nombre de comparaisons réelles est retourné
(`comparisonCount`) pour suivi de coût.

## Étage 2 — similarité (`similarity.ts`)

### D'abord les vetos (désaccords rédhibitoires)

Fusionner deux logements distincts est **plus grave** qu'afficher un doublon :
cela fait disparaître une annonce réelle de la liste (§14). Donc, quels que
soient les autres signaux, la fusion est interdite si :

- villes différentes ;
- surfaces incompatibles (> max(2 m², 5 %)) ;
- loyers incompatibles (> max(30 €, 6 %)) — tolérance pour charges comprises/HC ;
- nombre de pièces différent ;
- positions GPS distantes de plus de 500 m.

Cas d'école couvert par un test : une même agence loue deux studios différents
dans le même immeuble — même téléphone, surfaces distinctes → **distinct**.

### Puis l'accumulation de points

| Signal                                              | Points |           |
| --------------------------------------------------- | ------ | --------- |
| même téléphone                                      | 40     | très fort |
| même e-mail                                         | 35     | très fort |
| même référence d'agence (entre sources différentes) | 35     | très fort |
| même adresse (forme comparable)                     | 30     | très fort |
| GPS ≤ 80 m                                          | 30     | très fort |
| loyer équivalent                                    | 18     | fort      |
| surface équivalente                                 | 18     | fort      |
| même agence                                         | 12     | fort      |
| titres proches (Jaccard > 0,4)                      | ≤ 15   | fort      |
| descriptions proches (Jaccard > 0,5)                | ≤ 12   | fort      |
| même nombre de pièces                               | 6      | faible    |
| même code postal                                    | 4      | faible    |

Verdicts : ≥ 70 → `duplicate` ; ≥ 45 → `ambiguous` ; sinon `distinct`.

Un signal **absent ne compte pas** : deux annonces sans téléphone ne se
ressemblent pas davantage pour autant.

### Les ambigus ne fusionnent pas

`ambiguous` est conservé (paire + score + signaux dans
`DuplicateGroup.ambiguousPairs`) mais **non fusionné** par défaut
(`mergeAmbiguous: false`). Deux T2 de 34 m² à 690 € à Nice existent
probablement en double exemplaire réel ; sans signal fort, prudence.

## Étage 3 — fusion (`merge.ts`)

- La source **principale** d'un groupe est l'occurrence la plus complète
  (comptage de champs renseignés, coordonnées de contact pondérées ×2), puis la
  plus ancienne à égalité.
- Chaque champ devient un `MergedField<T>` : valeur retenue + source +
  `conflicts[]`. **Toute divergence est conservée**, même 690 € vs 715 € —
  c'est souvent l'écart charges comprises/HC, et l'utilisateur a le droit de le
  voir (§15). La question « cet écart est-il louche ? » relève du score de
  risque, qui applique ses propres seuils (15 % loyer, 10 % surface).
- Les contacts sont **complétés** entre sources : téléphone de l'une, référence
  de l'autre, nom du conseiller d'une troisième, avec `providedBy` (§15, §21).
- L'identifiant du groupe suit l'occurrence **la plus anciennement vue** : il
  reste stable quand une nouvelle source rejoint le groupe.
- Cycle de vie du groupe = le plus optimiste des occurrences : tant qu'une
  source voit encore l'annonce, le logement est disponible (§32).

## Vérifier le dédoublonnage d'une nouvelle source (§47)

1. Ajouter aux tests de la source un cas « même annonce que la fixture d'une
   autre source » et vérifier le verdict `duplicate`.
2. Ajouter un cas « annonce voisine mais distincte » et vérifier `distinct`.
3. Après le premier run réel, inspecter les groupes multi-sources :
   `SELECT group_id, COUNT(*) FROM occurrences GROUP BY group_id HAVING COUNT(*) > 1;`
