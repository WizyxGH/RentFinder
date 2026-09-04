/**
 * Ce qui compte dans un premier parcours n'est pas qu'il se déroule, c'est
 * qu'il se QUITTE. Un accueil dont on ne peut pas sortir est une porte fermée,
 * et l'application fonctionne sans ces deux réglages — elle le faisait déjà.
 */

import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { OnboardingPanel } from './OnboardingPanel.js';

function setup(): { finish: ReturnType<typeof vi.fn>; user: ReturnType<typeof userEvent.setup> } {
  const finish = vi.fn();
  const user = userEvent.setup();
  render(<OnboardingPanel profile={null} onSaveProfile={vi.fn()} onFinish={finish} />);
  return { finish, user };
}

describe('OnboardingPanel', () => {
  it('se quitte dès le premier écran', async () => {
    const { finish, user } = setup();
    await user.click(screen.getByRole('button', { name: /Passer et découvrir seul/ }));
    expect(finish).toHaveBeenCalledTimes(1);
  });

  it('laisse passer le profil sans le renseigner', async () => {
    const { user } = setup();
    await user.click(screen.getByRole('button', { name: /Commencer/ }));

    expect(
      screen.getByRole('heading', { level: 1, name: 'Votre profil locataire' }),
    ).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Passer cette étape' }));

    expect(screen.getByRole('heading', { name: 'Votre recherche' })).toBeInTheDocument();
  });

  it("ne propose pas d'effacer un profil qu'on est en train de créer", async () => {
    const { user } = setup();
    await user.click(screen.getByRole('button', { name: /Commencer/ }));

    expect(
      screen.queryByRole('button', { name: /Effacer de cet appareil/ }),
    ).not.toBeInTheDocument();
  });

  it('annonce sa progression aux trois étapes', async () => {
    const { user } = setup();
    const bar = screen.getByRole('progressbar');
    expect(bar).toHaveAttribute('aria-valuenow', '1');

    await user.click(screen.getByRole('button', { name: /Commencer/ }));
    expect(screen.getByRole('progressbar')).toHaveAttribute('aria-valuenow', '2');

    await user.click(screen.getByRole('button', { name: 'Passer cette étape' }));
    expect(screen.getByRole('progressbar')).toHaveAttribute('aria-valuenow', '3');
  });
});
