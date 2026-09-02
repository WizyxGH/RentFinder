/**
 * Notifications Web Push (§29) — alerte téléphone rangé, site fermé.
 *
 * C'est la collecte qui émet, directement vers le service de push du
 * navigateur : aucun serveur intermédiaire. Les abonnements vivent dans la
 * base, déposés par le site.
 *
 * Ne remplace pas Telegram, qui reste plus riche (photo, téléphone, bouton
 * favori) : ces notifications sont un second canal, utile à qui n'a pas
 * Telegram sous la main.
 */

import webpush from 'web-push';
import type { Logger } from '../core/logger.js';
import type { NotifiableListing, Repository } from '../db/repository.js';

export interface VapidConfig {
  readonly publicKey: string;
  readonly privateKey: string;
  readonly subject: string;
}

/** Lit la configuration VAPID ; `null` si le canal n'est pas configuré. */
export function loadVapidConfig(env: NodeJS.ProcessEnv = process.env): VapidConfig | null {
  const publicKey = env['VAPID_PUBLIC_KEY'];
  const privateKey = env['VAPID_PRIVATE_KEY'];
  if (
    publicKey === undefined ||
    publicKey === '' ||
    privateKey === undefined ||
    privateKey === ''
  ) {
    return null;
  }
  return {
    publicKey,
    privateKey,
    subject: env['VAPID_SUBJECT'] ?? 'mailto:rentfinder@example.invalid',
  };
}

/** Ce que le service worker reçoit et affiche. */
export interface PushPayload {
  readonly title: string;
  readonly body: string;
  readonly url: string;
  readonly tag: string;
  /** Photo de couverture — affichée par Android, ignorée par iOS. */
  readonly image?: string;
  /** Identifiant de l'annonce, pour l'action « Favori ». */
  readonly listingId?: string;
}

/**
 * Contenu d'une notification.
 *
 * On vise ce que Telegram apporte : la photo, le loyer, la surface, le
 * quartier, et le téléphone quand il existe — de quoi décider SANS ouvrir.
 * Android affiche l'image et les actions ; iOS n'en tient pas compte et se
 * contente du titre et du texte, ce qui reste utilisable (§69).
 */
export function pushContentFor(
  listings: readonly NotifiableListing[],
  siteUrl: string,
): PushPayload {
  const first = listings[0];
  if (listings.length > 1 || first === undefined) {
    return {
      title: `${listings.length} nouvelles annonces`,
      body: 'Ouvrez RentFinder pour les voir.',
      url: siteUrl,
      tag: 'rentfinder-lot',
    };
  }

  const facts = [
    first.price !== null ? `${first.price} €` : null,
    first.area !== null ? `${first.area} m²` : null,
    first.rooms !== null ? `${first.rooms} pièce${first.rooms > 1 ? 's' : ''}` : null,
  ].filter((part): part is string => part !== null);

  const place = first.district ?? first.city;
  // Le téléphone en clair dans la notification : c'est LE geste qui fait
  // gagner une visite, et il évite d'ouvrir quoi que ce soit.
  const lines = [
    facts.join(' · '),
    place !== null && place !== '' ? place : null,
    first.phone !== null ? `☎ ${first.phone}` : null,
  ].filter((part): part is string => part !== null && part !== '');

  return {
    title: first.title ?? 'Nouvelle annonce',
    body: lines.join('\n'),
    url: `${siteUrl}?listing=${encodeURIComponent(first.id)}`,
    tag: `rentfinder-${first.id}`,
    ...(first.photoUrls[0] !== undefined ? { image: first.photoUrls[0] } : {}),
    listingId: first.id,
  };
}

export interface PushDeps {
  readonly repository: Repository;
  readonly config: VapidConfig;
  readonly listings: readonly NotifiableListing[];
  readonly siteUrl: string;
  readonly logger: Logger;
}

/**
 * Envoie une notification à chaque abonné. Ne lève jamais (§69) : un canal
 * secondaire ne doit pas faire échouer une collecte réussie.
 */
export async function sendWebPush(deps: PushDeps): Promise<number> {
  const { repository, config, listings, siteUrl, logger } = deps;
  if (listings.length === 0) return 0;

  const subscriptions = await repository.pushSubscriptions();
  if (subscriptions.length === 0) return 0;

  webpush.setVapidDetails(config.subject, config.publicKey, config.privateKey);
  const payload = JSON.stringify(pushContentFor(listings, siteUrl));
  let sent = 0;

  for (const subscription of subscriptions) {
    try {
      await webpush.sendNotification(
        {
          endpoint: subscription.endpoint,
          keys: { p256dh: subscription.p256dh, auth: subscription.auth },
        },
        payload,
      );
      sent += 1;
    } catch (error) {
      // 404/410 : l'abonnement est mort (site désinstallé, permission
      // retirée). Le garder ferait échouer chaque envoi suivant.
      const status = (error as { statusCode?: number }).statusCode;
      if (status === 404 || status === 410) {
        await repository.removePushSubscription(subscription.endpoint);
        logger.info('push.subscription_gone', { status });
      } else {
        logger.warn('push.failed', { status: status ?? 0 });
      }
    }
  }

  if (sent > 0) logger.info('push.sent', { sent, listings: listings.length });
  return sent;
}
