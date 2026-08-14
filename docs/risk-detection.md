# Détection des risques

Objectif (§19) : signaler les annonces susceptibles d'être des arnaques, avec
des **raisons affichées**, sans jamais bloquer ni masquer automatiquement.

## Philosophie

Un signal n'est pas une preuve. Un loyer bas peut être une vraie affaire ; un
bailleur à l'étranger peut être un expatrié honnête. Le score accumule des
signaux et **explique**, l'utilisateur décide. Exemple d'affichage :

```
Risque : 72/100
⚠ Loyer très inférieur au marché (5,8 €/m²)
⚠ Le bailleur déclare être à l'étranger
⚠ Remise des clés par courrier
· Bailleur non identifié nommément
```

Les faux positifs coûtent cher (une visite ratée) : les seuils sont donc
volontairement conservateurs.

## Signaux implémentés (`scoring/risk.ts`)

### Prix anormal

`loyer / surface` comparé à `referencePricePerSqm` (défaut : 20 €/m² pour
Nice) :

- < 40 % de la référence → +40 (« très inférieur au marché ») ;
- < 60 % → +20 ;
- sinon → raison positive « loyer cohérent », 0 point.

**La référence est une hypothèse de travail configurable**
(`PUBLIC_CONFIG.referencePricePerSqm`), pas une donnée officielle. Elle sert à
repérer les écarts grossiers. L'ajuster à partir des observations réelles ;
ne jamais la présenter comme un prix de marché constaté (§17).

### Incohérences internes

- < 9 m² par pièce annoncée → +15 (physiquement improbable).

### Contradictions entre sources

La fusion conserve toutes les divergences (§15), mais seuls les écarts
**disproportionnés** comptent ici — sinon toute annonce multi-diffusée serait
signalée (l'écart charges comprises / hors charges est ordinaire) :

- loyer : écart > 15 % entre sources → +10 ;
- surface : écart > 10 % → +10 ;
- adresse divergente (forme comparable) → +10.

### Identité vérifiable

- agence nommée → raison positive, 0 point ;
- ni agence, ni téléphone, ni e-mail → +15 ;
- coordonnées présentes mais bailleur non nommé → +5.

### Formulations d'arnaque

Motifs (insensibles aux accents, via forme `comparable`) relevés dans les
arnaques locatives courantes :

| Motif                                             | Points |
| ------------------------------------------------- | ------ |
| Western Union, mandat cash, PayPal « entre amis » | +35    |
| paiement demandé avant toute visite               | +35    |
| bailleur « actuellement à l'étranger »            | +30    |
| remise des clés par courrier / la poste / colis   | +30    |
| pièce d'identité exigée au premier contact        | +20    |

## Ajouter un signal

1. L'ajouter à `SUSPICIOUS_PATTERNS` (motif + libellé + points) ou comme règle
   dédiée si structurel.
2. Écrire le test dans `scoring.test.ts` : cas déclencheur **et** cas voisin
   légitime qui ne doit pas déclencher.
3. Vérifier sur les données de démo qu'aucune annonce ordinaire ne se met à
   sonner.

## Limites assumées

- Détection lexicale : une arnaque bien rédigée passera. Le score est une aide,
  pas un filtre de sécurité.
- La description est absente chez certaines sources (listes sans détail) : le
  signal correspondant est alors déclaré inconnu, pas considéré comme sain.
