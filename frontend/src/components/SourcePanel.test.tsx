import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ListingView, SourceStateView } from '../types.js';
import { MOCK_LISTINGS } from '../api/mock-data.js';
import { SourcePanel } from './SourcePanel.js';

/** L'identifiant de source porté par la première annonce de démonstration. */
const SOURCE = MOCK_LISTINGS[0]!.occurrences[0]!.sourceId;

const STATE: SourceStateView = {
  sourceId: SOURCE,
  health: 'healthy',
  lastRunAt: '2026-09-04T06:00:00.000Z',
  lastSuccessAt: '2026-09-04T06:00:00.000Z',
  last429At: null,
  cooldownUntil: null,
  consecutiveErrors: 0,
  averageNewListingCount: 3.5,
};

const NOW = Date.parse('2026-09-04T08:00:00.000Z');

function renderPanel(listings: readonly ListingView[] = MOCK_LISTINGS): {
  onSelect: ReturnType<typeof vi.fn>;
} {
  const onSelect = vi.fn();
  render(
    <SourcePanel
      sourceId={SOURCE}
      state={STATE}
      listings={listings}
      nowMs={NOW}
      onBack={vi.fn()}
      onSelect={onSelect}
      onFavorite={vi.fn()}
    />,
  );
  return { onSelect };
}

describe('SourcePanel', () => {
  it('montre l’état de collecte de la source', () => {
    renderPanel();
    expect(screen.getByText('Collecte')).toBeInTheDocument();
    expect(screen.getByText('3.5')).toBeInTheDocument();
  });

  it('ne montre que les annonces de CETTE source', () => {
    const expected = MOCK_LISTINGS.filter(
      (listing) =>
        listing.occurrences.some((one) => one.sourceId === SOURCE) && listing.rented !== true,
    );
    renderPanel();
    expect(screen.getAllByRole('button', { name: /ouvrir la fiche/ })).toHaveLength(
      expected.length,
    );
    expect(expected.length).toBeLessThan(MOCK_LISTINGS.length);
  });

  it('ouvre la fiche d’une annonce depuis la liste', async () => {
    const user = userEvent.setup();
    const { onSelect } = renderPanel();
    const first = MOCK_LISTINGS.find((listing) =>
      listing.occurrences.some((one) => one.sourceId === SOURCE),
    )!;
    await user.click(screen.getAllByRole('button', { name: /ouvrir la fiche/ })[0]!);
    expect(onSelect).toHaveBeenCalledWith(first.id);
  });

  it('le dit franchement quand la source n’a plus rien d’actif', () => {
    renderPanel([]);
    expect(screen.getByText(/Aucune annonce de cette source/)).toBeInTheDocument();
  });
});
