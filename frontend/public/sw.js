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
  const phone = payload.phone;
  // Chemins ABSOLUS depuis la portée du worker : le site vit sous /<dépôt>/.
  //
  // TROIS IMAGES, TROIS RÔLES, et il faut les bons fichiers :
  //
  //   `badge`  silhouette de la barre d'état. Android n'en garde QUE LE CANAL
  //            ALPHA et la reteint. On lui donnait `icon-192.png`, qui est
  //            opaque de bord à bord : tout était « plein », d'où le CARRÉ NOIR
  //            que l'utilisateur voyait à la place du logo. `badge-96.png` est
  //            la même maison, blanche sur fond transparent — le seul format
  //            qu'Android sache découper.
  //   `icon`   vignette de la notification : l'identité de l'application, pour
  //            reconnaître l'expéditeur avant même de lire le titre.
  //   `image`  la photo du bien, quand la source en publie une. Elle ne
  //            remplace pas l'icône : elles s'affichent à deux endroits
  //            différents, et la plupart des annonces n'ont pas de photo.
  const base = self.registration.scope;
  const options = {
    badge: `${base}badge-96.png`,
    icon: `${base}icon-192.png`,
    body: payload.body || '',
    // `tag` dédoublonne : deux envois rapprochés ne s'empilent pas.
    tag: payload.tag || 'rentfinder',
    data: { url: payload.url || '/', listingId, phone },
    // Sans cela, une notification arrivée pendant le sommeil de l'appareil
    // disparaît sans avoir été vue.
    requireInteraction: false,
  };
  if (payload.image) options.image = payload.image;
  if (listingId) {
    // Android n'affiche que DEUX boutons. Quand un téléphone est publié,
    // « Appeler » prime sur « Voir » : c'est le geste qui fait gagner une
    // visite, et le seul que la notification permet sans ouvrir le site.
    options.actions = phone
      ? [
          { action: 'call', title: 'Appeler' },
          { action: 'favorite', title: 'Favori' },
        ]
      : [
          { action: 'favorite', title: 'Favori' },
          { action: 'open', title: 'Voir' },
        ];
  }

  event.waitUntil(self.registration.showNotification(payload.title || 'Nouvelle annonce', options));
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const data = event.notification.data || {};

  // « Appeler » ouvre le composeur du téléphone : aucune page à charger, aucun
  // onglet à réutiliser. On sort donc avant la logique de fenêtres.
  if (event.action === 'call' && data.phone) {
    event.waitUntil(self.clients.openWindow(`tel:${data.phone.replace(/[^+\d]/g, '')}`));
    return;
  }

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
