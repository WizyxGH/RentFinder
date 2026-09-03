/**
 * Notifications Web Push (§29) — alerte téléphone rangé, site fermé.
 *
 * C'est la collecte qui émet, directement vers le service de push du
 * navigateur : aucun serveur intermédiaire. Les abonnements vivent dans la
 * base, déposés par le site.
 *
 * Le contenu est celui de Telegram, aux capacités du canal près : mêmes faits,
 * même ordre, mêmes libellés (module `facts.ts`). Une notification par annonce
 * plutôt qu'un décompte — « 3 nouvelles annonces » n'apprenait rien et forçait
 * à ouvrir le site, ce qu'une alerte doit précisément éviter.
 */

import webpush from 'web-push';
import type { Logger } from '../core/logger.js';
import type { NotifiableListing, Repository } from '../db/repository.js';
import { availabilityLabel, locationLabel, originLabel, summarize } from './facts.js';

/**
 * Annonces poussées individuellement par exécution ; au-delà, le surplus est
 * résumé en une notification. Même garde-fou que Telegram : une pile de quinze
 * notifications ne se lit pas, elle se balaie.
 */
export const PUSH_MAX_INDIVIDUAL = 4;

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
  /** Téléphone publié : le service worker en fait un bouton « Appeler ». */
  readonly phone?: string;
}

/**
 * Contenu de la notification d'UNE annonce (PUR, testable).
 *
 * Reprend, dans le même ordre, ce que Telegram envoie : le résumé chiffré,
 * l'adresse la plus précise connue, la disponibilité, le téléphone, l'origine
 * et la priorité. Le téléphone en clair est le geste qui fait gagner une
 * visite : il évite d'ouvrir quoi que ce soit (§21).
 *
 * Android affiche l'image et les boutons ; iOS les ignore et se contente du
 * titre et du texte, ce qui reste utilisable (§69).
 */
export function pushContentFor(
  listing: NotifiableListing,
  siteUrl: string,
  nowMs: number = Date.now(),
): PushPayload {
  const location = locationLabel(listing);
  const availability = availabilityLabel(listing.availableAt, nowMs);
  const origin = originLabel(listing);

  const lines = [
    summarize(listing),
    location !== '' ? `📍 ${location}` : null,
    availability !== null ? `📅 ${availability}` : null,
    listing.phone !== null ? `📞 ${listing.phone}` : null,
    origin !== null ? `📨 via ${origin}` : null,
    `⭐ Priorité ${listing.actionPriority}/100`,
  ].filter((line): line is string => line !== null && line !== '');

  return {
    title: listing.title ?? 'Nouvelle annonce',
    body: lines.join('\n'),
    url: `${siteUrl}?listing=${encodeURIComponent(listing.id)}`,
    tag: `rentfinder-${listing.id}`,
    ...(listing.photoUrls[0] !== undefined ? { image: listing.photoUrls[0] } : {}),
    listingId: listing.id,
    ...(listing.phone !== null ? { phone: listing.phone } : {}),
  };
}

/** Notification de synthèse pour le surplus, quand il y en a un. */
function overflowContent(count: number, siteUrl: string): PushPayload {
  return {
    title: `+ ${count} autre${count > 1 ? 's' : ''} annonce${count > 1 ? 's' : ''}`,
    body: 'Ouvrez RentFinder pour les voir.',
    url: siteUrl,
    tag: 'rentfinder-lot',
  };
}

/**
 * Les notifications à envoyer pour un lot : les plus prioritaires détaillées
 * une à une, le reste résumé.
 */
export function pushContentsFor(
  listings: readonly NotifiableListing[],
  siteUrl: string,
  nowMs: number = Date.now(),
): PushPayload[] {
  const individual = listings.slice(0, PUSH_MAX_INDIVIDUAL);
  const payloads = individual.map((listing) => pushContentFor(listing, siteUrl, nowMs));
  const extra = listings.length - individual.length;
  if (extra > 0) payloads.push(overflowContent(extra, siteUrl));
  return payloads;
}

export interface PushDeps {
  readonly repository: Repository;
  readonly config: VapidConfig;
  readonly listings: readonly NotifiableListing[];
  readonly siteUrl: string;
  readonly logger: Logger;
}

/** Ce qu'un envoi a réellement produit. */
export interface PushReport {
  /** Nombre d'ENVOIS réussis (abonnements × notifications). */
  readonly sent: number;
  /**
   * Annonces effectivement signalées, à marquer comme notifiées.
   *
   * Vide si personne n'est abonné ou si tous les envois ont échoué : sans
   * cela, une annonce serait tenue pour signalée alors que rien n'est parti.
   */
  readonly notifiedIds: readonly string[];
}

/**
 * Envoie les notifications à chaque abonné. Ne lève jamais (§69) : un canal
 * secondaire ne doit pas faire échouer une collecte réussie.
 */
export async function sendWebPush(deps: PushDeps): Promise<PushReport> {
  const { repository, config, listings, siteUrl, logger } = deps;
  if (listings.length === 0) return { sent: 0, notifiedIds: [] };

  const subscriptions = await repository.pushSubscriptions();
  if (subscriptions.length === 0) return { sent: 0, notifiedIds: [] };

  webpush.setVapidDetails(config.subject, config.publicKey, config.privateKey);
  const payloads = pushContentsFor(listings, siteUrl);
  let sent = 0;

  for (const subscription of subscriptions) {
    for (const content of payloads) {
      try {
        await webpush.sendNotification(
          {
            endpoint: subscription.endpoint,
            keys: { p256dh: subscription.p256dh, auth: subscription.auth },
          },
          JSON.stringify(content),
        );
        sent += 1;
      } catch (error) {
        // 404/410 : l'abonnement est mort (site désinstallé, permission
        // retirée). Le garder ferait échouer chaque envoi suivant.
        const status = (error as { statusCode?: number }).statusCode;
        if (status === 404 || status === 410) {
          await repository.removePushSubscription(subscription.endpoint);
          logger.info('push.subscription_gone', { status });
          break;
        }
        logger.warn('push.failed', { status: status ?? 0 });
      }
    }
  }

  if (sent === 0) return { sent: 0, notifiedIds: [] };
  logger.info('push.sent', { sent, listings: listings.length });
  return { sent, notifiedIds: listings.map((listing) => listing.id) };
}
