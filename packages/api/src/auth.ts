/**
 * Authentification de l'API (§26, §28).
 *
 * GitHub Pages sert un bundle JavaScript public : y embarquer un jeton
 * reviendrait à le publier. Le jeton est donc saisi une seule fois par
 * l'utilisateur dans l'interface, conservé dans `localStorage`, et envoyé en
 * en-tête `Authorization` à chaque appel. Il n'apparaît jamais dans le dépôt.
 */

/**
 * Comparaison à temps constant.
 *
 * Une comparaison naïve (`a === b`) s'interrompt au premier caractère
 * différent, ce qui laisse fuiter la longueur du préfixe correct par la mesure
 * du temps de réponse. Ici, toutes les positions sont systématiquement
 * comparées.
 */
export function timingSafeEqual(a: string, b: string): boolean {
  const encoder = new TextEncoder();
  const bytesA = encoder.encode(a);
  const bytesB = encoder.encode(b);

  // La différence de longueur est signalée sans court-circuiter la boucle.
  let mismatch = bytesA.length === bytesB.length ? 0 : 1;
  const length = Math.max(bytesA.length, bytesB.length);

  for (let index = 0; index < length; index += 1) {
    mismatch |= (bytesA[index] ?? 0) ^ (bytesB[index] ?? 0);
  }

  return mismatch === 0;
}

/** Extrait le jeton porteur d'une requête. */
export function extractBearer(request: Request): string | null {
  const header = request.headers.get('authorization');
  if (header === null) return null;
  const match = /^Bearer\s+(.+)$/i.exec(header.trim());
  return match?.[1] ?? null;
}

/**
 * Vérifie qu'une requête est autorisée.
 * @returns `null` si la requête est valide, sinon la réponse d'erreur à renvoyer.
 */
export function requireAuth(request: Request, expectedToken: string | undefined): Response | null {
  // Un jeton non configuré côté serveur ferme l'API plutôt que de l'ouvrir :
  // une erreur de déploiement ne doit jamais exposer les données.
  if (expectedToken === undefined || expectedToken === '') {
    return jsonError(503, 'API non configurée : API_ACCESS_TOKEN est absent');
  }

  const provided = extractBearer(request);
  if (provided === null || !timingSafeEqual(provided, expectedToken)) {
    return jsonError(401, 'Jeton absent ou invalide');
  }

  return null;
}

/** Réponse d'erreur JSON, sans détail exploitable par un attaquant. */
export function jsonError(status: number, message: string): Response {
  return new Response(JSON.stringify({ error: message }), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8' },
  });
}

/**
 * En-têtes CORS.
 *
 * L'origine autorisée est explicite : jamais `*`, qui permettrait à n'importe
 * quel site de solliciter l'API avec un jeton volé.
 */
export function corsHeaders(allowedOrigin: string): Record<string, string> {
  return {
    'access-control-allow-origin': allowedOrigin,
    'access-control-allow-methods': 'GET, POST, PATCH, OPTIONS',
    'access-control-allow-headers': 'authorization, content-type',
    'access-control-max-age': '86400',
    vary: 'Origin',
  };
}
