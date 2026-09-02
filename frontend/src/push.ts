/**
 * Notifications APPLICATION FERMÉE (§29).
 *
 * Complète les notifications du navigateur, qui n'existent que site ouvert.
 * Le site s'abonne auprès du service de push de son navigateur et dépose
 * l'abonnement dans la base ; c'est la COLLECTE PLANIFIÉE qui émet ensuite —
 * aucun serveur en plus.
 *
 * Un abonnement ne dit ni qui ni où : une URL opaque et deux clés de
 * chiffrement, révocables à tout moment depuis les réglages du navigateur.
 *
 * SUR iOS, il faut avoir ajouté le site à l'écran d'accueil (16.4+) : hors de
 * ce mode, Safari n'expose pas l'API et l'abonnement échouera proprement.
 */

import { subscribePush, unsubscribePush } from './api/client.js';

/** Clé publique du serveur d'envoi, injectée à la compilation. */
const VAPID_PUBLIC_KEY: string = (import.meta.env['VITE_VAPID_PUBLIC_KEY'] as string) ?? '';

export function pushSupported(): boolean {
  return (
    typeof navigator !== 'undefined' &&
    'serviceWorker' in navigator &&
    'PushManager' in window &&
    VAPID_PUBLIC_KEY !== ''
  );
}

/** La clé VAPID voyage en base64url ; l'API la veut en octets. */
function decodeKey(base64: string): BufferSource {
  const padded = (base64 + '='.repeat((4 - (base64.length % 4)) % 4))
    .replace(/-/g, '+')
    .replace(/_/g, '/');
  const raw = atob(padded);
  // `.buffer` : les types du DOM attendent un `BufferSource`, pas la vue.
  return Uint8Array.from([...raw].map((c) => c.charCodeAt(0))).buffer;
}

async function registration(): Promise<ServiceWorkerRegistration> {
  // `import.meta.env.BASE_URL` : le site vit sous /<dépôt>/ sur GitHub Pages,
  // et un service worker ne couvre que son propre répertoire.
  const base = import.meta.env.BASE_URL;
  return navigator.serviceWorker.register(`${base}sw.js`, { scope: base });
}

/** `true` si un abonnement est déjà actif dans ce navigateur. */
export async function pushEnabled(): Promise<boolean> {
  if (!pushSupported()) return false;
  try {
    const existing = await (
      await navigator.serviceWorker.getRegistration()
    )?.pushManager.getSubscription();
    return existing != null;
  } catch {
    return false;
  }
}

/**
 * Demande la permission, s'abonne et enregistre l'abonnement.
 * @returns un message d'échec, ou `null` si tout s'est bien passé.
 */
export async function enablePush(): Promise<string | null> {
  if (!pushSupported()) {
    return 'Ce navigateur ne gère pas les notifications en arrière-plan. Sur iPhone, ajoutez d’abord le site à l’écran d’accueil.';
  }
  if ((await Notification.requestPermission()) !== 'granted') {
    return 'Permission refusée. Elle se réactive dans les réglages du navigateur.';
  }
  try {
    const subscription = await (
      await registration()
    ).pushManager.subscribe({
      // Exigé par les navigateurs : une notification doit être VISIBLE, on ne
      // peut pas s'en servir pour réveiller le site en silence.
      userVisibleOnly: true,
      applicationServerKey: decodeKey(VAPID_PUBLIC_KEY),
    });
    const raw = subscription.toJSON();
    await subscribePush({
      endpoint: subscription.endpoint,
      p256dh: raw.keys?.['p256dh'] ?? '',
      auth: raw.keys?.['auth'] ?? '',
    });
    return null;
  } catch (error) {
    return `Abonnement impossible : ${error instanceof Error ? error.message : String(error)}`;
  }
}

/** Se désabonne, ici et en base. */
export async function disablePush(): Promise<void> {
  try {
    const subscription = await (
      await navigator.serviceWorker.getRegistration()
    )?.pushManager.getSubscription();
    if (subscription == null) return;
    await unsubscribePush(subscription.endpoint);
    await subscription.unsubscribe();
  } catch {
    // Déjà parti, ou stockage indisponible : rien de plus à faire.
  }
}
