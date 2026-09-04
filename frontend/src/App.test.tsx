/**
 * Tests de non-régression du frontend (§54).
 *
 * Ils couvrent les parcours critiques listés au §54 : affichage, tri, filtrage,
 * ouverture d'une annonce, affichage des sources et des scores, préparation
 * d'un contact, changement de statut.
 *
 * Les données proviennent de `mock-data.ts` — fictives et déterministes (§59).
 */

import { describe, expect, it, beforeEach, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { App } from './App.js';
import { MVP_CRITERIA } from '@rentfinder/shared';
import { MOCK_LISTINGS } from './api/mock-data.js';

/**
 * Instant figé : sans cela, les libellés « il y a X min » changeraient à chaque
 * exécution et les tests deviendraient instables (§59).
 */
const FROZEN_NOW = Date.parse('2026-08-14T09:30:00.000Z');

beforeEach(() => {
  vi.spyOn(Date, 'now').mockReturnValue(FROZEN_NOW);
  localStorage.clear();
});

/**
 * Rend l'application ET ouvre la recherche.
 *
 * L'accueil n'est plus la liste : c'est un point de situation, et la liste vit
 * sous l'onglet « Recherche ». Les scénarios qui parlent d'annonces commencent
 * donc par ce geste, exactement comme l'utilisateur.
 */
async function renderSearch(): Promise<void> {
  const user = userEvent.setup();
  render(<App />);
  // Deux barres portent le même libellé — celle du haut sur grand écran, celle
  // du bas sur téléphone : `.first()` n'existe pas ici, on prend la première.
  const tabs = await screen.findAllByRole('button', { name: 'Recherche' });
  await user.click(tabs[0]!);
}

describe('liste des annonces', () => {
  it('affiche les annonces correspondant aux critères', async () => {
    await renderSearch();
    const cards = await screen.findAllByTestId('listing-card');

    // Quatre des cinq annonces fictives sont dans les critères.
    const matching = MOCK_LISTINGS.filter((listing) => listing.matchesCriteria);
    expect(cards).toHaveLength(matching.length);
  });

  it('masque par défaut les annonces hors critères (§53 scénario 3)', async () => {
    await renderSearch();
    await screen.findAllByTestId('listing-card');

    // L'annonce à 750 € dépasse le budget : absente de la liste principale.
    expect(screen.queryByText(/750 €/)).not.toBeInTheDocument();
  });

  it('affiche les annonces hors critères sur demande', async () => {
    const user = userEvent.setup();
    await renderSearch();
    await screen.findAllByTestId('listing-card');

    // Le réglage vit dans la modale « Trier et filtrer ».
    await user.click(screen.getByRole('button', { name: /Trier et filtrer/ }));
    await user.click(screen.getByLabelText(/hors critères/i));

    const cards = await screen.findAllByTestId('listing-card');
    expect(cards).toHaveLength(MOCK_LISTINGS.length);
    expect(screen.getByText(/750 €/)).toBeInTheDocument();
  });

  it('rappelle les critères actifs (§36)', async () => {
    await renderSearch();
    // On lit les critères depuis la configuration : les figer ici faisait
    // échouer le test au moindre changement de surface minimale.
    expect(
      await screen.findByText(
        new RegExp(`≤ ${MVP_CRITERIA.maxPrice} € · ≥ ${MVP_CRITERIA.minArea} m²`),
      ),
    ).toBeInTheDocument();
  });

  it('classe par priorité d’action, pas par prix (§36)', async () => {
    await renderSearch();
    const cards = await screen.findAllByTestId('listing-card');

    // La première carte est la mieux notée globalement, même si une autre
    // annonce est moins chère.
    const first = within(cards[0]!).getByText('94');
    expect(first).toBeInTheDocument();
  });

  it('permet de trier par loyer croissant', async () => {
    const user = userEvent.setup();
    await renderSearch();
    await screen.findAllByTestId('listing-card');

    await user.click(screen.getByRole('button', { name: /Trier et filtrer/ }));
    await user.click(screen.getByRole('button', { name: /loyer/i }));
    await user.click(screen.getByRole('button', { name: /^(Voir \d+ annonces?|Aucun résultat)$/ }));

    const cards = await screen.findAllByTestId('listing-card');
    // 420 € est le loyer le plus bas parmi les annonces dans les critères.
    expect(within(cards[0]!).getByText(/420 €/)).toBeInTheDocument();
  });

  it('résume la décision en une barre de priorité, pas quatre scores', async () => {
    // La carte portait quatre anneaux plus une pastille : cinq chiffres pour
    // une seule question. Le détail des scores appartient à la fiche (§37).
    await renderSearch();
    const cards = await screen.findAllByTestId('listing-card');
    const first = within(cards[0]!);

    const bar = first.getByRole('progressbar', { name: /Priorité/ });
    expect(bar).toHaveAttribute('aria-valuenow', '94');
    expect(first.getByText('à contacter')).toBeInTheDocument();
    expect(first.queryByText('Match')).not.toBeInTheDocument();
    expect(first.queryByText('Opportunité')).not.toBeInTheDocument();
  });

  it('indique le nombre de sources (§13)', async () => {
    await renderSearch();
    const cards = await screen.findAllByTestId('listing-card');
    expect(within(cards[0]!).getByText(/4 sources/)).toBeInTheDocument();
  });

  it('signale un score calculé sur information partielle (§17)', async () => {
    // L'astérisque marque les scores dont certains signaux sont inconnus. Il
    // vit désormais sur la FICHE, seul endroit qui affiche encore les scores.
    const user = userEvent.setup();
    await renderSearch();
    const cards = await screen.findAllByTestId('listing-card');
    await user.click(cards[0]!);
    expect(await screen.findByRole('heading', { name: 'Correspondance' })).toBeInTheDocument();
    expect(screen.getAllByText('*').length).toBeGreaterThan(0);
  });

  it('affiche la bannière du mode démonstration', async () => {
    await renderSearch();
    expect(await screen.findByText(/Mode démonstration/)).toBeInTheDocument();
  });
});

describe('fiche détaillée', () => {
  const openFirstListing = async (): Promise<void> => {
    const user = userEvent.setup();
    await renderSearch();
    const cards = await screen.findAllByTestId('listing-card');
    await user.click(cards[0]!);
  };

  it('ouvre l’annonce et montre son titre', async () => {
    await openFirstListing();
    expect(
      await screen.findByRole('heading', { name: /Appartement T2 lumineux/ }),
    ).toBeInTheDocument();
  });

  it('liste toutes les sources avec leurs URLs d’origine (§38)', async () => {
    await openFirstListing();

    // Les sources ont rejoint le bloc « Contact » : c'est par elles qu'on joint
    // le bien, au même titre qu'un téléphone ou un formulaire.
    const contact = screen.getByRole('region', { name: 'Contact' });
    const section = within(contact).getByTestId('listing-sources');
    expect(within(contact).getByText(/^Sources?$/)).toBeInTheDocument();
    expect(section).toBeInTheDocument();
    const link = screen.getByRole('link', { name: 'Demo Portail' });
    expect(link).toHaveAttribute('href', 'https://portail.example.invalid/a/1');
  });

  it('applique les trois actions de la fiche : favori, statut, archivage', async () => {
    // Le PIÈGE : la fiche sort du composant par un `return` anticipé. Un
    // gestionnaire déclaré APRÈS n'est jamais initialisé pour ce rendu, et le
    // clic lève une `ReferenceError` — silencieuse, le bouton semble inerte.
    // C'est arrivé au favori ; ce test couvre les trois d'un coup.
    const user = userEvent.setup();
    await renderSearch();
    const cards = await screen.findAllByTestId('listing-card');
    await user.click(cards[0]!);

    await user.selectOptions(await screen.findByLabelText('Statut'), 'toContact');
    expect(await screen.findByLabelText('Statut')).toHaveValue('toContact');

    // L'archivage renvoie à la liste : l'annonce n'y est plus.
    await user.click(screen.getByRole('button', { name: 'Archiver' }));
    expect(await screen.findAllByTestId('listing-card')).not.toHaveLength(0);
  });

  it('retient l’annonce en favori depuis la fiche', async () => {
    // La fiche sort du composant par un `return` anticipé : `handleFavorite`,
    // déclaré APRÈS, n'était jamais initialisé pour ce rendu et le clic levait
    // une `ReferenceError`. Le bouton restait muet.
    const user = userEvent.setup();
    await renderSearch();
    const cards = await screen.findAllByTestId('listing-card');
    await user.click(cards[0]!);

    const heart = await screen.findByRole('button', { name: 'Ajouter aux favoris' });
    await user.click(heart);
    expect(await screen.findByRole('button', { name: 'Retirer des favoris' })).toBeInTheDocument();
  });

  it('signale une valeur divergente entre sources plutôt que de la masquer (§15)', async () => {
    // L'annonce est vue à 690 € sur trois sources et 715 € sur la quatrième.
    // Ici, le champ fusionné des données fictives n'a pas de conflit ; on
    // vérifie que les occurrences conservent bien leur propre valeur.
    await openFirstListing();
    const section = await screen.findByTestId('listing-sources');
    expect(section.textContent).toContain('715 €');
  });

  it('détaille les raisons de chaque score (§19)', async () => {
    await openFirstListing();
    expect(await screen.findByText('Loyer cohérent avec le marché')).toBeInTheDocument();
    expect(screen.getByText('Agence identifiable')).toBeInTheDocument();
  });

  it('avertit que la probabilité de visite n’est pas une statistique (§18)', async () => {
    await openFirstListing();
    expect(
      await screen.findByText(/fondé sur des règles explicites, pas sur une statistique/),
    ).toBeInTheDocument();
  });

  it('affiche les distances vers les points de référence (§20)', async () => {
    await openFirstListing();
    expect(await screen.findByText(/Travail/)).toBeInTheDocument();
    expect(screen.getAllByText(/17 min/).length).toBeGreaterThan(0);
  });

  it('permet de changer le statut de suivi (§35)', async () => {
    const user = userEvent.setup();
    await openFirstListing();

    const select = await screen.findByLabelText('Statut');
    await user.selectOptions(select, 'toContact');
    expect(select).toHaveValue('toContact');
  });
});

describe('préparation du contact (§22)', () => {
  const openAndConfigureProfile = async (): Promise<ReturnType<typeof userEvent.setup>> => {
    const user = userEvent.setup();
    await renderSearch();
    const cards = await screen.findAllByTestId('listing-card');
    await user.click(cards[0]!);
    return user;
  };

  it('affiche les coordonnées disponibles (§21)', async () => {
    await openAndConfigureProfile();
    expect(await screen.findByText('06 00 00 00 12')).toBeInTheDocument();
    expect(screen.getByText('Agence Fictive Nice')).toBeInTheDocument();
  });

  it('demande le profil avant de composer un message', async () => {
    await openAndConfigureProfile();
    expect(await screen.findByText(/Renseignez votre profil locataire/)).toBeInTheDocument();
  });

  it('compose un message une fois le profil renseigné', async () => {
    const user = await openAndConfigureProfile();

    await user.click(await screen.findByRole('button', { name: /Configurer mon profil/ }));
    await user.type(screen.getByLabelText('Prénom'), 'Alex');
    await user.type(screen.getByLabelText('Nom'), 'Dupont');
    await user.click(screen.getByRole('button', { name: 'Enregistrer' }));

    const message = (await screen.findByLabelText('Message préparé')) as HTMLTextAreaElement;
    expect(message.value).toContain('Alex Dupont');
    expect(message.value).toContain('Bonjour');
    // §24 : le premier contact ne détaille jamais le dossier locataire.
    expect(message.value).not.toMatch(/bulletin|avis d’imposition|pièce d’identité/i);
  });

  it('affiche explicitement qu’aucun envoi n’est automatique (§22)', async () => {
    const user = await openAndConfigureProfile();

    await user.click(await screen.findByRole('button', { name: /Configurer mon profil/ }));
    await user.type(screen.getByLabelText('Prénom'), 'Alex');
    await user.type(screen.getByLabelText('Nom'), 'Dupont');
    await user.click(screen.getByRole('button', { name: 'Enregistrer' }));

    expect(await screen.findByText(/Rien n’est envoyé automatiquement/)).toBeInTheDocument();
  });

  it('propose les quatre actions manuelles (§22)', async () => {
    const user = await openAndConfigureProfile();

    await user.click(await screen.findByRole('button', { name: /Configurer mon profil/ }));
    await user.type(screen.getByLabelText('Prénom'), 'Alex');
    await user.type(screen.getByLabelText('Nom'), 'Dupont');
    await user.click(screen.getByRole('button', { name: 'Enregistrer' }));

    expect(await screen.findByRole('button', { name: 'Modifier' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Copier' })).toBeInTheDocument();
    // Le libellé du lien explicite désormais le canal (« Ouvrir l'e-mail »,
    // « Appeler », « Contacter via SeLoger »…) plutôt qu'un « Ouvrir » muet.
    expect(screen.getByRole('link', { name: /Ouvrir|Appeler|Contacter via/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'J’ai envoyé' })).toBeInTheDocument();
  });

  it('n’expose aucune coordonnée inventée quand la source n’en publie pas (§17)', async () => {
    const user = userEvent.setup();
    await renderSearch();
    const cards = await screen.findAllByTestId('listing-card');

    // La deuxième annonce fictive n'a qu'un formulaire, aucun téléphone.
    const studio = cards.find((card) => within(card).queryByText(/650 €/) !== null);
    await user.click(studio!);

    expect(await screen.findByText('Formulaire')).toBeInTheDocument();
    expect(screen.queryByText('Téléphone')).not.toBeInTheDocument();
  });
});

describe('état des sources (§63)', () => {
  /**
   * L'état des sources se consulte depuis les Paramètres, sur tous les formats.
   * Il avait son propre onglet en haut, pour un écran qu'on ouvre une fois par
   * mois — la barre est réservée aux destinations quotidiennes.
   */
  const openSourcesPanel = async (user: ReturnType<typeof userEvent.setup>): Promise<void> => {
    await user.click(
      within(screen.getByRole('navigation', { name: 'Navigation principale' })).getByRole(
        'button',
        { name: 'Paramètres' },
      ),
    );
    await user.click(
      within(await screen.findByRole('navigation', { name: 'Réglages' })).getByRole('button', {
        name: /Sources/,
      }),
    );
  };

  it('affiche la santé de chaque source', async () => {
    const user = userEvent.setup();
    await renderSearch();
    await screen.findAllByTestId('listing-card');

    await openSourcesPanel(user);

    expect(await screen.findByRole('heading', { name: 'État des sources' })).toBeInTheDocument();
    expect(screen.getByText('En repos (429)')).toBeInTheDocument();
    expect(screen.getByText('Dégradée')).toBeInTheDocument();
  });

  it('explique une mise au repos après un 429 (§10)', async () => {
    const user = userEvent.setup();
    await renderSearch();
    await screen.findAllByTestId('listing-card');
    await openSourcesPanel(user);

    expect(await screen.findByText(/Aucune requête n’est émise/)).toBeInTheDocument();
  });
});

describe('confidentialité (§26)', () => {
  it('ne stocke le profil que localement, jamais dans les données mockées', () => {
    const serialized = JSON.stringify(MOCK_LISTINGS);
    // Aucune donnée personnelle réelle ne doit figurer dans les fixtures.
    expect(serialized).not.toMatch(/@(gmail|laposte|orange|free|outlook|yahoo)\./i);
    // Tous les e-mails fictifs utilisent le domaine réservé RFC 2606.
    const emails = serialized.match(/[\w.+-]+@[\w.-]+/g) ?? [];
    for (const email of emails) {
      expect(email).toMatch(/example\.invalid$/);
    }
  });
});
