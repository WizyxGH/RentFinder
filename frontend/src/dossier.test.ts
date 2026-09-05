import { describe, expect, it } from 'vitest';
import { DOSSIER_SLOTS, displayName, dossierSlots, slotOf, slotPrefix } from './dossier.js';

describe('liste des pièces', () => {
  it('couvre les quatre justificatifs du décret, pour le locataire ET le garant', () => {
    const tenant = dossierSlots('physical')
      .filter((s) => !s.forGuarantor)
      .map((s) => s.id);
    expect(tenant).toEqual(['identite', 'domicile', 'situation', 'ressources']);
    // Le garant fournit les mêmes, plus l'acte de cautionnement.
    const guarantor = dossierSlots('physical')
      .filter((s) => s.forGuarantor)
      .map((s) => s.id);
    expect(guarantor).toEqual([
      'garant-identite',
      'garant-domicile',
      'garant-situation',
      'garant-ressources',
      'garant-caution',
    ]);
  });

  /**
   * Une garantie institutionnelle remplace TOUT le dossier d'une caution par une
   * attestation. Afficher les cinq emplacements d'un garant physique laissait
   * un compteur « 0/5 » que personne ne pouvait jamais compléter.
   */
  it('ne demande qu’une attestation pour Visale, et rien sans garantie', () => {
    expect(
      dossierSlots('visale')
        .filter((s) => s.forGuarantor)
        .map((s) => s.id),
    ).toEqual(['garant-visale']);
    expect(
      dossierSlots('garantme')
        .filter((s) => s.forGuarantor)
        .map((s) => s.id),
    ).toEqual(['garant-certificat']);
    expect(dossierSlots('none').filter((s) => s.forGuarantor)).toEqual([]);
    // Les pièces du candidat, elles, ne dépendent d'aucune garantie.
    for (const kind of ['none', 'physical', 'visale', 'garantme', 'other'] as const) {
      expect(dossierSlots(kind).filter((s) => !s.forGuarantor)).toHaveLength(4);
    }
  });

  /**
   * Le rangement doit survivre à un changement de garantie : une pièce déposée
   * du temps d'un garant physique ne doit pas basculer en « non classée » parce
   * que le profil est passé à Visale.
   */
  it('reconnaît un emplacement même s’il n’est plus demandé', () => {
    expect(slotOf(`${slotPrefix('garant-caution')}acte.pdf`)).toBe('garant-caution');
    expect(slotOf(`${slotPrefix('garant-visale')}visa.pdf`)).toBe('garant-visale');
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
