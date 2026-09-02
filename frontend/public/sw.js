/*
 * Service worker — reçoit les notifications APPLICATION FERMÉE (§29).
 *
 * Volontairement minimal : il ne met rien en cache et n'intercepte aucune
 * requête. Son seul rôle est d'être réveillé par le service de push du
 * navigateur, d'afficher la notification, et d'ouvrir la bonne annonce au clic.
 */

self.addEventListener('push', (event) => {
  let payload = {};
  try {
    payload = event.data ? event.data.json() : {};
  } catch {
    // Charge utile illisible : on notifie quand même, sans détail.
  }

  const title = payload.title || 'Nouvelle annonce';
  event.waitUntil(
    self.registration.showNotification(title, {
      body: payload.body || '',
      // `tag` dédoublonne : deux envois rapprochés ne s'empilent pas.
      tag: payload.tag || 'rentfinder',
      data: { url: payload.url || '/' },
      badge: undefined,
      icon: undefined,
    }),
  );
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const target = event.notification.data && event.notification.data.url;
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((windows) => {
      // Réutilise un onglet déjà ouvert plutôt que d'en empiler un nouveau.
      for (const client of windows) {
        if ('focus' in client) return client.focus();
      }
      return self.clients.openWindow(target || '/');
    }),
  );
});
