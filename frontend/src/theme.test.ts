import { beforeEach, describe, expect, it } from 'vitest';
import { applyTheme, readTheme } from './theme.js';

describe('applyTheme', () => {
  beforeEach(() => {
    document.documentElement.removeAttribute('data-theme');
    localStorage.clear();
  });

  /**
   * L'ATTRIBUT EST CE QUI FAIT BASCULER LES COULEURS, et rien d'autre.
   * `light-dark()` disparaît à la compilation : Lightning CSS le remplace par
   * un couple de variables qu'il ne bascule qu'aux sélecteurs où il voit un
   * `color-scheme` écrit dans la feuille de style. Un `style.colorScheme` posé
   * en JavaScript lui est invisible — c'est ce qui rendait les boutons
   * « Clair » et « Sombre » inertes.
   */
  it('pose l’attribut que le CSS sait lire', () => {
    applyTheme('dark');
    expect(document.documentElement.getAttribute('data-theme')).toBe('dark');
    applyTheme('light');
    expect(document.documentElement.getAttribute('data-theme')).toBe('light');
  });

  it('retire l’attribut en automatique, pour laisser l’appareil décider', () => {
    applyTheme('dark');
    applyTheme('auto');
    expect(document.documentElement.hasAttribute('data-theme')).toBe(false);
  });

  it('se souvient du choix, sauf de « automatique » qui est le défaut', () => {
    applyTheme('dark');
    expect(readTheme()).toBe('dark');
    applyTheme('auto');
    expect(readTheme()).toBe('auto');
  });
});
