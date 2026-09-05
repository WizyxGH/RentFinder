/**
 * Annuaire des agences, et fiche d'une agence.
 *
 * LE NOM D'UNE AGENCE N'AVAIT RIEN DERRIÈRE. Il s'affichait sur une fiche
 * d'annonce et s'arrêtait là : impossible de savoir combien de biens elle
 * publiait, ni de retrouver son numéro sans rouvrir une annonce au hasard. Or
 * c'est une question qu'on se pose vraiment — une agence déjà appelée la
 * semaine dernière, un interlocuteur qui a trois biens dans le même quartier
 * et à qui l'on parlera une fois pour les trois.
 *
 * LE NOM SERT DE CLÉ, faute de mieux : les sources ne publient pas
 * d'identifiant d'agence. Deux orthographes donnent donc deux entrées — c'est
 * préférable à un regroupement inventé qui mélangerait deux enseignes (§17).
 */

import { ArrowLeft, Mail, Phone } from './icons.js';
import { AgencyLogo } from './AgencyLogo.js';
import type { AgencySummary } from '../api/client.js';
import type { ListingView } from '../types.js';
import { formatSourceName } from '../format.js';
import { Button } from '@/components/ui/button.js';
import { Card } from '@/components/ui/card.js';
import { ListingCard } from './ListingCard.js';

/** Coordonnées d'une agence : ce dont on se sert pour la joindre. */
function AgencyContact({ agency }: { readonly agency: AgencySummary }): React.JSX.Element | null {
  if (agency.phone === null && agency.email === null) return null;
  return (
    <div className="mt-2 flex flex-wrap items-center gap-3 text-[0.9rem]">
      {agency.phone !== null && (
        <a href={`tel:${agency.phone}`} className="text-primary inline-flex items-center gap-1.5">
          <Phone aria-hidden="true" className="size-4" /> {agency.phone}
        </a>
      )}
      {agency.email !== null && (
        <a
          href={`mailto:${agency.email}`}
          className="text-primary inline-flex min-w-0 items-center gap-1.5"
        >
          <Mail aria-hidden="true" className="size-4 shrink-0" />
          <span className="truncate">{agency.email}</span>
        </a>
      )}
    </div>
  );
}

export function AgenciesPanel({
  agencies,
  onBack,
  onOpen,
}: {
  readonly agencies: readonly AgencySummary[];
  readonly onBack: () => void;
  readonly onOpen: (name: string) => void;
}): React.JSX.Element {
  return (
    <div>
      <header className="mb-2">
        <Button variant="ghost" onClick={onBack}>
          <ArrowLeft aria-hidden="true" className="size-4" /> Retour
        </Button>
      </header>

      <h1 className="mb-1 text-xl font-bold">Agences</h1>
      <p className="text-muted-foreground mb-4 text-[0.9rem]">
        Celles qui publient les annonces trouvées, classées par nombre de biens en ligne.
      </p>

      {agencies.length === 0 ? (
        <Card className="text-muted-foreground py-8 text-center text-[0.92rem]">
          Aucune agence identifiée pour l’instant.
        </Card>
      ) : (
        <ul className="flex flex-col gap-2">
          {agencies.map((agency, rank) => (
            <li key={agency.name}>
              <button
                type="button"
                onClick={() => onOpen(agency.name)}
                className="border-border hover:bg-muted rf-rise flex w-full cursor-pointer items-center gap-3 rounded-xl border p-3 text-left transition-colors"
                style={{ '--rf-delay': `${Math.min(rank, 10) * 25}ms` } as React.CSSProperties}
              >
                <AgencyLogo sources={agency.sources} name={agency.name} className="size-6" />
                <span className="min-w-0 flex-1">
                  <span className="block truncate font-medium">{agency.name}</span>
                  <span className="text-muted-foreground block text-[0.8rem]">
                    {agency.sources.map(formatSourceName).join(', ')}
                  </span>
                </span>
                <span className="shrink-0 text-right">
                  <span className="block leading-none font-bold">{agency.listings}</span>
                  <span className="text-muted-foreground text-[0.7rem]">
                    annonce{agency.listings > 1 ? 's' : ''}
                  </span>
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export function AgencyPanel({
  agency,
  listings,
  nowMs,
  onBack,
  onOpenListing,
  onFavorite,
}: {
  readonly agency: AgencySummary;
  readonly listings: readonly ListingView[];
  readonly nowMs: number;
  readonly onBack: () => void;
  readonly onOpenListing: (id: string) => void;
  readonly onFavorite: (id: string, favorite: boolean) => void;
}): React.JSX.Element {
  return (
    <div>
      <header className="mb-2">
        <Button variant="ghost" onClick={onBack}>
          <ArrowLeft aria-hidden="true" className="size-4" /> Retour
        </Button>
      </header>

      {/* Le logo accompagne le nom sur la fiche aussi : c'est le même repère,
        et son absence ici donnerait l'impression d'une autre agence. */}
      <div className="flex items-center gap-3">
        <AgencyLogo sources={agency.sources} name={agency.name} className="size-9" />
        <h1 className="min-w-0 flex-1 text-xl font-bold">{agency.name}</h1>
      </div>
      <p className="text-muted-foreground text-[0.9rem]">
        {agency.listings} annonce{agency.listings > 1 ? 's' : ''} en ligne
        {agency.sources.length > 0 && <> · {agency.sources.map(formatSourceName).join(', ')}</>}
      </p>
      <AgencyContact agency={agency} />

      <div className="mt-5 grid gap-3 lg:grid-cols-2">
        {listings.map((listing, rank) => (
          <ListingCard
            key={listing.id}
            listing={listing}
            nowMs={nowMs}
            rank={rank}
            onOpen={() => onOpenListing(listing.id)}
            onFavorite={(favorite) => onFavorite(listing.id, favorite)}
          />
        ))}
      </div>
    </div>
  );
}
