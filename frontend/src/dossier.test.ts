import { describe, expect, it } from 'vitest';
import { DOSSIER_SLOTS, displayName, slotOf, slotPrefix } from './dossier.js';

describe('liste des pièces', () => {
  it('couvre les quatre justificatifs du décret, pour le locataire ET le garant', () => {
    const tenant = DOSSIER_SLOTS.filter((s) => !s.forGuarantor).map((s) => s.id);
    expect(tenant).toEqual(['identite', 'domicile', 'situation', 'ressources']);
    // Le garant fournit les mêmes, plus l'acte de cautionnement.
    const guarantor = DOSSIER_SLOTS.filter((s) => s.forGuarantor).map((s) => s.id);
    expect(guarantor).toEqual([
      'garant-identite',
      'garant-domicile',
      'garant-situation',
      'garant-ressources',
      'garant-caution',
    ]);
  });

  it('n’a aucun identifiant en double', () => {
    const ids = DOSSIER_SLOTS.map((s) => s.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});

describe('rangement par préfixe', () => {
  it('retrouve l’emplacement d’une pièce rangée', () => {
    const name = `${slotPrefix('ressources')}bulletin-juillet.pdf`;
    expect(slotOf(name)).toBe('ressources');
    expect(displayName(name)).toBe('bulletin-juillet.pdf');
  });

  it('laisse non classée une pièce sans préfixe', () => {
    // Les pièces déposées avant le rangement doivent rester visibles.
    expect(slotOf('cni.pdf')).toBeNull();
    expect(displayName('cni.pdf')).toBe('cni.pdf');
  });

  it('ne prend pas un nom de fichier contenant « __ » pour un rangement', () => {
    expect(slotOf('mon__fichier.pdf')).toBeNull();
    expect(displayName('mon__fichier.pdf')).toBe('mon__fichier.pdf');
  });
});
