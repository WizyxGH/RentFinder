import { describe, expect, it } from 'vitest';
import {
  parseArea,
  parseBedrooms,
  parseCharges,
  parseEmail,
  parseFlatShare,
  parseFurnished,
  parsePhone,
  parsePostalCode,
  parsePrice,
  parsePropertyType,
  parsePublishedAt,
  parseRooms,
} from './parse-listing-fields.js';

describe('parsePrice', () => {
  it('lit un loyer simple', () => {
    expect(parsePrice('690 €/mois')).toEqual({ amount: 690, chargesIncluded: null });
  });

  it('lit un loyer avec séparateur de milliers', () => {
    expect(parsePrice('1 890 €/mois').amount).toBe(1890);
  });

  it('détecte « charges comprises »', () => {
    expect(parsePrice('690 € charges comprises')).toEqual({
      amount: 690,
      chargesIncluded: true,
    });
    expect(parsePrice('690 € CC').chargesIncluded).toBe(true);
  });

  it('détecte « hors charges »', () => {
    expect(parsePrice('690 € hors charges').chargesIncluded).toBe(false);
    expect(parsePrice('690 € HC').chargesIncluded).toBe(false);
  });

  it('ne confond pas le montant des charges avec le loyer', () => {
    expect(parsePrice('690 € + 50 € de charges').amount).toBe(690);
  });

  it('rend null quand le prix est absent', () => {
    expect(parsePrice('Nous consulter')).toEqual({ amount: null, chargesIncluded: null });
    expect(parsePrice(null).amount).toBeNull();
    expect(parsePrice(undefined).amount).toBeNull();
  });

  it('rejette une valeur hors bornes plausibles', () => {
    // Un prix de vente n'est pas un loyer.
    expect(parsePrice('250 000 €').amount).toBeNull();
  });
});

describe('parseCharges', () => {
  it('extrait un montant de charges explicite', () => {
    expect(parseCharges('50 € de charges')).toBe(50);
    expect(parseCharges('Charges : 45 €')).toBe(45);
  });

  it('ne devine pas un montant sans mention de charges', () => {
    expect(parseCharges('690 €')).toBeNull();
  });
});

describe('parseArea', () => {
  it('lit une surface avec les différentes écritures de m²', () => {
    expect(parseArea('34 m²')).toBe(34);
    expect(parseArea('34 m2')).toBe(34);
    expect(parseArea('34m²')).toBe(34);
  });

  it('lit une surface décimale', () => {
    expect(parseArea('88,5 m²')).toBe(88.5);
  });

  it('exige une unité — un nombre nu n’est pas une surface', () => {
    expect(parseArea('34')).toBeNull();
    expect(parseArea('3 pièces')).toBeNull();
  });

  it('rejette une surface implausible', () => {
    expect(parseArea('2 m²')).toBeNull();
    expect(parseArea('5000 m²')).toBeNull();
  });
});

describe('parseRooms', () => {
  it('lit un nombre de pièces explicite', () => {
    expect(parseRooms('3 pièces')).toBe(3);
    expect(parseRooms('1 pièce')).toBe(1);
  });

  it('comprend les notations T et F', () => {
    expect(parseRooms('T2')).toBe(2);
    expect(parseRooms('F3')).toBe(3);
  });

  it('compte un studio comme une pièce', () => {
    expect(parseRooms('Studio meublé')).toBe(1);
  });

  it('rend null quand l’information est absente', () => {
    expect(parseRooms('Appartement lumineux')).toBeNull();
  });
});

describe('parseBedrooms', () => {
  it('lit un nombre de chambres', () => {
    expect(parseBedrooms('3 pièces • 2 chambres')).toBe(2);
    expect(parseBedrooms('1 chambre')).toBe(1);
  });

  it('rend null en l’absence de mention', () => {
    expect(parseBedrooms('3 pièces')).toBeNull();
  });
});

describe('parsePropertyType', () => {
  it('reconnaît les types courants', () => {
    expect(parsePropertyType('Appartement')).toBe('apartment');
    expect(parsePropertyType('Studio')).toBe('studio');
    expect(parsePropertyType('Maison de village')).toBe('house');
    expect(parsePropertyType('Villa')).toBe('house');
    expect(parsePropertyType('Loft')).toBe('loft');
    expect(parsePropertyType('T3')).toBe('apartment');
  });

  it('reconnaît les biens non résidentiels comme parking', () => {
    expect(parsePropertyType('Location Stationnement')).toBe('parking');
    expect(parsePropertyType('Box')).toBe('parking');
    expect(parsePropertyType('Garage fermé')).toBe('parking');
  });

  it('rend unknown plutôt que de supposer', () => {
    expect(parsePropertyType('')).toBe('unknown');
    expect(parsePropertyType(null)).toBe('unknown');
  });
});

