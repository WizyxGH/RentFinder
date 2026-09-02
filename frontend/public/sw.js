/*
 * Service worker — notifications APPLICATION FERMÉE (§29).
 *
 * Volontairement minimal : il ne met rien en cache et n'intercepte aucune
 * requête. Son rôle est d'être réveillé par le service de push, d'afficher la
 * notification, et d'ouvrir ce qu'il faut au clic.
 *
 * ANDROID affiche la photo et les boutons d'action. iOS les ignore et se
 * contente du titre et du texte : on envoie donc toujours les deux, la
 * dégradation se fait toute seule (§69).
 */

self.addEventListener('push', (event) => {
  let payload = {};
  try {
    payload = event.data ? event.data.json() : {};
  } catch {
    // Charge utile illisible : on notifie quand même, sans détail.
  }

  const listingId = payload.listingId;
  const options = {
    body: payload.body || '',
    // `tag` dédoublonne : deux envois rapprochés ne s'empilent pas.
    tag: payload.tag || 'rentfinder',
    data: { url: payload.url || '/', listingId },
    // Sans cela, une notification arrivée pendant le sommeil de l'appareil
    // disparaît sans avoir été vue.
    requireInteraction: false,
  };
  if (payload.image) options.image = payload.image;
  if (listingId) {
    options.actions = [
      { action: 'favorite', title: 'Favori' },
      { action: 'open', title: 'Voir' },
    ];
  }

  event.waitUntil(self.registration.showNotification(payload.title || 'Nouvelle annonce', options));
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const data = event.notification.data || {};

  // « Favori » passe par l'URL plutôt que d'écrire en base depuis ici : le
  // service worker n'a pas accès aux identifiants de connexion, qui vivent
  // dans le stockage de la page. Le site applique l'intention à l'ouverture.
  const target =
    event.action === 'favorite' && data.listingId
      ? `${data.url}${data.url.includes('?') ? '&' : '?'}favori=${encodeURIComponent(data.listingId)}`
      : data.url || '/';

  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((windows) => {
      // Réutilise un onglet déjà ouvert plutôt que d'en empiler un nouveau.
      for (const client of windows) {
        if ('navigate' in client && 'focus' in client) {
          return client.navigate(target).then((c) => (c ? c.focus() : undefined));
        }
      }
      return self.clients.openWindow(target);
    }),
  );
});
