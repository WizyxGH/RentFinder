/**
 * Sonde de candidature d'une agence (§43, §10).
 *
 * Avant d'écrire le moindre scraper, il faut répondre à trois questions, dans
 * cet ordre, et s'arrêter à la première qui dit non :
 *
 *   1. `robots.txt` autorise-t-il ce qu'on veut lire ?
 *   2. les annonces sont-elles publiques, sans compte ?
 *   3. y en a-t-il assez à Nice pour que ça vaille une source ?
 *
 * Ce script répond aux trois et n'écrit rien. Il servait jusqu'ici à coups de
 * `curl` et de lecture à l'œil, ce qui rendait la vérification longue — donc
 * tentante à sauter, ce qui est exactement le risque que §43 cherche à écarter.
 *
 * Il s'identifie sous le User-Agent du collecteur : on annonce qui l'on est,
 * toujours (§10).
 *
 * Usage :
 *   node packages/collector/scripts/probe-agency.mjs climmo.com autre.fr …
 */

const USER_AGENT =
  process.env['COLLECTOR_USER_AGENT'] ??
  'RentFinderBot/0.1 (+https://github.com/WizyxGH/RentFinder)';

/** Communes visées : Nice et sa périphérie proche, en slug d'URL. */
const NICE_SLUGS = ['nice', 'saint-laurent-du-var', 'cagnes-sur-mer', 'villeneuve-loubet'];

const TIMEOUT_MS = 15_000;

async function get(url) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const response = await fetch(url, {
      headers: { 'User-Agent': USER_AGENT, Accept: '*/*' },
      redirect: 'follow',
      signal: controller.signal,
    });
    return { ok: response.ok, status: response.status, body: await response.text() };
  } catch (error) {
    return { ok: false, status: 0, body: '', error: String(error) };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Ce que `robots.txt` interdit à NOTRE agent.
 *
 * Lecture volontairement prudente : on retient le bloc `*` et, s'il existe, un
 * bloc qui nous nomme. En cas de doute, on affiche tout et c'est un humain qui
 * tranche — un robots.txt mal lu se paie en requêtes qu'on n'avait pas le droit
 * de faire.
 */
function readRobots(text) {
  const lines = text.split('\n').map((line) => line.split('#')[0].trim());
  const groups = [];
  let current = null;
  for (const line of lines) {
    const [rawKey, ...rest] = line.split(':');
    if (rest.length === 0) continue;
    const key = rawKey.trim().toLowerCase();
    const value = rest.join(':').trim();
    if (key === 'user-agent') {
      if (current === null || current.rules.length > 0) {
        current = { agents: [], rules: [] };
        groups.push(current);
      }
      current.agents.push(value.toLowerCase());
    } else if (current !== null && (key === 'disallow' || key === 'allow')) {
      current.rules.push(`${key === 'allow' ? 'Allow' : 'Disallow'}: ${value}`);
    }
  }
  const mine = groups.filter((group) =>
    group.agents.some((agent) => agent === '*' || USER_AGENT.toLowerCase().includes(agent)),
  );
  return mine.flatMap((group) => group.rules);
}

/** Repère la plateforme à sa signature, pour savoir quelle fabrique réutiliser. */
function detectPlatform(sitemap, home) {
  if (/\/fr\/propriete\//.test(sitemap) || /Design by Apimo/i.test(home)) return 'apimo';
  if (/hektor|labelimmo/i.test(home)) return 'hektor';
  if (/laboiteimmo|lbi-/i.test(home)) return 'la-boite-immo';
  if (/netty\.fr|nettygroup/i.test(home)) return 'netty';
  return 'inconnue';
}

/**
 * Les `<loc>` d'un sitemap.
 *
 * Le CDATA n'est pas un détail : la plupart des sitemaps Apimo enveloppent
 * leurs adresses dedans, et une lecture naïve `<loc>([^<]+)</loc>` y trouve
 * ZÉRO résultat — de quoi écarter une agence parfaitement collectable en
 * croyant qu'elle n'a rien à offrir.
 */
function locations(xml) {
  return [...xml.matchAll(/<loc>\s*(?:<!\[CDATA\[)?([^\]<]+)/g)].map((match) => match[1].trim());
}

async function probe(domain) {
  const base = domain.startsWith('http') ? domain : `https://${domain}`;
  const report = { domain, verdict: 'à écarter', notes: [] };

  // --- 1. robots.txt, TOUJOURS en premier ---------------------------------
  const robots = await get(`${base}/robots.txt`);
  if (robots.status === 0) {
    report.notes.push(`injoignable (${robots.error ?? 'sans réponse'})`);
    return report;
  }
  const rules = robots.ok ? readRobots(robots.body) : [];
  const blocking = rules.filter((rule) => /^Disallow: \/\s*$/.test(rule));
  report.notes.push(
    robots.ok
      ? `robots.txt : ${rules.length === 0 ? 'aucune règle' : rules.join(' | ')}`
      : 'pas de robots.txt (tout autorisé)',
  );
  if (blocking.length > 0) {
    report.verdict = 'INTERDIT par robots.txt';
    return report;
  }

  // --- 2. les annonces sont-elles publiques ? -----------------------------
  const sitemap = await get(`${base}/sitemap.xml`);
  const home = await get(base);
  if (!sitemap.ok) report.notes.push(`sitemap.xml : ${sitemap.status}`);

  // --- 3. combien d'annonces de location à Nice ? -------------------------
  const urls = locations(sitemap.body);
  const nested = urls.filter((url) => url.endsWith('.xml'));
  const all = [...urls];
  // Un sitemap index ne contient que d'autres sitemaps : on descend d'un cran.
  for (const child of nested.slice(0, 8)) {
    const page = await get(child);
    all.push(...locations(page.body));
  }
  const rentals = all.filter(
    (url) => /location/i.test(url) && NICE_SLUGS.some((slug) => url.toLowerCase().includes(slug)),
  );
  // La signature se lit sur les ADRESSES collectées, pas sur l'index du
  // sitemap : celui-ci ne contient que d'autres sitemaps, et la détection y
  // répondait « inconnue » pour des agences Apimo évidentes.
  const platform = detectPlatform(all.join(String.fromCharCode(10)), home.body);
  report.notes.push(`plateforme : ${platform}`);
  report.notes.push(`${all.length} URL au sitemap, dont ${rentals.length} locations ciblées`);
  if (rentals[0] !== undefined) report.notes.push(`exemple : ${rentals[0]}`);

  if (rentals.length >= 5) report.verdict = `RETENIR (${platform})`;
  else if (rentals.length > 0) report.verdict = `faible volume (${rentals.length})`;
  return report;
}

const domains = process.argv.slice(2);
if (domains.length === 0) {
  console.error('Usage : node probe-agency.mjs <domaine> [<domaine>…]');
  process.exit(1);
}

for (const domain of domains) {
  const report = await probe(domain);
  console.log(`\n=== ${report.domain} → ${report.verdict}`);
  for (const note of report.notes) console.log(`    ${note}`);
}