describe('parseFurnished', () => {
  it('distingue meublé et non meublé', () => {
    expect(parseFurnished('Meublé')).toBe(true);
    expect(parseFurnished('Non meublé')).toBe(false);
  });

  it('« non meublé » n’est jamais lu comme « meublé »', () => {
    // Le mot « meublé » est contenu dans « non meublé » : l'ordre des tests
    // dans le parser est donc significatif.
    expect(parseFurnished('Appartement non meublé avec balcon')).toBe(false);
  });

  it('rend null quand rien n’est précisé', () => {
    expect(parseFurnished('Appartement lumineux')).toBeNull();
  });
});

describe('parsePostalCode', () => {
  it('extrait un code postal', () => {
    expect(parsePostalCode('NICE (06000)')).toBe('06000');
    expect(parsePostalCode('06 300 Nice')).toBeNull();
  });
});

describe('parsePhone', () => {
  // Les numéros de test appartiennent à la plage fictive `06 00 00 00 xx`
  // documentée dans tests/fixtures/README.md, afin qu'aucun numéro réel ne
  // figure dans un dépôt public (§26).
  it('normalise les formats français vers E.164', () => {
    expect(parsePhone('06 00 00 00 12')).toBe('+33600000012');
    expect(parsePhone('06.00.00.00.12')).toBe('+33600000012');
    expect(parsePhone('0600000012')).toBe('+33600000012');
    expect(parsePhone('+33 6 00 00 00 12')).toBe('+33600000012');
    expect(parsePhone('0033600000012')).toBe('+33600000012');
  });

  it('produit la même clé quel que soit le format — indispensable au dédoublonnage', () => {
    expect(parsePhone('06 00 00 00 12')).toBe(parsePhone('+33600000012'));
  });

  it('rend null sur un numéro invalide', () => {
    expect(parsePhone('12345')).toBeNull();
    expect(parsePhone('Nous appeler')).toBeNull();
    expect(parsePhone(null)).toBeNull();
  });
});

describe('parseEmail', () => {
  it('extrait et normalise une adresse', () => {
    expect(parseEmail('Contact : Agence@Example.invalid')).toBe('agence@example.invalid');
  });

  it('rend null en l’absence d’adresse', () => {
    expect(parseEmail('Nous contacter via le formulaire')).toBeNull();
  });
});

/**
 * Tests de non-régression (§51). NE JAMAIS SUPPRIMER NI DÉSACTIVER.
 */
describe('non-régression — surfaces en m²', () => {
  it('lit une surface suivie d’un espace', () => {
    // Bug corrigé le 2026-08-14 : le motif se terminait par `\b`, or « ² »
    // n'est pas un caractère de mot — aucune frontière ne pouvait exister
    // entre « ² » et l'espace suivant. Toutes les surfaces en m² étaient
    // silencieusement lues comme absentes.
    expect(parseArea('34 m² • 1 pièce')).toBe(34);
    expect(parseArea('88,5 m² • 4 pièces')).toBe(88.5);
  });

  it('lit une surface en fin de chaîne', () => {
    expect(parseArea('Appartement de 34 m²')).toBe(34);
  });

  it('ne lit pas « 34 m25 » comme 34 m²', () => {
    expect(parseArea('34 m25')).toBeNull();
  });
});

describe('parsePublishedAt', () => {
  // Instant de référence figé : aucun test ne dépend de l'heure réelle (§59).
  const now = Date.parse('2026-08-14T12:00:00.000Z');

  it('interprète les dates relatives en minutes et heures', () => {
    expect(parsePublishedAt('il y a 4 min', now)).toBe('2026-08-14T11:56:00.000Z');
    expect(parsePublishedAt('il y a 2 heures', now)).toBe('2026-08-14T10:00:00.000Z');
  });

  it('interprète les dates relatives en jours', () => {
    expect(parsePublishedAt('il y a 3 jours', now)).toBe('2026-08-11T12:00:00.000Z');
  });

  it('interprète « hier » et « aujourd’hui »', () => {
    expect(parsePublishedAt('hier', now)).toBe('2026-08-13T12:00:00.000Z');
    expect(parsePublishedAt('aujourd’hui', now)).toBe('2026-08-14T12:00:00.000Z');
  });

  it('interprète les dates absolues', () => {
    expect(parsePublishedAt('12/08/2026', now)).toBe('2026-08-12T00:00:00.000Z');
    expect(parsePublishedAt('2026-08-12', now)).toBe('2026-08-12T00:00:00.000Z');
  });

  it('rend null sur un texte non interprétable', () => {
    expect(parsePublishedAt('récemment', now)).toBeNull();
    expect(parsePublishedAt(null, now)).toBeNull();
  });
});

describe('parseFlatShare (§17 — colocation)', () => {
  it('détecte une offre en colocation', () => {
    expect(parseFlatShare('T4 en colocation – Bd Fictif')).toBe(true);
    expect(parseFlatShare('Chambre en coloc meublée')).toBe(true);
  });

  it('distingue « colocation possible » (logement entier)', () => {
    expect(parseFlatShare('Bail mobilité ou étudiant (Colocation possible)')).toBe(false);
    expect(parseFlatShare('colocation acceptée')).toBe(false);
  });

  it('rend null quand le texte ne dit rien', () => {
    expect(parseFlatShare('Studio meublé centre-ville')).toBeNull();
    expect(parseFlatShare('')).toBeNull();
  });
});
