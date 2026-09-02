import { describe, expect, it } from 'vitest';
import {
  UNKNOWN,
  formatAddress,
  formatAge,
  formatDay,
  formatDistrict,
  formatPhone,
  formatPostalAddress,
  formatTime,
  telHref,
} from './format.js';

describe('formatAddress', () => {
  it('recapitalise une adresse en majuscules', () => {
    expect(formatAddress('260 BOULEVARD DE LA MADELEINE')).toBe('260 Boulevard de la Madeleine');
    expect(formatAddress('6-8 RUE ABBE SALVETTI')).toBe('6-8 Rue Abbe Salvetti');
  });

  it('capitalise une adresse en minuscules', () => {
    expect(formatAddress('144 rue France')).toBe('144 Rue France');
    expect(formatAddress('3 rue André Poulan')).toBe('3 Rue André Poulan');
  });

  it('retire le code postal et la ville collés à la voie (harmonisation)', () => {
    expect(formatAddress('260 BOULEVARD DE LA MADELEINE 06000 NICE')).toBe(
      '260 Boulevard de la Madeleine',
    );
    expect(formatAddress('5 Avenue Jean Médecin, 06000 Nice, France')).toBe(
      '5 Avenue Jean Médecin',
    );
  });

  it('déplie davantage d’abréviations de voies', () => {
    expect(formatAddress('Pl Masséna')).toBe('Place Masséna');
    expect(formatAddress('Ch de Fabron')).toBe('Chemin de Fabron');
    expect(formatAddress('Rte de Turin')).toBe('Route de Turin');
  });

  it('déplie les abréviations de voies', () => {
    expect(formatAddress('Bd Gorbella')).toBe('Boulevard Gorbella');
    expect(formatAddress('26/30 BLD NAPOLEON III')).toBe('26/30 Boulevard Napoleon III');
  });

  it('garde chiffres romains et ordinaux cohérents', () => {
    expect(formatAddress('5 AVENUE DU ROI ALBERT 1ER')).toBe('5 Avenue du Roi Albert 1er');
  });

  it('recolle les plages de numéros et les espaces', () => {
    expect(formatAddress('37 - 39  RUE CLEMENT ROASSAL')).toBe('37-39 Rue Clement Roassal');
  });

  it('laisse minuscules particules, bis et élisions', () => {
    expect(formatAddress('77bis Boulevard Gambetta')).toBe('77bis Boulevard Gambetta');
    expect(formatAddress("PLACE DE L'ILE DE BEAUTE")).toBe('Place de l’Ile de Beaute');
  });

  it('ne touche pas à une adresse déjà propre', () => {
    expect(formatAddress('17 Boulevard Général Louis Delfino')).toBe(
      '17 Boulevard Général Louis Delfino',
    );
  });

  it('affiche le marqueur « inconnu » si absente', () => {
    expect(formatAddress(null)).toBe(UNKNOWN);
    expect(formatAddress('  ')).toBe(UNKNOWN);
  });
});

describe('formatPhone', () => {
  it('rend la forme française usuelle, par paires', () => {
    expect(formatPhone('0600000012')).toBe('06 00 00 00 12');
    expect(formatPhone('06.00.00.00.34')).toBe('06 00 00 00 34');
  });

  it('ramène l’international au format national', () => {
    expect(formatPhone('+33600000012')).toBe('06 00 00 00 12');
    expect(formatPhone('0033600000012')).toBe('06 00 00 00 12');
  });

  it('laisse INTACT ce qui n’est pas un numéro français (§17)', () => {
    // Mieux vaut un format inhabituel qu'un numéro déformé.
    expect(formatPhone('+41 22 000 00 00')).toBe('+41 22 000 00 00');
    expect(formatPhone('numéro sur demande')).toBe('numéro sur demande');
  });

  it('signale l’absence plutôt que de rendre une chaîne vide', () => {
    expect(formatPhone(null)).toBe(UNKNOWN);
    expect(formatPhone('   ')).toBe(UNKNOWN);
  });
});

describe('telHref', () => {
  it('retire espaces et ponctuation, que certains téléphones refusent', () => {
    expect(telHref('06 00 00 00 12')).toBe('tel:0600000012');
    expect(telHref('+33 6.00.00.00.12')).toBe('tel:+33600000012');
  });
});

describe('formatAge', () => {
  const NOW = Date.parse('2026-09-02T12:00:00.000Z');
  const ago = (minutes: number): string => new Date(NOW - minutes * 60_000).toISOString();

  it('arrondit VERS LE BAS : 90 minutes ne font pas deux heures', () => {
    expect(formatAge(ago(90), NOW)).toBe('il y a 1 h');
    expect(formatAge(ago(59), NOW)).toBe('il y a 59 min');
  });

  it('garde les heures jusqu’à deux jours, plus parlant que « hier »', () => {
    // 20 h devenait « hier », ce qui faisait paraître vieille une annonce
    // encore fraîche — décisif quand quelques heures font la différence.
    expect(formatAge(ago(20 * 60), NOW)).toBe('il y a 20 h');
    expect(formatAge(ago(30 * 60), NOW)).toBe('il y a 30 h');
    expect(formatAge(ago(47 * 60), NOW)).toBe('il y a 47 h');
  });

  it('passe aux jours au-delà', () => {
    expect(formatAge(ago(48 * 60), NOW)).toBe('il y a 2 j');
    expect(formatAge(ago(5 * 24 * 60), NOW)).toBe('il y a 5 j');
  });

  it('signale l’instant et l’absence de date', () => {
    expect(formatAge(ago(0), NOW)).toBe('à l’instant');
    expect(formatAge(null, NOW)).toBe(UNKNOWN);
  });
});

