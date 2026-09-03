import { describe, expect, it } from 'vitest';
import {
  parseArea,
  parseBedrooms,
  parseCharges,
  parseEmail,
  parseFlatShare,
  parseFurnished,
  parseDpe,
  extractFeatures,
  extractStreetAddress,
  isShortTermStudentLease,
  parseAvailableAt,
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

  it('ne prend pas un parking MENTIONNÉ pour le bien lui-même', () => {
    // Relevés tels quels : 22 fiches sur 59 typées « parking » au 2026-09-03
    // étaient en fait des logements, donc écartées de la recherche sans trace.
    expect(parsePropertyType('Studette de 20m² avec parking')).toBe('studio');
    expect(parsePropertyType('Deux pièces de 45m² avec terrasse et parking')).toBe('apartment');
    expect(parsePropertyType('NICE Mont Boron - Studio avec terrasse et garage fermé')).toBe(
      'studio',
    );
    expect(parsePropertyType('Maison 6 Pièces - Piscine - Garage - Vue Mer')).toBe('house');
    expect(parsePropertyType('2 PIECES AVEC PARKING - DEBUT SAINT ROCH')).toBe('apartment');
  });

  it('rend unknown plutôt que de supposer', () => {
    expect(parsePropertyType('')).toBe('unknown');
    expect(parsePropertyType(null)).toBe('unknown');
  });
});

describe('parseDpe', () => {
  it('extrait la classe énergétique sous ses formes courantes', () => {
    expect(parseDpe('DPE : D')).toBe('D');
    expect(parseDpe('Classe énergie C')).toBe('C');
    expect(parseDpe('étiquette énergétique B')).toBe('B');
    expect(parseDpe('C')).toBe('C'); // valeur brute d'un attribut Orpi
  });

  it('rend null sans mention fiable (§17)', () => {
    expect(parseDpe('bel appartement lumineux')).toBeNull();
    expect(parseDpe('')).toBeNull();
    expect(parseDpe(null)).toBeNull();
  });
});

