/**
 * Notifications navigateur des nouvelles annonces (§29 — alerte en temps réel).
 *
 * Objectif : quand le site est OUVERT (onglet ou PWA installée), prévenir
 * l'utilisateur dès qu'une annonce entre dans ses critères, via l'API
 * Notifications du navigateur. Un clic ouvre l'annonce.
 *
 * LIMITE ASSUMÉE. Ces notifications ne se déclenchent que site ouvert : elles
 * n'exigent aucun serveur de push, aucune clé, aucune infrastructure cloud —
 * fidèle au choix « 100 % local ». Des notifications navigateur fermé
 * demanderaient un service de push always-on (Web Push + VAPID), écarté ici.
 *
 * Ce module isole la logique PURE (diff, contenu, persistance) du déclenchement
 * DOM, pour que le cœur soit testable sans navigateur (§59).
 */

import type { ListingView } from './types.js';
import { formatArea, formatCity, formatPrice, formatRooms } from './format.js';

/** Intervalle de sondage des nouvelles annonces, site ouvert. */
export const NOTIFY_POLL_MS = 60_000;

/** Au-delà, on résume plutôt que d'empiler les notifications (anti-spam). */
export const NOTIFY_MAX_INDIVIDUAL = 3;

/** Borne la taille de l'ensemble « déjà vu » persisté, pour ne pas gonfler. */
const SEEN_CAP = 500;

const SEEN_KEY = 'rentfinder.notifiedListingIds';
const OPTIN_KEY = 'rentfinder.notificationsOptIn';
const ALERTS_SEEN_KEY = 'rentfinder.alertsSeenAt';

// ---------------------------------------------------------------------------
// Capacités du navigateur
// ---------------------------------------------------------------------------

export function notificationsSupported(): boolean {
  return typeof window !== 'undefined' && 'Notification' in window;
}

export function notificationPermission(): NotificationPermission {
  return notificationsSupported() ? Notification.permission : 'denied';
}

export async function requestNotificationPermission(): Promise<NotificationPermission> {
  if (!notificationsSupported()) return 'denied';
  try {
    return await Notification.requestPermission();
  } catch {
    return 'denied';
  }
}

// ---------------------------------------------------------------------------
// Préférence d'activation (opt-in), conservée dans ce navigateur uniquement
// ---------------------------------------------------------------------------

export function readOptIn(): boolean {
  try {
    return localStorage.getItem(OPTIN_KEY) === 'true';
  } catch {
    return false;
  }
}

export function writeOptIn(value: boolean): void {
  try {
    localStorage.setItem(OPTIN_KEY, value ? 'true' : 'false');
  } catch {
    /* stockage indisponible : l'activation vaudra pour la session courante */
  }
}

// ---------------------------------------------------------------------------
// Mémoire des annonces déjà connues (pour ne notifier que les nouveautés)
// ---------------------------------------------------------------------------

export interface SeenState {
  /** `false` tant qu'aucun sondage n'a amorcé la mémoire (premier lancement). */
  readonly initialized: boolean;
  readonly ids: ReadonlySet<string>;
}

/**
 * Lit l'ensemble des annonces déjà connues. L'ABSENCE de la clé (jamais
 * amorcé) est distinguée d'un ensemble vide : au tout premier sondage, on
 * amorce la mémoire SANS notifier — sinon tout le stock existant sonnerait d'un
 * coup.
 */
export function readSeen(): SeenState {
  try {
    const raw = localStorage.getItem(SEEN_KEY);
    if (raw === null) return { initialized: false, ids: new Set() };
    const parsed = JSON.parse(raw) as unknown;
    const ids = Array.isArray(parsed)
      ? parsed.filter((v): v is string => typeof v === 'string')
      : [];
    return { initialized: true, ids: new Set(ids) };
  } catch {
    return { initialized: false, ids: new Set() };
  }
}

export function writeSeen(ids: Iterable<string>): void {
  try {
    // On ne garde que les derniers identifiants : la mémoire n'a pas à croître
    // indéfiniment, seules les nouveautés récentes comptent.
    const capped = [...ids].slice(-SEEN_CAP);
    localStorage.setItem(SEEN_KEY, JSON.stringify(capped));
  } catch {
    /* stockage indisponible : on renotifiera peut-être, sans casse */
  }
}

// ---------------------------------------------------------------------------
// Pastille de la cloche : alertes non lues
// ---------------------------------------------------------------------------

/**
 * Instant de la dernière visite de la page Notifications.
 *
 * ABSENT AU PREMIER LANCEMENT, et c'est le point délicat : compter alors tout
 * l'historique afficherait « 90 » à quelqu'un qui n'a rien manqué. On amorce
 * donc la mémoire à MAINTENANT — la pastille ne compte que ce qui arrive après
 * la première ouverture du site.
 */
