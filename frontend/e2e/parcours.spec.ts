/**
 * Scénarios end-to-end (§53, §54).
 *
 * Ils exercent l'application réellement compilée, dans un navigateur, sur les
 * données fictives. Ce sont les parcours dont la rupture rendrait l'outil
 * inutilisable — pas une couverture exhaustive de l'interface.
 */

import { expect, test, type Page } from '@playwright/test';

/**
 * Ouvre un écran secondaire comme le ferait un utilisateur, à sa largeur.
 *
 * Sur grand écran, les onglets du haut y mènent. Sur MOBILE ils sont masqués
 * au profit de la barre basse, qui ne porte que quatre destinations : les
 * autres passent par « Paramètres ». Sans cette distinction, les scénarios ne
 * testaient qu'un des deux chemins réels.
 */
async function ouvrir(page: Page, onglet: string, lienMobile: string): Promise<void> {
  const haut = page.getByRole('navigation', { name: 'Navigation principale' });
  if (await haut.isVisible()) {
    await haut.getByRole('button', { name: onglet }).click();
    return;
  }
  await page
    .getByRole('navigation', { name: 'Navigation' })
    .getByRole('button', { name: 'Paramètres' })
    .click();
  await page.getByRole('button', { name: new RegExp(lienMobile) }).click();
}

test.beforeEach(async ({ page }) => {
  await page.goto('/');
  // Les annonces arrivent de façon ASYNCHRONE. Sans cette attente, un scénario
  // qui compte les cartes dès l'ouverture en trouve zéro, puis les voit
  // apparaître — d'où des comptages faux et des échecs intermittents.
  await expect(page.getByTestId('listing-card').first()).toBeVisible();
});

test('la liste répond à « que dois-je contacter maintenant ? » (§36)', async ({ page }) => {
  await expect(page.getByRole('heading', { name: 'Recherche Nice' })).toBeVisible();

  // Les critères actifs sont rappelés sans ambiguïté.
  await expect(page.getByText(/≤ 700 € · ≥ \d+ m²/)).toBeVisible();

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

  await first.click();

  // La fiche liste les quatre origines, avec leurs liens d'accès direct (§38).
  await expect(page.getByTestId('listing-sources')).toBeVisible();
  const sourceLinks = page.getByTestId('listing-sources').getByRole('link');
  await expect(sourceLinks).toHaveCount(4);
  await expect(sourceLinks.first()).toHaveAttribute('href', /^https:\/\//);
});

test('scénario 3 — une annonce hors critères est écartée de la liste (§53)', async ({ page }) => {
  // L'annonce à 750 € dépasse le budget : absente par défaut.
  await expect(page.getByText('750 €')).toHaveCount(0);

  // Le réglage vit dans la modale « Trier et filtrer ».
  await page.getByRole('button', { name: /Trier et filtrer/ }).click();
  await page.getByRole('checkbox', { name: 'Annonces hors critères' }).check();
  await page.getByRole('button', { name: 'Voir les résultats' }).click();
  await expect(page.getByText('750 €').first()).toBeVisible();
});

test('scénario 4 — le contact manuel n’envoie rien tout seul (§53)', async ({ page }) => {
  await page.getByTestId('listing-card').first().click();

  // Les coordonnées disponibles sont affichées (§21).
  await expect(page.getByText('06 00 00 00 12')).toBeVisible();

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
  await expect(page.getByRole('link', { name: /Ouvrir|Appeler|Contacter via/ })).toBeVisible();
  await expect(page.getByRole('button', { name: 'J’ai envoyé' })).toBeVisible();
});

test('les scores exposent leurs raisons et leurs angles morts (§17, §19)', async ({ page }) => {
  await page.getByTestId('listing-card').first().click();

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

  await risky.click();

  // Le détail « Risque » est repliable : on le déplie pour lire ses raisons.
  const risk = page.locator('details').filter({ hasText: 'Risque' });
  await risk.locator('summary').click();
  await expect(risk.getByText('Loyer très inférieur au marché (5,8 €/m²)')).toBeVisible();
  await expect(risk.getByText('Le bailleur déclare être à l’étranger')).toBeVisible();
});

test('le tri et le changement de statut fonctionnent (§35, §54)', async ({ page }) => {
  // Le tri vit dans la modale « Trier et filtrer ».
  const toolbar = page.getByRole('group', { name: 'Barre de filtres' });
  await toolbar.getByRole('button', { name: /Trier et filtrer/ }).click();
  await page.getByRole('button', { name: 'Loyer croissant' }).click();
  await page.getByRole('button', { name: 'Voir les résultats' }).click();
  await expect(page.getByTestId('listing-card').first()).toContainText('420 €');

  await page.getByTestId('listing-card').first().click();
  await page.getByLabel('Statut').selectOption('toContact');
  await expect(page.getByLabel('Statut')).toHaveValue('toContact');
});

test('la page d’état des sources est consultable (§63)', async ({ page }) => {
  // L'onglet « Sources » de la navigation (distinct du filtre par source).
  await ouvrir(page, 'Sources', 'Sources');

  await expect(page.getByRole('heading', { name: 'État des sources' })).toBeVisible();
  await expect(page.getByText('En repos (429)')).toBeVisible();
  await expect(page.getByText(/Aucune requête n’est émise/)).toBeVisible();
});

test('on peut basculer entre la vue Liste et la vue Carte (§36)', async ({ page }) => {
  await expect(page.getByTestId('listing-card').first()).toBeVisible();

  await page.getByRole('button', { name: /Carte/ }).click();
  // La carte s'affiche ; les cartes-annonces cèdent la place.
  await expect(page.getByTestId('map-view')).toBeVisible();

  await page.getByRole('button', { name: 'Liste' }).click();
  await expect(page.getByTestId('listing-card').first()).toBeVisible();
});

test('l’interface est utilisable sur mobile sans défilement horizontal (§39)', async ({ page }) => {
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth > document.documentElement.clientWidth,
  );
  expect(overflow).toBe(false);
});

