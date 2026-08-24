/**
 * Vue carte des annonces (§36, §39).
 *
 * Leaflet + tuiles OpenStreetMap (gratuit, attribution obligatoire). Chaque
 * annonce géolocalisée est une pastille de prix ; un clic ouvre un aperçu avec
 * accès à la fiche. Les annonces sans coordonnées (source muette et adresse
 * non géocodée) sont comptées honnêtement plutôt que placées au hasard (§17).
 *
 * Chargé PARESSEUSEMENT (React.lazy) : Leaflet ne pèse sur le bundle initial
 * que si la vue carte est ouverte (§65).
 */

import { useEffect, useRef } from 'react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import type { ListingView } from '../types.js';
import { formatAddress, formatArea, formatPrice, formatPropertyType } from '../format.js';

/** Centre par défaut : Nice. Utilisé quand aucune annonce n'est géolocalisée. */
const NICE_CENTER: [number, number] = [43.7009, 7.2683];

interface MapViewProps {
  readonly listings: readonly ListingView[];
  readonly onOpen: (id: string) => void;
}

/** Pastille de prix, teintée selon la priorité (cohérente avec les cartes). */
function priceIcon(listing: ListingView): L.DivIcon {
  const hot = listing.actionPriority >= 85;
  const label = listing.price.value !== null ? `${listing.price.value} €` : '— €';
  return L.divIcon({
    className: '', // pas de styles Leaflet par défaut
    html: `<div style="
        transform: translate(-50%, -100%);
        display: inline-block; padding: 3px 8px; border-radius: 999px;
        background: ${hot ? '#e00034' : '#ffffff'}; color: ${hot ? '#ffffff' : '#1a1a1a'};
        border: 1px solid ${hot ? '#e00034' : '#d4d4d8'};
        font: 600 12px system-ui, sans-serif; white-space: nowrap;
        box-shadow: 0 1px 4px rgba(0,0,0,.25); cursor: pointer;
      ">${label}</div>`,
    iconSize: [0, 0],
  });
}

export default function MapView({ listings, onOpen }: MapViewProps): React.JSX.Element {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<L.Map | null>(null);
  const layerRef = useRef<L.LayerGroup | null>(null);
  // `onOpen` change à chaque rendu : une ref évite de reconstruire les marqueurs.
  const onOpenRef = useRef(onOpen);
  onOpenRef.current = onOpen;

  const located = listings.filter(
    (listing) =>
      typeof listing.latitude?.value === 'number' && typeof listing.longitude?.value === 'number',
  );

  // Initialisation de la carte, une seule fois.
  useEffect(() => {
    if (containerRef.current === null || mapRef.current !== null) return;
    const map = L.map(containerRef.current, { scrollWheelZoom: true }).setView(NICE_CENTER, 13);
    L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 19,
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
    }).addTo(map);
    mapRef.current = map;
    layerRef.current = L.layerGroup().addTo(map);

    return () => {
      map.remove();
      mapRef.current = null;
      layerRef.current = null;
    };
  }, []);

  // Marqueurs, reconstruits quand la liste change.
  useEffect(() => {
    const map = mapRef.current;
    const layer = layerRef.current;
    if (map === null || layer === null) return;
    layer.clearLayers();

    const bounds: [number, number][] = [];
    for (const listing of located) {
      const position: [number, number] = [
        listing.latitude?.value as number,
        listing.longitude?.value as number,
      ];
      bounds.push(position);

      const marker = L.marker(position, { icon: priceIcon(listing) });
      const summary = [
        formatPropertyType(listing.propertyType.value),
        formatPrice(listing.price.value),
        formatArea(listing.area.value),
      ].join(' · ');

      const popup = document.createElement('div');
      popup.style.cssText = 'font:13px system-ui, sans-serif;max-width:220px';

      // Photo de couverture (depuis le site d'origine, §11 : jamais stockée).
      const photoUrl = listing.imageUrls?.[0];
      if (photoUrl !== undefined) {
        const img = document.createElement('img');
        img.src = photoUrl;
        img.alt = '';
        img.referrerPolicy = 'no-referrer';
        img.loading = 'lazy';
        img.style.cssText =
          'display:block;width:100%;height:110px;object-fit:cover;border-radius:8px;margin-bottom:6px';
        img.addEventListener('error', () => img.remove());
        popup.append(img);
      }

      const title = document.createElement('strong');
      title.textContent = summary;
      popup.append(title);

      // §20 : adresse exacte quand elle est publiée.
      const address = listing.address.value !== null ? formatAddress(listing.address.value) : null;
      if (address !== null) {
        const addr = document.createElement('div');
        addr.textContent = `${address}`;
        addr.style.cssText = 'margin-top:2px;color:#52525b;font-size:12px';
        popup.append(addr);
      }

      const button = document.createElement('button');
      button.type = 'button';
      button.textContent = 'Voir l’annonce';
      button.style.cssText =
        'display:block;margin-top:6px;padding:4px 10px;border-radius:8px;' +
        'border:1px solid #d4d4d8;background:#fff;cursor:pointer;font:600 12px system-ui';
      button.addEventListener('click', () => onOpenRef.current(listing.id));
      popup.append(button);

      marker.bindPopup(popup);
      layer.addLayer(marker);
    }

    if (bounds.length > 0) {
      map.fitBounds(L.latLngBounds(bounds).pad(0.15), { maxZoom: 15 });
    }
  }, [located]);

  return (
    <div>
      <div
        ref={containerRef}
        data-testid="map-view"
        className="h-[65vh] w-full overflow-hidden rounded-xl border border-border"
      />
      {/* §17 : les annonces non localisables sont dites, pas placées au hasard. */}
      {located.length < listings.length && (
        <p className="mt-2 text-[0.85rem] text-muted-foreground">
          {located.length} annonce{located.length > 1 ? 's' : ''} localisée
          {located.length > 1 ? 's' : ''} sur {listings.length} — les autres ne publient ni
          coordonnées ni adresse géocodable.
        </p>
      )}
    </div>
  );
}
