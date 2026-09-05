/**
 * La règle qui compte n'est pas « afficher un logo » mais « ne pas en afficher
 * un FAUX ». Une agence connue par un portail n'a pas de site à nous ; montrer
 * le favicon du portail donnerait le même logo à des dizaines d'agences
 * différentes, ce qui est pire que l'icône neutre (§17).
 */

import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { AgencyLogo, agencyDomain } from './AgencyLogo.js';

describe('agencyDomain', () => {
  it('rend le domaine d’une agence qu’on collecte directement', () => {
    expect(agencyDomain(['climmo'])).toBe('climmo.com');
  });

  it('ne rend rien pour un portail', () => {
    // fnaim et studapart sont des portails : leur domaine n'est celui d'aucune
    // des agences qui y publient.
    expect(agencyDomain(['fnaim'])).toBeNull();
    expect(agencyDomain(['studapart'])).toBeNull();
  });

  it('retient le site propre quand une agence vient de deux sources', () => {
    expect(agencyDomain(['fnaim', 'climmo'])).toBe('climmo.com');
  });

  it('ne rend rien pour une source inconnue', () => {
    expect(agencyDomain(['source-qui-nexiste-pas'])).toBeNull();
  });
});

describe('AgencyLogo', () => {
  it('affiche l’image du site de l’agence', () => {
    render(<AgencyLogo sources={['climmo']} name="CL Immo" />);
    expect(screen.getByTitle('CL Immo')).toHaveAttribute('src', 'https://climmo.com/favicon.ico');
  });

  it('retombe sur l’icône neutre sans site connu', () => {
    const { container } = render(<AgencyLogo sources={['fnaim']} name="Une agence" />);
    expect(container.querySelector('img')).toBeNull();
    expect(container.querySelector('svg')).not.toBeNull();
  });
});