test('les filtres sont réglables depuis le site (§66)', async ({ page }) => {
  await ouvrir(page, 'Alertes', 'Critères de recherche');

  await expect(page.getByRole('heading', { name: 'Filtres de recherche' })).toBeVisible();
  const budget = page.getByLabel('Loyer maximum');
  await expect(budget).toBeVisible();
  await budget.fill('600');

  await page.getByRole('button', { name: 'Enregistrer' }).click();
  await expect(page.getByText(/Filtres enregistrés/)).toBeVisible();
});

test('la localisation ouvre Maps facilement (§20)', async ({ page }) => {
  await page.getByTestId('listing-card').first().click();
  // Ciblé par sa DESTINATION, pas par son pictogramme : celui-ci a déjà changé
  // une fois (emoji puis icône) et le test cassait sans que rien ne soit cassé.
  const maps = page.locator('a[href*="google.com/maps"]').first();
  await expect(maps).toBeVisible();
  await expect(maps).toHaveAttribute('href', /google\.com\/maps/);
});

test('la page Stats présente les compteurs et la couverture par source (§33)', async ({ page }) => {
  await ouvrir(page, 'Stats', 'Statistiques');
  await expect(page.getByRole('heading', { name: 'Statistiques' })).toBeVisible();
  await expect(page.getByText('Couverture par source')).toBeVisible();
  await expect(page.getByText(/Taux de réponse/)).toBeVisible();
});

test('la page Notifications dit ce qui est actif (§29)', async ({ page }) => {
  // Chromium headless refuse les notifications quoi qu'il arrive. On ne teste
  // donc pas l'activation, mais le fait que la page RENDE COMPTE de l'état —
  // c'est précisément ce que la cloche seule ne savait pas dire.
  await page.getByRole('button', { name: 'Notifications' }).first().click();

  await expect(page.getByRole('heading', { name: 'Notifications' })).toBeVisible();
  await expect(page.getByText('Permission du navigateur')).toBeVisible();
  await expect(page.getByText('Site fermé')).toBeVisible();
  await expect(page.getByText('Historique')).toBeVisible();

  // Rien ne sonne sans consentement explicite.
  await expect(page.getByRole('button', { name: /Activer les notifications/ })).toBeVisible();

  // Page À PART, pas un onglet : aucune barre de navigation ne subsiste — ni
  // les onglets du haut sur grand écran, ni la barre basse sur mobile — et on
  // en revient par « Retour ».
  await expect(page.getByRole('navigation', { name: 'Navigation principale' })).toBeHidden();
  await expect(page.getByRole('navigation', { name: 'Navigation', exact: true })).toBeHidden();
  await page.getByRole('button', { name: 'Retour' }).click();
  await expect(page.getByTestId('listing-card').first()).toBeVisible();
});

