/**
 * Capture de l'espace abonné BEP Logement — À LANCER EN LOCAL UNIQUEMENT.
 *
 *   node --env-file=.env scripts/capture-bep.mjs
 *
 * But : se connecter à l'espace abonné (accès PAYÉ par l'utilisateur, §6) et
 * sauvegarder la page une fois authentifié, afin de concevoir le parser à
 * partir de sa VRAIE structure. Rien n'est publié : la capture est écrite dans
 * `data/` (ignoré par git) et les identifiants ne sont jamais affichés ni
 * journalisés (§26).
 *
 * Ce script ne fait AUCUNE écriture en base et ne collecte rien : il observe.
 */

import { writeFileSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const BASE = 'http://abonnes.beplogement.com';
const LOGIN_URL = `${BASE}/w_login_abonnes.php`;
const INDEX_URL = `${BASE}/w_index_abonnes.php`;

const user = process.env['BEP_SUBSCRIBER_USER'];
const password = process.env['BEP_SUBSCRIBER_PASSWORD'];

if (!user || !password) {
  console.error(
    'Identifiants absents. Renseigne BEP_SUBSCRIBER_USER et BEP_SUBSCRIBER_PASSWORD dans .env,\n' +
      'puis relance :  node --env-file=.env scripts/capture-bep.mjs',
  );
  process.exit(1);
}

const UA = process.env['COLLECTOR_USER_AGENT'] ?? 'RentFinderBot/0.1 (+https://github.com/)';

/** Concatène les cookies d'un en-tête Set-Cookie (nom=valeur ; …). */
function collectCookies(setCookieHeaders, jar) {
  for (const raw of setCookieHeaders) {
    const pair = raw.split(';')[0]?.trim();
    if (pair && pair.includes('=')) {
      const name = pair.slice(0, pair.indexOf('='));
      jar.set(name, pair);
    }
  }
}

function cookieHeader(jar) {
  return [...jar.values()].join('; ');
}

async function main() {
  const jar = new Map();

  // 1. Première visite : récupérer un éventuel cookie de session initial.
  const first = await fetch(INDEX_URL, { headers: { 'User-Agent': UA }, redirect: 'manual' });
  collectCookies(first.headers.getSetCookie?.() ?? [], jar);

  // 2. Connexion : POST du formulaire `regform` (champs abonlogin1 / abonpassword).
  //    `Envoyer` est un bouton image → on envoie des coordonnées de clic.
  const body = new URLSearchParams({
    abonlogin1: user,
    abonpassword: password,
    'Envoyer.x': '10',
    'Envoyer.y': '10',
  });

  const login = await fetch(LOGIN_URL, {
    method: 'POST',
    headers: {
      'User-Agent': UA,
      'Content-Type': 'application/x-www-form-urlencoded',
      Cookie: cookieHeader(jar),
      Referer: INDEX_URL,
    },
    body,
    redirect: 'manual',
  });
  collectCookies(login.headers.getSetCookie?.() ?? [], jar);

  console.log(`Connexion : HTTP ${login.status}`);
  console.log(`Redirection : ${login.headers.get('location') ?? '(aucune)'}`);
  console.log(`Cookies de session : ${jar.size > 0 ? [...jar.keys()].join(', ') : '(aucun)'}`);

  // 3. Récupérer la page abonnés après connexion.
  const landingPath = login.headers.get('location') ?? 'w_index_abonnes.php';
  const landingUrl = landingPath.startsWith('http') ? landingPath : `${BASE}/${landingPath}`;
  const page = await fetch(landingUrl, {
    headers: { 'User-Agent': UA, Cookie: cookieHeader(jar) },
  });
  const html = await page.text();

  // 4. Sauvegarde locale (jamais committée) + diagnostic.
  const dataDir = fileURLToPath(new URL('../data/', import.meta.url));
  mkdirSync(dataDir, { recursive: true });
  const outFile = fileURLToPath(new URL('../data/bep-capture.html', import.meta.url));
  writeFileSync(outFile, html, 'utf8');

  const loggedIn = !/abonpassword/i.test(html); // le formulaire de login a disparu = connecté
  console.log(`\nPage récupérée : HTTP ${page.status}, ${html.length} octets`);
  console.log(`Connecté : ${loggedIn ? 'OUI' : 'NON (le formulaire de login est toujours là)'}`);
  console.log(`Liens .php trouvés : ${(html.match(/w_[a-z_]+\.php/gi) ?? []).length}`);
  console.log(`Occurrences « € » : ${(html.match(/€|&euro;/g) ?? []).length}`);
  console.log(`\nCapture écrite dans data/bep-capture.html (ignorée par git).`);
  console.log(
    'Ouvre ce fichier et dis-moi ce que contient la page abonnés (ou colle un\n' +
      'extrait ANONYMISÉ d’une annonce), pour que je construise le parser.',
  );
}

main().catch((error) => {
  // On n'imprime que le message, jamais l'objet complet (évite de fuiter l'URL
  // avec d'éventuels identifiants encodés).
  console.error(
    'Échec de la capture :',
    error instanceof Error ? error.message : 'erreur inconnue',
  );
  process.exit(1);
});
