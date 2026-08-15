/**
 * Scénarios end-to-end (§53, §54).
 *
 * Ils exercent l'application réellement compilée, dans un navigateur, sur les
 * données fictives. Ce sont les parcours dont la rupture rendrait l'outil
 * inutilisable — pas une couverture exhaustive de l'interface.
 */

import { expect, test } from '@playwright/test';

test.beforeEach(async ({ page }) => {
  await page.goto('/');
});

test('la liste répond à « que dois-je contacter maintenant ? » (§36)', async ({ page }) => {
  await expect(page.getByRole('heading', { name: 'Recherche Nice' })).toBeVisible();

  // Les critères actifs sont rappelés sans ambiguïté.
  await expect(page.getByText('≤ 700 € · ≥ 14 m²')).toBeVisible();

  const cards = page.getByTestId('listing-card');
  await expect(cards.first()).toBeVisible();

  // La meilleure opportunité est en tête, avec ses quatre scores.
  const first = cards.first();
  await expect(first.getByText('Match')).toBeVisible();
  await expect(first.getByText('Opportunité')).toBeVisible();
  await expect(first.getByText('Visite')).toBeVisible();
  await expect(first.getByText('Risque')).toBeVisible();
});

test('scénario 2 — une annonce multi-sources n’apparaît qu’une fois (§53)', async ({ page }) => {
  const cards = page.getByTestId('listing-card');
  const first = cards.first();

  // Une seule carte, mais quatre sources annoncées.
  await expect(first.getByText('4 sources')).toBeVisible();

  await first.getByRole('button', { name: 'Voir' }).click();

  // La fiche liste les quatre origines, avec leurs liens d'accès direct (§38).
  await expect(page.getByText('Cette annonce a été trouvée sur')).toBeVisible();
  const sourceLinks = page.getByTestId('listing-sources').getByRole('link');
  await expect(sourceLinks).toHaveCount(4);
  await expect(sourceLinks.first()).toHaveAttribute('href', /^https:\/\//);
});

test('scénario 3 — une annonce hors critères est écartée de la liste (§53)', async ({ page }) => {
  // L'annonce à 750 € dépasse le budget : absente par défaut.
  await expect(page.getByText('750 €')).toHaveCount(0);

  await page.getByLabel(/hors critères/).check();
  await expect(page.getByText('750 €').first()).toBeVisible();
});

test('scénario 4 — le contact manuel n’envoie rien tout seul (§53)', async ({ page }) => {
  await page.getByTestId('listing-card').first().getByRole('button', { name: 'Contacter' }).click();

  // Les coordonnées disponibles sont affichées (§21).
  await expect(page.getByText('+33600000012')).toBeVisible();

  // Le profil est requis avant toute génération de message.
  await page.getByRole('button', { name: /Configurer mon profil/ }).click();
  await page.getByLabel('Prénom').fill('Alex');
  // `exact` obligatoire : sans lui, « Nom » matche aussi « Prénom » par
  // correspondance de sous-chaîne.
  await page.getByLabel('Nom', { exact: true }).fill('Dupont');
  await page.getByRole('button', { name: 'Enregistrer' }).click();

  // Le message est préparé…
  const message = page.getByLabel('Message préparé');
  await expect(message).toBeVisible();
  await expect(message).toHaveValue(/Alex Dupont/);

  // …et l'interface affirme explicitement qu'aucun envoi n'est automatique.
  await expect(page.getByText(/Rien n’est envoyé automatiquement/)).toBeVisible();

  // Les quatre actions restent à la main de l'utilisateur.
  await expect(page.getByRole('button', { name: 'Modifier' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Copier' })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Ouvrir' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'J’ai envoyé' })).toBeVisible();
});

test('les scores exposent leurs raisons et leurs angles morts (§17, §19)', async ({ page }) => {
  await page.getByTestId('listing-card').first().getByRole('button', { name: 'Voir' }).click();

  // Le détail des scores est repliable : on déplie ceux qu'on veut inspecter,
  // et on scope les assertions au bloc déplié (le même libellé peut exister
  // ailleurs, replié).
  const risk = page.locator('details').filter({ hasText: 'Risque' });
  await risk.locator('summary').click();
  await expect(risk.getByText('Loyer cohérent avec le marché')).toBeVisible();
  await expect(risk.getByText('Agence identifiable')).toBeVisible();

  const visit = page.locator('details').filter({ hasText: 'Probabilité de visite' });
  await visit.locator('summary').click();

  // §17 : ce qui manque est dit, pas comblé.
  await expect(visit.getByText(/Information non fournie par les sources/)).toBeVisible();

  // §18 : aucune prétention à une précision statistique.
  await expect(
    visit.getByText(/fondé sur des règles explicites, pas sur une statistique/),
  ).toBeVisible();
});

test('une annonce risquée reste visible, avec ses raisons (§19)', async ({ page }) => {
  const risky = page.getByTestId('listing-card').filter({ hasText: '420 €' });
  await expect(risky).toBeVisible();

  await risky.getByRole('button', { name: 'Voir' }).click();

  // Le détail « Risque » est repliable : on le déplie pour lire ses raisons.
  const risk = page.locator('details').filter({ hasText: 'Risque' });
  await risk.locator('summary').click();
  await expect(risk.getByText('Loyer très inférieur au marché (5,8 €/m²)')).toBeVisible();
  await expect(risk.getByText('Le bailleur déclare être à l’étranger')).toBeVisible();
});

test('le tri et le changement de statut fonctionnent (§35, §54)', async ({ page }) => {
  await page.getByLabel('Trier par').selectOption('price');
  await expect(page.getByTestId('listing-card').first()).toContainText('420 €');

  await page.getByTestId('listing-card').first().getByRole('button', { name: 'Voir' }).click();
  await page.getByLabel('Statut').selectOption('toContact');
  await expect(page.getByLabel('Statut')).toHaveValue('toContact');
});

test('la page d’état des sources est consultable (§63)', async ({ page }) => {
  await page.getByRole('button', { name: 'Sources' }).click();

  await expect(page.getByRole('heading', { name: 'État des sources' })).toBeVisible();
  await expect(page.getByText('En repos (429)')).toBeVisible();
  await expect(page.getByText(/Aucune requête n’est émise/)).toBeVisible();
});

test('l’interface est utilisable sur mobile sans défilement horizontal (§39)', async ({ page }) => {
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth > document.documentElement.clientWidth,
  );
  expect(overflow).toBe(false);
});

test('les filtres sont réglables depuis le site (§66)', async ({ page }) => {
  await page.getByRole('button', { name: 'Filtres' }).click();

  await expect(page.getByRole('heading', { name: 'Filtres de recherche' })).toBeVisible();
  const budget = page.getByLabel('Budget maximum (€/mois)');
  await expect(budget).toBeVisible();
  await budget.fill('600');

  await page.getByRole('button', { name: 'Enregistrer' }).click();
  await expect(page.getByText(/Filtres enregistrés/)).toBeVisible();
});
