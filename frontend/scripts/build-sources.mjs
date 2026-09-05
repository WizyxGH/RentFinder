/**
 * Engendre la table des sources lue par l'interface.
 *
 * POURQUOI L'ENGENDRER. Cette table existait à la main dans `format.ts` : un
 * identifiant, un nom lisible. Elle a dérivé — huit sources ajoutées le
 * 2026-09-05 n'y figuraient pas, et l'écran les nommait par un repli qui
 * capitalise l'identifiant : « Akorimmo » pour AKOR Immo, « Immo Jbf » pour
 * Immo JBF. Rien ne cassait, ce qui est précisément le problème : une table
 * tenue à la main ne signale jamais qu'elle est incomplète.
 *
 * ELLE APPORTE AUSSI LE DOMAINE, que la table manuelle n'avait pas. C'est ce
 * qui permet d'afficher le vrai logo d'une agence plutôt qu'une icône commune —
 * uniquement pour celles dont nous connaissons le site, c'est-à-dire celles que
 * nous collectons directement.
 *
 * Le fichier produit est VERSIONNÉ : l'interface se compile sans avoir à
 * construire le collecteur d'abord.
 *
 * Usage : pnpm --filter @rentfinder/frontend run sources
 */

import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import prettier from 'prettier';

// Le collecteur est une dépendance de DÉVELOPPEMENT : ce script ne tourne
// qu'ici, et rien de son code n'entre dans le bundle publié.
const { ALL_SCRAPERS } = await import('@rentfinder/collector');

const OUT = fileURLToPath(new URL('../src/sources.generated.ts', import.meta.url));

const entries = [...ALL_SCRAPERS]
  .map((scraper) => scraper.descriptor)
  .sort((a, b) => a.id.localeCompare(b.id))
  .map((descriptor) => {
    const domain = descriptor.domain ?? '';
    // Le domaine n'est celui de L'AGENCE que pour une agence locale. Pour un
    // portail — fnaim, studapart — c'est celui du portail, et l'afficher comme
    // logo d'agence donnerait le logo du portail à des dizaines d'agences
    // différentes (§17).
    const ownSite = descriptor.kind === 'localAgency' && domain !== '';
    return `  '${descriptor.id}': { name: ${JSON.stringify(descriptor.name)}, domain: ${JSON.stringify(
      ownSite ? domain : null,
    )} },`;
  });

const file = `/**
 * ENGENDRÉ — ne pas modifier à la main.
 * Reconstruire avec \`pnpm --filter @rentfinder/frontend run sources\`.
 *
 * La table des sources, telle que le collecteur les déclare : un nom lisible et,
 * pour les agences qui ont leur propre site, son domaine.
 *
 * \`domain\` vaut \`null\` pour les portails : leur domaine n'est pas celui d'une
 * agence, et s'en servir comme logo donnerait la même image à des dizaines
 * d'agences distinctes.
 */

export interface SourceInfo {
  readonly name: string;
  readonly domain: string | null;
}

export const SOURCES: Readonly<Record<string, SourceInfo>> = {
${entries.join('\n')}
};
`;

// FORMATÉ AVANT D'ÊTRE ÉCRIT. Sans cela, chaque régénération produisait un
// fichier que `pnpm verify` refusait aussitôt — guillemets doubles, clés
// inutilement citées — et il fallait repasser Prettier à la main. Un fichier
// engendré doit sortir conforme du premier coup.
const formatted = await prettier.format(file, {
  ...(await prettier.resolveConfig(OUT)),
  filepath: OUT,
});

writeFileSync(OUT, formatted, 'utf8');
console.log(`${entries.length} sources écrites dans src/sources.generated.ts`);