describe('formatDay', () => {
  // 14:00 heure locale, pour que les décalages ne fassent pas changer de jour.
  const now = new Date(2026, 8, 2, 14, 0).getTime();

  it('nomme aujourd’hui et hier plutôt qu’une date', () => {
    expect(formatDay(new Date(2026, 8, 2, 9, 30).toISOString(), now)).toBe("Aujourd'hui");
    expect(formatDay(new Date(2026, 8, 1, 9, 30).toISOString(), now)).toBe('Hier');
  });

  it('compare des JOURS, pas des écarts d’heures', () => {
    // 23 h 50 la veille, soit 14 h plus tôt : « Hier », jamais « Aujourd'hui ».
    expect(formatDay(new Date(2026, 8, 1, 23, 50).toISOString(), now)).toBe('Hier');
    // 00 h 10 le jour même, soit 14 h plus tôt aussi.
    expect(formatDay(new Date(2026, 8, 2, 0, 10).toISOString(), now)).toBe("Aujourd'hui");
  });

  it('écrit la date en toutes lettres au-delà', () => {
    const label = formatDay(new Date(2026, 7, 30, 10, 0).toISOString(), now);
    expect(label).toContain('août');
    expect(label).toContain('30');
  });
});

describe('formatTime', () => {
  it('donne l’heure seule, la date étant portée par le jour', () => {
    expect(formatTime(new Date(2026, 8, 2, 14, 32).toISOString())).toBe('14:32');
  });
});

describe('formatAddress — débordements de description', () => {
  // Plusieurs sources déversent le début de l'annonce dans le champ adresse.
  it('coupe la description accolée sans espace à la voie', () => {
    expect(formatAddress("10 Avenue Sainte-MargueriteAu sein d'une résidence de s")).toBe(
      '10 Avenue Sainte-Marguerite',
    );
  });

  it('coupe au premier mot qui ne peut pas appartenir à une voie', () => {
    expect(formatAddress('1 boulevard Lech Walesa Joli studio meublé')).toBe(
      '1 Boulevard Lech Walesa',
    );
    expect(formatAddress('84 rue Barberis Très bel appartement de')).toBe('84 Rue Barberis');
  });

  it('n’ampute pas une voie dont les accents ressemblent à une majuscule', () => {
    // `[A-ZÀ-Ÿ]` couvre aussi les minuscules accentuées : « Montée » se
    // faisait couper après « Mont ».
    expect(formatAddress('7 montée du coteau')).toBe('7 Montée du Coteau');
    expect(formatAddress('17 Boulevard Général Louis Delfino')).toBe(
      '17 Boulevard Général Louis Delfino',
    );
  });

  it('garde en minuscules la conjonction qui ouvre une plage de numéros', () => {
    expect(formatAddress('7 ET 9 RUE PAPON')).toBe('7 et 9 Rue Papon');
    expect(formatAddress('11 ET 11 BIS RUE MEYERBEER')).toBe('11 et 11 bis Rue Meyerbeer');
  });
});

describe('formatDistrict', () => {
  it('capitalise et retire le tiret de liste', () => {
    expect(formatDistrict('EST ACROPOLIS')).toBe('Est Acropolis');
    expect(formatDistrict('- BELLET')).toBe('Bellet');
    expect(formatDistrict('VIEUX NICE')).toBe('Vieux Nice');
  });

  it('rend N/A pour un quartier absent ou vide', () => {
    expect(formatDistrict(null)).toBe(UNKNOWN);
    expect(formatDistrict('  -  ')).toBe(UNKNOWN);
  });
});

describe('formatPostalAddress — format Google Maps', () => {
  it('écrit du plus précis au plus général, séparé par des virgules', () => {
    expect(
      formatPostalAddress({ address: '34 AVENUE AUBER', postalCode: '06000', city: 'nice' }),
    ).toBe('34 Avenue Auber, 06000 Nice');
  });

  it('omet la voie inconnue plutôt que d’inventer (§17)', () => {
    expect(formatPostalAddress({ address: null, postalCode: '06000', city: 'nice' })).toBe(
      '06000 Nice',
    );
  });

  it('situe par le quartier à défaut de voie', () => {
    expect(
      formatPostalAddress({
        address: null,
        postalCode: '06300',
        city: 'nice',
        district: 'VIEUX NICE',
      }),
    ).toBe('Vieux Nice, 06300 Nice');
  });

  it('ne garde pas le quartier quand la voie est connue : Maps n’en met pas', () => {
    expect(
      formatPostalAddress({
        address: '19 RUE MICHELET',
        postalCode: '06100',
        city: 'nice',
        district: 'GAMBETTA',
      }),
    ).toBe('19 Rue Michelet, 06100 Nice');
  });
});
