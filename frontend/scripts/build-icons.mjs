/**
 * Génère `src/components/icons.tsx` à partir des dessins Phosphor.
 *
 * POURQUOI GÉNÉRER PLUTÔT QU'IMPORTER. Le paquet React de Phosphor embarque
 * SIX graisses par icône — thin, light, regular, bold, fill, duotone. On n'en
 * utilise que deux, et les quatre autres coûtaient 24 ko compressés dans le
 * bundle, soit un quart de son poids pour des dessins que personne ne voit.
 *
 * Ce script prend les mêmes tracés, garde `regular` et `fill`, et écrit un
 * fichier de composants sans aucune dépendance à l'exécution : le navigateur
 * ne télécharge plus de bibliothèque d'icônes, seulement les trente-six
 * dessins employés.
 *
 * POUR AJOUTER UNE ICÔNE : une ligne dans `ICONS` ci-dessous, puis
 * `pnpm --filter @rentfinder/frontend run icons`. Le fichier généré est
 * committé — la construction du site ne dépend donc pas de ce script, et
 * `@phosphor-icons/react` reste une dépendance de développement.
 */

import { createRequire } from 'node:module';
import { writeFileSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, join } from 'node:path';
import { renderToStaticMarkup } from 'react-dom/server';

/**
 * Le paquet n'expose pas `dist/defs/*` dans sa carte d'exports : on résout
 * donc sa racine, puis on ouvre le fichier directement.
 */
const require = createRequire(import.meta.url);
const phosphorRoot = dirname(require.resolve('@phosphor-icons/react/package.json'));

/**
 * Nom employé dans le projet → nom du dessin chez Phosphor.
 *
 * Les noms d'usage restent ceux que le code employait — `Trash2`, `Settings`,
 * `Home` — là où ils étaient les plus parlants.
 */
const ICONS = {
  Agency: 'Buildings',
  Archive: 'Archive',
  ArchiveRestore: 'ArrowCounterClockwise',
  ArrowLeft: 'ArrowLeft',
  ArrowRight: 'ArrowRight',
  BadgeEuro: 'CurrencyEur',
  BarChart3: 'ChartBar',
  Bell: 'Bell',
  BellOff: 'BellSlash',
  Bookmark: 'BookmarkSimple',
  CalendarDays: 'CalendarDots',
  Check: 'Check',
  ChevronDown: 'CaretDown',
  ChevronLeft: 'CaretLeft',
  ChevronRight: 'CaretRight',
  Dot: 'Dot',
  ExternalLink: 'ArrowSquareOut',
  FileCheck2: 'CheckCircle',
  FileText: 'FileText',
  FileWarning: 'WarningCircle',
  Flame: 'Fire',
  Heart: 'Heart',
  Home: 'House',
  ImageOff: 'ImageBroken',
  List: 'ListBullets',
  LogIn: 'SignIn',
  Mail: 'Envelope',
  Map: 'MapTrifold',
  MapPin: 'MapPin',
  Moon: 'Moon',
  Pencil: 'PencilSimple',
  Phone: 'Phone',
  PhoneCall: 'PhoneCall',
  Play: 'Play',
  Plus: 'Plus',
  Radio: 'Broadcast',
  Search: 'MagnifyingGlass',
  Settings: 'GearSix',
  ShieldCheck: 'ShieldCheck',
  SlidersHorizontal: 'SlidersHorizontal',
  Sun: 'Sun',
  TrainFront: 'Train',
  TriangleAlert: 'Warning',
  Trash2: 'Trash',
  Upload: 'UploadSimple',
  User: 'User',
  X: 'X',
};

/** Les deux seules graisses employées : contour par défaut, plein pour l'actif. */
const WEIGHTS = ['regular', 'fill'];

const here = dirname(fileURLToPath(import.meta.url));
const out = join(here, '..', 'src', 'components', 'icons.tsx');

async function markupFor(phosphorName) {
  const file = join(phosphorRoot, 'dist', 'defs', `${phosphorName}.es.js`);
  const module = await import(pathToFileURL(file).href);
  const weights = module.default;
  const rendered = {};
  for (const weight of WEIGHTS) {
    const element = weights.get(weight);
    if (element === undefined) throw new Error(`${phosphorName} : graisse « ${weight} » absente`);
    rendered[weight] = renderToStaticMarkup(element);
  }
  return rendered;
}

const HEADER = `/* Fichier GÉNÉRÉ par scripts/build-icons.mjs — ne pas modifier à la main. */

/**
 * Le vocabulaire d'icônes du projet.
 *
 * UN SEUL POINT D'IMPORT. Vingt et un fichiers importaient chacun leur
 * bibliothèque : en changer demandait de tous les rouvrir, et rien n'empêchait
 * deux écrans de désigner la même idée par deux dessins différents. Ici, un
 * nom = une idée = un dessin.
 *
 * DEUX GRAISSES. \`regular\` dessine un contour, \`fill\` une forme pleine — ce
 * qui donne l'onglet actif de la barre de navigation et le cœur d'un favori
 * sans second jeu d'icônes ni dessin maison.
 *
 * Les tracés viennent de Phosphor, recopiés ici par le script : le navigateur
 * ne télécharge aucune bibliothèque d'icônes, seulement les dessins employés.
 * Pour en ajouter un, voir \`scripts/build-icons.mjs\`.
 */

export type IconWeight = 'regular' | 'fill';

export interface IconProps extends React.SVGProps<SVGSVGElement> {
  /** \`fill\` pour l'état actif ou sélectionné ; contour sinon. */
  readonly weight?: IconWeight;
}

export type IconComponent = (props: IconProps) => React.JSX.Element;

/**
 * La base commune : une boîte de 256 unités, mise à l'échelle par la classe
 * (\`size-4\`, \`size-5\`…). \`currentColor\` fait suivre la couleur du texte, ce
 * qui évite de passer une couleur à chaque appel.
 */
function Icon({
  paths,
  weight = 'regular',
  ...props
}: IconProps & { readonly paths: Readonly<Record<IconWeight, string>> }): React.JSX.Element {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 256 256"
      width="1em"
      height="1em"
      fill="currentColor"
      {...props}
      dangerouslySetInnerHTML={{ __html: paths[weight] }}
    />
  );
}
`;

const parts = [HEADER];
for (const [exported, phosphorName] of Object.entries(ICONS)) {
  const rendered = await markupFor(phosphorName);
  const table = WEIGHTS.map((w) => `  ${w}: ${JSON.stringify(rendered[w])},`).join('\n');
  parts.push(`
const ${exported}_PATHS = {
${table}
} as const;

export const ${exported}: IconComponent = (props) => <Icon {...props} paths={${exported}_PATHS} />;`);
}

writeFileSync(out, `${parts.join('\n')}\n`, 'utf8');
console.log(`${Object.keys(ICONS).length} icônes écrites dans ${out}`);