test('on peut mettre une annonce en favori', async ({ page }) => {
  const first = page.getByTestId('listing-card').first();
  const star = first.getByRole('button', { name: 'Ajouter aux favoris' });
  await expect(star).toBeVisible();
  await star.click();
  // L'étoile devient « pleine » : le bouton bascule vers « Retirer des favoris ».
  await expect(first.getByRole('button', { name: 'Retirer des favoris' })).toBeVisible();
});

test('on peut filtrer la liste par source (menu déroulant)', async ({ page }) => {
  const cards = page.getByTestId('listing-card');
  const before = await cards.count();
  expect(before).toBeGreaterThan(1);

  // Ouvrir le menu « Sources » de la barre de filtres (distinct de l'onglet
  // de navigation du même nom).
  // Le filtre par source vit dans la modale « Trier et filtrer ».
  const toolbar = page.getByRole('group', { name: 'Barre de filtres' });
  await toolbar.getByRole('button', { name: /Trier et filtrer/ }).click();

  // Cocher une source restreint la liste.
  await page.getByRole('checkbox', { name: 'Demo Agence' }).check();
  await page.getByRole('button', { name: 'Voir les résultats' }).click();
  const filtered = await cards.count();
  expect(filtered).toBeGreaterThan(0);
  expect(filtered).toBeLessThanOrEqual(before);

  // « Tout afficher » réinitialise — il vit dans la modale, à rouvrir.
  await toolbar.getByRole('button', { name: /Trier et filtrer/ }).click();
  await page.getByRole('button', { name: /tout afficher/i }).click();
  await page.getByRole('button', { name: 'Voir les résultats' }).click();
  await expect(cards).toHaveCount(before);
});

test('les filtres rapides (façon SeLoger) affinent la liste et se retirent', async ({ page }) => {
  const cards = page.getByTestId('listing-card');
  const before = await cards.count();
  expect(before).toBeGreaterThan(1);
  const toolbar = page.getByRole('group', { name: 'Barre de filtres' });

  // Un compteur de résultats est affiché.
  await expect(toolbar.getByText(/résultats?$/)).toBeVisible();

  // Filtre « Pièces » : au moins 2 pièces → la liste ne grandit pas.
  await toolbar.getByRole('button', { name: /Trier et filtrer/ }).click();
  await page.getByRole('button', { name: '2+', exact: true }).click();
  await page.getByRole('button', { name: 'Voir les résultats' }).click();
  const filtered = await cards.count();
  expect(filtered).toBeLessThanOrEqual(before);

  // Une puce de filtre actif apparaît et le retirer restaure la liste.
  await expect(toolbar.getByRole('button', { name: 'Retirer le filtre 2+ pièces' })).toBeVisible();
  await page.getByRole('button', { name: 'Effacer tout' }).click();
  await expect(cards).toHaveCount(before);
});

test('la barre basse mène aux quatre destinations (mobile)', async ({ page }) => {
  const basse = page.getByRole('navigation', { name: 'Navigation', exact: true });
  // Elle n'existe QUE sur mobile : sur grand écran, les onglets du haut règnent.
  if (!(await basse.isVisible())) {
    await expect(page.getByRole('navigation', { name: 'Navigation principale' })).toBeVisible();
    return;
  }

  // Favoris filtre la liste au lieu d'ouvrir une vue à part : c'est le même
  // état que la bascule de la modale, pour n'avoir qu'une source de vérité.
  await basse.getByRole('button', { name: 'Favoris' }).click();
  await expect(basse.getByRole('button', { name: 'Favoris' })).toHaveAttribute(
    'aria-current',
    'page',
  );

  await basse.getByRole('button', { name: 'Recherche' }).click();
  await expect(page.getByRole('heading', { name: 'Filtres de recherche' })).toBeVisible();

  await basse.getByRole('button', { name: 'Paramètres' }).click();
  // Les écrans que la barre ne porte pas restent atteignables depuis ici.
  await expect(page.getByRole('navigation', { name: 'Autres réglages' })).toBeVisible();

  await basse.getByRole('button', { name: 'Accueil' }).click();
  await expect(page.getByTestId('listing-card').first()).toBeVisible();
});
