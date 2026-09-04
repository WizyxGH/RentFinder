/**
 * Vérification du responsive (§39).
 *
 * Un seul défaut compte vraiment ici : le DÉBORDEMENT HORIZONTAL. Il oblige à
 * balayer latéralement pour lire, et c'est le symptôme le plus courant d'un
 * élément à largeur fixe oublié. On le mesure donc sur chaque vue, à plusieurs
 * largeurs, plutôt que de décrire des mises en page qui bougeront.
 */

import { test, expect, type Page } from '@playwright/test';

/** Largeurs réelles : petit Android, iPhone courant, tablette, portable. */
const WIDTHS = [
  { name: 'petit mobile', width: 360, height: 740 },
  { name: 'mobile', width: 390, height: 844 },
  { name: 'tablette', width: 768, height: 1024 },
  { name: 'portable', width: 1280, height: 800 },
];

/** Combien de pixels dépassent horizontalement, tolérance à 1 px d'arrondi. */
async function overflow(page: Page): Promise<number> {
  return page.evaluate(() => {
    const doc = document.documentElement;
    return Math.max(0, doc.scrollWidth - doc.clientWidth);
  });
}

for (const { name, width, height } of WIDTHS) {
  test(`aucun débordement horizontal en ${name} (${width}px)`, async ({ page }) => {
    await page.setViewportSize({ width, height });
    await page.goto('/');
    // L'accueil est un point de situation ; la liste vit sous « Recherche ».
    const haut = page.getByRole('navigation', { name: 'Navigation principale' });
    const barre = (await haut.isVisible())
      ? haut
      : page.getByRole('navigation', { name: 'Navigation', exact: true });
    await barre.getByRole('button', { name: 'Recherche' }).click();
    await expect(page.getByTestId('listing-card').first()).toBeVisible();
    expect(await overflow(page)).toBeLessThanOrEqual(1);

    // La modale « Trier et filtrer » : c'est elle qui porte le plus de contrôles
    // sur une petite largeur.
    await page.getByRole('button', { name: /Trier et filtrer/ }).click();
    await expect(page.getByRole('dialog')).toBeVisible();
    expect(await overflow(page)).toBeLessThanOrEqual(1);
    await page.getByRole('button', { name: /^(Voir \d+ annonces?|Aucun résultat)$/ }).click();

    // La fiche détaillée : titres longs, photos, tableau de scores.
    await page.getByTestId('listing-card').first().click();
    expect(await overflow(page)).toBeLessThanOrEqual(1);
  });
}

test('les cibles tactiles restent atteignables au doigt', async ({ page }) => {
  await page.setViewportSize({ width: 360, height: 740 });
  await page.goto('/');
  // L'accueil est un point de situation ; la liste vit sous « Recherche ».
  await page
    .getByRole('navigation', { name: 'Navigation', exact: true })
    .getByRole('button', { name: 'Recherche' })
    .click();
  await expect(page.getByTestId('listing-card').first()).toBeVisible();

  // 36 px : en deçà, une cible devient difficile à viser sur un écran tactile.
  // Seuil volontairement indulgent — on cherche les oublis, pas la perfection.
  const small: string[] = [];
  for (const button of await page.getByRole('button').all()) {
    if (!(await button.isVisible())) continue;
    const box = await button.boundingBox();
    if (box !== null && box.height < 36) small.push((await button.textContent())?.trim() ?? '?');
  }
  expect(small, `cibles trop petites : ${small.join(', ')}`).toEqual([]);
});

test('le bouton de résultats reste visible sans dérouler la modale (§39)', async ({ page }) => {
  // Le pied de la modale porte le NOMBRE d'annonces qui restent : c'est ce
  // qu'on regarde en réglant un filtre. Il se trouvait après huit sections de
  // défilement, si bien qu'on réglait sans jamais voir l'effet du réglage.
  await page.setViewportSize({ width: 360, height: 740 });
  await page.goto('/');
  await page
    .getByRole('navigation', { name: 'Navigation', exact: true })
    .getByRole('button', { name: 'Recherche' })
    .click();
  await page.getByRole('button', { name: /Trier et filtrer/ }).click();

  const dialog = page.getByRole('dialog', { name: 'Trier et filtrer' });
  const resultats = dialog.getByRole('button', {
    name: /^(Voir \d+ annonces?|Aucun résultat)$/,
  });
  await expect(resultats).toBeInViewport();

  // Et il y reste après avoir déroulé jusqu'aux critères de collecte, tout en
  // bas : c'est bien un pied fixe, pas le hasard d'un panneau assez court.
  await dialog.getByText('Ce qui est collecté et signalé').scrollIntoViewIfNeeded();
  await expect(resultats).toBeInViewport();
});
