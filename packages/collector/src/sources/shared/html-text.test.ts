import * as cheerio from 'cheerio';
import { describe, expect, it } from 'vitest';
import { htmlToText } from './html-text.js';
import { cleanMultiline } from '../../normalization/text.js';

describe('cleanMultiline — texte long', () => {
  it('garde les retours à la ligne, réduit le reste', () => {
    expect(cleanMultiline('  Rue Smolett,  près du port. \n\n\n  Libre de suite.  ')).toBe(
      'Rue Smolett, près du port.\n\nLibre de suite.',
    );
  });

  it('normalise les fins de ligne Windows', () => {
    expect(cleanMultiline('Ligne 1\r\nLigne 2')).toBe('Ligne 1\nLigne 2');
  });

  it('décode les entités comme cleanText', () => {
    expect(cleanMultiline('Studio meubl&eacute;\n40&nbsp;m&sup2;')).toBe('Studio meublé\n40 m²');
  });
});

describe('htmlToText — description lue dans du HTML', () => {
  /**
   * Sans ce traitement, `.text()` rendait « Rue Smolett, près du portSalle de
   * douche neuveLibre de suite » : les mots se collaient et toute structure
   * disparaissait de la fiche.
   */
  it('transforme <br> et fins de bloc en retours à la ligne', () => {
    const $ = cheerio.load(
      '<div class="desc">Rue Smolett, près du port<br>Salle de douche neuve<p>Libre de suite</p></div>',
    );
    expect(htmlToText($, '.desc')).toBe(
      'Rue Smolett, près du port\nSalle de douche neuve\nLibre de suite',
    );
  });

  it('accepte un fragment déjà en main, pas seulement un sélecteur', () => {
    const $ = cheerio.load('<li class="card"><p class="d">Studio</p><p>7e étage</p></li>');
    expect(htmlToText($, $('.card').find('p') as cheerio.Cheerio<never>)).toBe('Studio');
  });

  it('laisse le document intact — le parseur continue de l’interroger', () => {
    const $ = cheerio.load('<div class="desc">Ligne 1<br>Ligne 2</div>');
    htmlToText($, '.desc');
    expect($('.desc').html()).toBe('Ligne 1<br>Ligne 2');
  });

  it('rend une chaîne vide quand le fragment est absent (§17)', () => {
    expect(htmlToText(cheerio.load('<p>rien</p>'), '.introuvable')).toBe('');
  });
});
