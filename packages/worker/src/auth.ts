/**
 * Identifiants et sessions (§26).
 *
 * POURQUOI CE FICHIER EXISTE. Jusqu'ici le site parlait directement à Turso
 * avec un jeton conservé par le navigateur : dans ce modèle, aucun mot de
 * passe ne pouvait être vérifié — le jeton ouvrait toute la base, et un écran
 * de connexion posé devant se serait contourné en changeant une variable. Le
 * Worker déplace ce jeton hors de portée : il reste un secret de la plateforme,
 * le navigateur ne voit plus qu'un cookie de session.
 *
 * PBKDF2 ET NON BCRYPT. Les Workers n'exposent que WebCrypto ; bcrypt et argon2
 * demanderaient du WASM. PBKDF2-HMAC-SHA-256 en fait partie et suffit dès lors
 * que le nombre d'itérations est sérieux : 210 000, la recommandation OWASP
 * 2023 pour cet algorithme. Chaque mot de passe a son propre sel.
 *
 * LA SESSION EST SIGNÉE, PAS CHIFFRÉE. Le cookie porte l'identifiant et une
 * date d'expiration en clair, suivis d'un HMAC. On ne cache pas qui vous êtes —
 * on rend impossible de se faire passer pour quelqu'un d'autre. Un cookie
 * modifié ne vérifie plus, et il est refusé.
 */

/** Recommandation OWASP 2023 pour PBKDF2-HMAC-SHA-256. */
const ITERATIONS = 210_000;
const KEY_BITS = 256;

/** Durée d'une session. Assez longue pour ne pas agacer, assez courte pour compter. */
const SESSION_DAYS = 30;

const encoder = new TextEncoder();

function toBase64(bytes: Uint8Array): string {
  return btoa(String.fromCharCode(...bytes));
}

function fromBase64(value: string): Uint8Array {
  return Uint8Array.from(atob(value), (c) => c.charCodeAt(0));
}

/**
 * Comparaison à TEMPS CONSTANT.
 *
 * Une comparaison ordinaire s'arrête au premier octet différent : le temps
 * qu'elle met révèle combien de caractères sont justes, et permet de deviner
 * une empreinte octet par octet. Celle-ci regarde tout, toujours.
 */
function sameBytes(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i += 1) diff |= a[i]! ^ b[i]!;
  return diff === 0;
}

/** Dérive l'empreinte d'un mot de passe avec le sel donné. */
async function derive(password: string, salt: Uint8Array): Promise<Uint8Array> {
  const key = await crypto.subtle.importKey('raw', encoder.encode(password), 'PBKDF2', false, [
    'deriveBits',
  ]);
  const bits = await crypto.subtle.deriveBits(
    {
      name: 'PBKDF2',
      hash: 'SHA-256',
      salt: salt as unknown as BufferSource,
      iterations: ITERATIONS,
    },
    key,
    KEY_BITS,
  );
  return new Uint8Array(bits);
}

/**
 * Empreinte à STOCKER, au format `pbkdf2$<itérations>$<sel>$<empreinte>`.
 *
 * Les paramètres voyagent avec l'empreinte : le jour où le nombre
 * d'itérations montera, les anciens mots de passe continueront de se vérifier
 * avec le leur.
 */
export async function hashPassword(password: string): Promise<string> {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const hash = await derive(password, salt);
  return `pbkdf2$${ITERATIONS}$${toBase64(salt)}$${toBase64(hash)}`;
}

/** `true` si le mot de passe correspond à l'empreinte stockée. */
export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const [scheme, iterations, salt, hash] = stored.split('$');
  if (scheme !== 'pbkdf2' || salt === undefined || hash === undefined) return false;
  const rounds = Number(iterations);
  if (!Number.isFinite(rounds) || rounds <= 0) return false;

  const key = await crypto.subtle.importKey('raw', encoder.encode(password), 'PBKDF2', false, [
    'deriveBits',
  ]);
  const bits = await crypto.subtle.deriveBits(
    {
      name: 'PBKDF2',
      hash: 'SHA-256',
      salt: fromBase64(salt) as unknown as BufferSource,
      iterations: rounds,
    },
    key,
    KEY_BITS,
  );
  return sameBytes(new Uint8Array(bits), fromBase64(hash));
}

async function signingKey(secret: string): Promise<CryptoKey> {
  return crypto.subtle.importKey(
    'raw',
    encoder.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign', 'verify'],
  );
}

/** Fabrique un jeton de session signé pour cet utilisateur. */
export async function issueSession(userId: string, secret: string, nowMs: number): Promise<string> {
  const expiry = nowMs + SESSION_DAYS * 86_400_000;
  const body = `${userId}.${expiry}`;
  const mac = await crypto.subtle.sign('HMAC', await signingKey(secret), encoder.encode(body));
  return `${body}.${toBase64(new Uint8Array(mac))}`;
}

/**
 * Lit un jeton de session. `null` si la signature ne vérifie pas, si le format
 * est inattendu, ou si la session a expiré — dans les trois cas la réponse est
 * la même : on ne dit pas LEQUEL des trois, cela n'aiderait qu'un attaquant.
 */
export async function readSession(
  token: string | null,
  secret: string,
  nowMs: number,
): Promise<string | null> {
  if (token === null) return null;
  const parts = token.split('.');
  if (parts.length !== 3) return null;
  const [userId, expiry, mac] = parts as [string, string, string];

  let valid: boolean;
  try {
    valid = await crypto.subtle.verify(
      'HMAC',
      await signingKey(secret),
      fromBase64(mac) as unknown as BufferSource,
      encoder.encode(`${userId}.${expiry}`),
    );
  } catch {
    return null;
  }
  if (!valid) return null;

  const deadline = Number(expiry);
  if (!Number.isFinite(deadline) || deadline <= nowMs) return null;
  return userId;
}

/** Le cookie de session, avec les garde-fous qui le rendent inutilisable ailleurs. */
export function sessionCookie(token: string): string {
  const maxAge = SESSION_DAYS * 86_400;
  // `HttpOnly` : hors de portée du JavaScript de la page, donc d'un script
  // injecté. `Secure` : jamais en clair sur le réseau. `SameSite=Lax` : le
  // cookie ne part pas avec une requête déclenchée par un autre site.
  return `session=${token}; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=${maxAge}`;
}

/** Cookie de déconnexion : le même, vidé et expiré. */
export function clearedCookie(): string {
  return 'session=; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=0';
}

/** Extrait le jeton de l'en-tête `Cookie`. */
export function readCookie(header: string | null): string | null {
  if (header === null) return null;
  for (const part of header.split(';')) {
    const [name, ...rest] = part.trim().split('=');
    if (name === 'session') return rest.join('=');
  }
  return null;
}
