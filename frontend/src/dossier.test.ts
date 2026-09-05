import { describe, expect, it } from 'vitest';
import { DOSSIER_SLOTS, displayName, dossierSlots, slotOf, slotPrefix } from './dossier.js';

const guarantorIds = (slots: readonly { id: string; forGuarantor: boolean }[]): string[] =>
  slots.filter((slot) => slot.forGuarantor).map((slot) => slot.id);

describe('liste des pièces', () => {
  it('couvre les quatre justificatifs du décret, pour le locataire ET le garant', () => {
    const slots = dossierSlots([{ kind: 'physical' }]);
    const tenant = slots.filter((slot) => !slot.forGuarantor).map((slot) => slot.id);
    expect(tenant).toEqual(['identite', 'domicile', 'situation', 'ressources']);
    // Le garant fournit les mêmes, plus l'acte de cautionnement.
    expect(guarantorIds(slots)).toEqual([
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
    expect(guarantorIds(dossierSlots([{ kind: 'visale' }]))).toEqual(['garant-visale']);
    expect(guarantorIds(dossierSlots([{ kind: 'garantme' }]))).toEqual(['garant-certificat']);
    expect(guarantorIds(dossierSlots([]))).toEqual([]);
    // Les pièces du candidat, elles, ne dépendent d'aucune garantie.
    expect(dossierSlots([]).filter((slot) => !slot.forGuarantor)).toHaveLength(4);
  });

  /**
   * DEUX GARANTS PHYSIQUES ONT CHACUN LEUR DOSSIER — deux parents qui se
   * portent caution ensemble est le cas courant, et le bailleur réclamera bien
   * les pièces des deux. Le premier garde les identifiants sans rang : les
   * pièces déposées du temps où l'on n'en déclarait qu'un restent à leur place.
   */
  it('donne ses propres emplacements à chaque garant physique', () => {
    const slots = dossierSlots([
      { kind: 'physical', name: 'mon père' },
      { kind: 'physical', name: 'ma mère' },
    ]);
    expect(guarantorIds(slots)).toEqual([
      'garant-identite',
      'garant-domicile',
      'garant-situation',
      'garant-ressources',
      'garant-caution',
      'garant2-identite',
      'garant2-domicile',
      'garant2-situation',
      'garant2-ressources',
      'garant2-caution',
    ]);
    // Le nom distingue les deux dossiers à l'écran, sinon indiscernables.
    expect(slots.find((slot) => slot.id === 'garant2-identite')?.label).toContain('ma mère');
  });

  it('ne demande pas deux fois la même attestation institutionnelle', () => {
    // Deux visas Visale n'existent pas : un seul emplacement suffit.
    expect(guarantorIds(dossierSlots([{ kind: 'visale' }, { kind: 'visale' }]))).toEqual([
      'garant-visale',
    ]);
  });

  it('cumule un garant physique et une garantie institutionnelle', () => {
    const slots = dossierSlots([{ kind: 'physical' }, { kind: 'visale' }]);
    expect(guarantorIds(slots)).toContain('garant-caution');
    expect(guarantorIds(slots)).toContain('garant-visale');
  });

  it('n’a aucun identifiant en double', () => {
    const ids = DOSSIER_SLOTS.map((slot) => slot.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  /**
   * Le rangement doit survivre à un changement de garantie : une pièce déposée
   * du temps d'un garant physique ne doit pas basculer en « non classée » parce
   * que le profil est passé à Visale — ni parce qu'un second garant a été
   * retiré.
   */
  it('reconnaît un emplacement même s’il n’est plus demandé', () => {
    expect(slotOf(`${slotPrefix('garant-caution')}acte.pdf`)).toBe('garant-caution');
    expect(slotOf(`${slotPrefix('garant-visale')}visa.pdf`)).toBe('garant-visale');
    expect(slotOf(`${slotPrefix('garant3-identite')}cni.pdf`)).toBe('garant3-identite');
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
