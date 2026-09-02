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
    await expect(page.getByTestId('listing-card').first()).toBeVisible();
    expect(await overflow(page)).toBeLessThanOrEqual(1);

    // La modale « Trier et filtrer » : c'est elle qui porte le plus de contrôles
    // sur une petite largeur.
    await page.getByRole('button', { name: /Trier et filtrer/ }).click();
    await expect(page.getByRole('dialog')).toBeVisible();
    expect(await overflow(page)).toBeLessThanOrEqual(1);
    await page.getByRole('button', { name: 'Voir les résultats' }).click();

    // La fiche détaillée : titres longs, photos, tableau de scores.
    await page
      .getByTestId('listing-card')
      .first()
      .getByRole('button', { name: 'Fiche complète' })
      .click();
    expect(await overflow(page)).toBeLessThanOrEqual(1);
  });
}

test('les cibles tactiles restent atteignables au doigt', async ({ page }) => {
  await page.setViewportSize({ width: 360, height: 740 });
  await page.goto('/');
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