describe('extractFeatures', () => {
  it('relève les atouts mentionnés dans le texte', () => {
    const features = extractFeatures('T2 au 3e étage avec ascenseur, balcon et cave. Proche mer.');
    expect(features).toContain('3e étage');
    expect(features).toContain('Ascenseur');
    expect(features).toContain('Balcon');
    expect(features).toContain('Cave');
  });

  it('utilise les attributs structurés (Orpi) et dédoublonne', () => {
    const features = extractFeatures('appartement avec ascenseur', {
      etage: '2',
      ascenseur: '1',
      nbTerrasses: '1',
    });
    expect(features).toContain('2e étage');
    expect(features).toContain('Ascenseur');
    expect(features).toContain('Terrasse');
    expect(features.filter((f) => f === 'Ascenseur')).toHaveLength(1);
  });

  it('ne relève rien quand rien n’est mentionné (§17)', () => {
    expect(extractFeatures('joli logement')).toEqual([]);
    expect(extractFeatures(null)).toEqual([]);
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

describe('extractStreetAddress (§20 — adresse en tête de description)', () => {
  it('extrait une adresse de rue en début de description', () => {
    expect(extractStreetAddress('22-24 Avenue de la Californie 06200 NICE. Studio…')).toBe(
      '22-24 Avenue de la Californie',
    );
    expect(extractStreetAddress('Situé 11 boulevard Gambetta, bel appartement')).toBe(
      '11 boulevard Gambetta',
    );
  });

  it('n’extrait RIEN d’une adresse citée loin dans le texte (voisinage, agence)', () => {
    expect(
      extractStreetAddress(
        'Bel appartement lumineux au calme, traversant, refait à neuf, très proche de l’avenue Jean Médecin',
      ),
    ).toBeNull();
  });

  it('rend null sans adresse', () => {
    expect(extractStreetAddress('Appartement 3 pièces au 2e étage')).toBeNull();
    expect(extractStreetAddress(null)).toBeNull();
  });

  it('accepte une voie SANS numéro quand elle occupe tout un segment', () => {
    // Les agences niçoises écrivent presque toujours la voie sans numéro :
    // exiger un numéro laissait 86 fiches sur 93 sans adresse.
    expect(extractStreetAddress('Rue Smolett, tout proche du port et de la gare')).toBe(
      'Rue Smolett',
    );
    expect(
      extractStreetAddress('Vieille ville / vieux Nice, Rue Francis Gallo, au 4ème étage'),
    ).toBe('Rue Francis Gallo');
  });

  it('lit une accroche composée au TIRET, comme les agences l’écrivent', () => {
    // Orpi, Century 21 et D'Azur composent presque tous ainsi. Relevé tel quel.
    expect(extractStreetAddress('NICE CENTRE - RUE DE PARIS - 3 PIECES - PROCHE GARE')).toBe(
      'RUE DE PARIS',
    );
    expect(extractStreetAddress('Pasteur - rue Raoul Lesueur. Au 5ème étage avec ascenseur')).toBe(
      'rue Raoul Lesueur',
    );
    expect(extractStreetAddress('Nice Libération – avenue de Villermont – 4 pièces')).toBe(
      'avenue de Villermont',
    );
  });

  it('ne coupe pas une voie sur son tiret interne', () => {
    expect(extractStreetAddress('Nice Est - Rue Jean-Jaurès - studio')).toBe('Rue Jean-Jaurès');
  });

  it('refuse une voie noyée dans une phrase — ce sont les alentours (§17)', () => {
    expect(
      extractStreetAddress('Studio calme, entre la porte fausse et la place Rossetti'),
    ).toBeNull();
    expect(extractStreetAddress('Charmant studio proche de la promenade des Anglais')).toBeNull();
  });

  it('s’arrête au retour à la ligne, qui sépare deux idées', () => {
    // Sans cela l'adresse emportait la phrase suivante :
    // « rue Dr Barety Dans résidence sécurisée ».
    expect(extractStreetAddress('Carré d’or - rue Dr Barety\nDans résidence sécurisée')).toBe(
      'rue Dr Barety',
    );
  });

  it('n’emporte pas le nom de résidence entre guillemets', () => {
    expect(extractStreetAddress('97 boulevard Carnot " Le President"')).toBe('97 boulevard Carnot');
  });

  it('refuse une adresse qui a mordu sur la phrase suivante', () => {
    // Relevés tels quels : 14 adresses en base emportaient le début du texte
    // qui les suit, faute de ponctuation entre les deux.
    expect(extractStreetAddress('1 rue de Orestis Très bel appartement de 40 m²')).toBeNull();
    expect(extractStreetAddress('33 ROUTE DE TURIN Appartement rénové')).toBeNull();
  });

  it('ne prend pas une DATE pour un numéro de voie', () => {
    // « disponible 06/2027 Boulevard Napoléon III » donnait « 2027 Boulevard
    // Napoléon III » : un millésime promu numéro de rue.
    expect(extractStreetAddress('Disponible 06/2027 Boulevard Napoleon III')).toBeNull();
    // L'intervalle de numéros, lui, reste lu.
    expect(extractStreetAddress('22-24 Avenue de la Californie, Nice')).toBe(
      '22-24 Avenue de la Californie',
    );
  });

  it('ne prend pas « Place de parking » pour une adresse', () => {
    expect(extractStreetAddress('Place de parking, cave, ascenseur')).toBeNull();
  });

  it('n’emporte pas la phrase qui suit une voie sans ponctuation', () => {
    // Relevés tels quels : sans garde, l'adresse retenue était
    // « rue Dr Barety Dans résidence sécurisée » — ingéocodable, et fausse.
    expect(
      extractStreetAddress('Carré d’Or - rue Dr Barety Dans résidence sécurisée, parking'),
    ).toBeNull();
    expect(
      extractStreetAddress('NICE VAUBAN - AVENUE MARECHAL VAUBAN Dans une résidence sécurisée'),
    ).toBeNull();
  });
});

describe('isShortTermStudentLease (§17 — bail de neuf mois)', () => {
  it('reconnaît le bail septembre → juin, quelle qu’en soit la tournure', () => {
    // Relevés tels quels sur trois fiches Dinamy le 2026-09-03.
    expect(isShortTermStudentLease('Etudiant de Septembre à juin au prix de 600 € cc')).toBe(true);
    expect(isShortTermStudentLease('Location saisonnière et étudiante de septembre à juin')).toBe(
      true,
    );
    expect(isShortTermStudentLease('Location Etudiante et saisonnier en juillet aout.')).toBe(true);
    expect(isShortTermStudentLease('Bail de 9 mois, meublé')).toBe(true);
  });

  it('laisse passer un logement à l’année, même « idéal étudiant »', () => {
    expect(isShortTermStudentLease('Studio idéal étudiant, libre de suite')).toBe(false);
    expect(isShortTermStudentLease('Disponible à partir de septembre')).toBe(false);
    expect(isShortTermStudentLease(null)).toBe(false);
  });
});

describe('parseAvailableAt (§17 — disponibilité)', () => {
  const now = Date.parse('2026-08-14T12:00:00.000Z');

  it('interprète « immédiatement » et équivalents', () => {
    expect(parseAvailableAt('Disponible immédiatement', now)).toBe('2026-08-14T12:00:00.000Z');
    expect(parseAvailableAt('libre de suite', now)).toBe('2026-08-14T12:00:00.000Z');
  });

  it('interprète les dates textuelles françaises avec année', () => {
    expect(parseAvailableAt('DISPONIBLE LE 1ER SEPTEMBRE 2027', now)).toBe(
      '2027-09-01T00:00:00.000Z',
    );
    expect(parseAvailableAt('disponible le 15 mars 2027', now)).toBe('2027-03-15T00:00:00.000Z');
  });

  it('sans année, choisit la prochaine occurrence', () => {
    // Octobre est devant nous (2026), février est derrière (→ 2027).
    expect(parseAvailableAt('disponible le 1er octobre', now)).toBe('2026-10-01T00:00:00.000Z');
    expect(parseAvailableAt('disponible le 15 février', now)).toBe('2027-02-15T00:00:00.000Z');
  });

  it('garde les formats numériques', () => {
    expect(parseAvailableAt('01/09/2026', now)).toBe('2026-09-01T00:00:00.000Z');
  });

  it('rend null sans indication exploitable', () => {
    expect(parseAvailableAt('nous consulter', now)).toBeNull();
    expect(parseAvailableAt(null, now)).toBeNull();
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