export function readAlertsSeenAt(nowMs: number): number {
  try {
    const raw = localStorage.getItem(ALERTS_SEEN_KEY);
    if (raw !== null) {
      const parsed = Number.parseInt(raw, 10);
      if (Number.isFinite(parsed)) return parsed;
    }
    localStorage.setItem(ALERTS_SEEN_KEY, String(nowMs));
  } catch {
    /* stockage indisponible : la pastille vaudra pour la session */
  }
  return nowMs;
}

/** Consigne que la page Notifications vient d'être consultée. */
export function markAlertsSeen(nowMs: number): void {
  try {
    localStorage.setItem(ALERTS_SEEN_KEY, String(nowMs));
  } catch {
    /* stockage indisponible : la pastille réapparaîtra, sans casse */
  }
}

/**
 * Nombre d'annonces SIGNALÉES depuis la dernière visite (PUR, testable).
 *
 * On compte l'horodatage d'alerte posé par la collecte, pas la liste courante :
 * c'est la même source que l'historique de la page, donc les deux ne peuvent
 * pas se contredire. Une annonce sans date est ignorée — elle date d'avant
 * l'horodatage, on ne l'invente pas (§17).
 */
export function unreadAlertCount(listings: readonly ListingView[], seenAtMs: number): number {
  return listings.filter((listing) => {
    const at = listing.notifiedAt;
    if (at === null || at === undefined) return false;
    const timestamp = Date.parse(at);
    return Number.isFinite(timestamp) && timestamp > seenAtMs;
  }).length;
}

// ---------------------------------------------------------------------------
// Cœur : quelles annonces méritent une notification (PUR, testable)
// ---------------------------------------------------------------------------

export interface NotificationDiff {
  /** Annonces dans les critères, jamais vues jusqu'ici. */
  readonly fresh: readonly ListingView[];
  /** Nouvel ensemble « déjà vu » à persister après ce sondage. */
  readonly nextSeen: readonly string[];
}

/**
 * Compare l'état courant à la mémoire et retourne les annonces à signaler.
 *
 * Règles :
 *   - on ne considère que les annonces DANS les critères (§29) ;
 *   - au premier sondage (mémoire non amorcée), on n'annonce RIEN et on se
 *     contente d'enregistrer l'existant ;
 *   - ensuite, seules les annonces dont l'identifiant est inconnu sont fraîches.
 */
export function diffForNotification(
  listings: readonly ListingView[],
  seen: SeenState,
): NotificationDiff {
  const matching = listings.filter((listing) => listing.matchesCriteria);
  const currentIds = matching.map((listing) => listing.id);

  if (!seen.initialized) {
    return { fresh: [], nextSeen: currentIds };
  }

  const fresh = matching.filter((listing) => !seen.ids.has(listing.id));
  const nextSeen = [...new Set([...seen.ids, ...currentIds])];
  return { fresh, nextSeen };
}

/** Titre + corps d'une notification pour une annonce (PUR, testable). */
export function notificationContentFor(listing: ListingView): { title: string; body: string } {
  const title = `Nouvelle annonce · ${formatCity(listing.city.value)}`;
  const body = [
    formatPrice(listing.price.value),
    formatArea(listing.area.value),
    formatRooms(listing.rooms.value),
  ].join(' · ');
  return { title, body };
}

// ---------------------------------------------------------------------------
// Déclenchement DOM (non testé unitairement — dépend de l'API Notification)
// ---------------------------------------------------------------------------

/**
 * Lève les notifications navigateur pour les annonces fraîches. Au-delà de
 * `NOTIFY_MAX_INDIVIDUAL`, on résume le surplus en une seule notification pour
 * ne pas noyer l'utilisateur. `onOpen` est appelé au clic avec l'id concerné.
 */
export function fireNotifications(
  fresh: readonly ListingView[],
  onOpen: (id: string) => void,
): void {
  if (!notificationsSupported() || Notification.permission !== 'granted' || fresh.length === 0) {
    return;
  }

  const shown = fresh.slice(0, NOTIFY_MAX_INDIVIDUAL);
  for (const listing of shown) {
    const { title, body } = notificationContentFor(listing);
    // `tag` dédoublonne : deux sondages rapprochés ne montrent pas deux fois la
    // même annonce.
    const notification = new Notification(title, { body, tag: `rentfinder-${listing.id}` });
    notification.onclick = () => {
      window.focus();
      notification.close();
      onOpen(listing.id);
    };
  }

  const extra = fresh.length - shown.length;
  if (extra > 0) {
    new Notification(`+ ${extra} autre${extra > 1 ? 's' : ''} annonce${extra > 1 ? 's' : ''}`, {
      body: 'Ouvrez RentFinder pour les voir.',
      tag: 'rentfinder-more',
    });
  }
}
