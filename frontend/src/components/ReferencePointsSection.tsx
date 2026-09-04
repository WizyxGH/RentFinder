/**
 * Adresses de référence : lieu de travail, gare (§20) — écran Paramètres.
 *
 * Ce sont eux qui produisent le « 18 min » affiché sur chaque annonce, donc en
 * pratique l'ordre dans lequel on les regarde. Ils vivaient dans `.env` et dans
 * les secrets GitHub : changer d'employeur demandait d'éditer un fichier sur la
 * machine de collecte, ou de retrouver un écran de réglages GitHub. Un
 * déménagement devenait une opération technique.
 *
 * ON SAISIT UNE ADRESSE, PAS DES COORDONNÉES. Elle se relit et se corrige ; une
 * paire de coordonnées ne dit rien à personne. Le géocodage a lieu à la
 * collecte suivante — d'où l'avertissement : les distances ne changent pas dans
 * la seconde, et laisser croire le contraire ferait passer un délai normal pour
 * une panne (§17).
 */

import { useEffect, useState } from 'react';
import { MapPin, Plus, Trash2 } from './icons.js';
import { AddressField } from './AddressField.js';
import {
  fetchReferencePoints,
  saveReferencePoints,
  settingsAvailable,
  type StoredReferencePoint,
} from '../api/client.js';
import { REFERENCE_TRAVEL_MODES, type ReferenceTravelMode } from '@rentfinder/shared';
import { Button } from '@/components/ui/button.js';

const MODE_LABELS: Readonly<Record<ReferenceTravelMode, string>> = {
  walking: 'à pied',
  cycling: 'à vélo',
  transit: 'en transports en commun',
  train: 'en train',
  driving: 'en voiture',
};

/** Ce qu'on propose quand la liste est vide : les deux repères habituels. */
const SUGGESTED: readonly StoredReferencePoint[] = [
  { label: 'Travail', address: '', mode: 'transit' },
  { label: 'Gare', address: '', mode: 'walking' },
];

/** Une ligne en cours d'édition — l'adresse peut être vide tant qu'on la tape. */
interface Draft {
  label: string;
  address: string;
  mode: ReferenceTravelMode;
}

const FIELD =
  'w-full rounded-lg border border-border bg-background px-2.5 py-1.5 text-[0.9rem] ' +
  'focus:outline-none focus:ring-2 focus:ring-ring';

export function ReferencePointsSection(): React.JSX.Element | null {
  const [drafts, setDrafts] = useState<readonly Draft[] | null>(null);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void fetchReferencePoints()
      .then((points) => {
        // `null` = jamais réglé depuis le site : on propose les deux repères
        // habituels plutôt qu'une liste vide devant laquelle on hésite.
        setDrafts(points === null || points.length === 0 ? [...SUGGESTED] : [...points]);
      })
      .catch(() => setDrafts([...SUGGESTED]));
  }, []);

  if (!settingsAvailable()) return null;

  const update = (index: number, patch: Partial<Draft>): void => {
    setSaved(false);
    setDrafts((current) =>
      (current ?? []).map((draft, at) => (at === index ? { ...draft, ...patch } : draft)),
    );
  };

  const handleSave = async (): Promise<void> => {
    setSaving(true);
    setError(null);
    try {
      // Une ligne sans adresse ne se géocode pas : on ne l'enregistre pas non
      // plus, sinon elle resterait affichée en promettant une distance qui ne
      // viendrait jamais.
      const points = (drafts ?? [])
        .map((draft) => ({
          label: draft.label.trim(),
          address: draft.address.trim(),
          mode: draft.mode,
        }))
        .filter((point) => point.label !== '' && point.address !== '');
      await saveReferencePoints(points);
      setSaved(true);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Enregistrement impossible');
    } finally {
      setSaving(false);
    }
  };

  const rows = drafts ?? [];

  return (
    <section aria-labelledby="reference-title" className="mt-8">
      <h2 id="reference-title" className="text-lg font-bold">
        Adresses de référence
      </h2>
      <p className="mt-1 text-[0.85rem] text-muted-foreground">
        Le temps de trajet affiché sur chaque annonce se compte depuis ces adresses. Elles restent
        dans votre base, jamais dans le dépôt.
      </p>

      {error !== null && (
        <p
          className="mt-3 rounded-xl border border-bad px-3 py-2 text-[0.88rem] text-bad"
          role="alert"
        >
          {error}
        </p>
      )}

      <ul className="mt-3 flex flex-col gap-2">
        {rows.map((draft, index) => (
          <li key={index} className="rounded-xl border border-border p-3">
            <div className="flex items-start gap-2">
              <MapPin aria-hidden="true" className="mt-2 size-5 shrink-0 text-muted-foreground" />
              <div className="flex min-w-0 flex-1 flex-col gap-2">
                <input
                  className={FIELD}
                  value={draft.label}
                  aria-label={`Nom du repère ${index + 1}`}
                  placeholder="Travail"
                  onChange={(event) => update(index, { label: event.target.value })}
                />
                {/* On tapait à l'aveugle : une faute de frappe ne se voyait
                  qu'à la collecte suivante, le repère restant muet sans que
                  rien ne l'explique. */}
                <AddressField
                  className={FIELD}
                  value={draft.address}
                  ariaLabel={`Adresse de ${draft.label === '' ? `repère ${index + 1}` : draft.label}`}
                  placeholder="12 rue de la République, 06300 Nice"
                  onChange={(address) => update(index, { address })}
                />
                <select
                  className={FIELD}
                  value={draft.mode}
                  aria-label={`Mode de déplacement pour ${draft.label === '' ? `repère ${index + 1}` : draft.label}`}
                  onChange={(event) =>
                    update(index, { mode: event.target.value as ReferenceTravelMode })
                  }
                >
                  {REFERENCE_TRAVEL_MODES.map((mode) => (
                    <option key={mode} value={mode}>
                      {MODE_LABELS[mode]}
                    </option>
                  ))}
                </select>
              </div>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                aria-label={`Retirer ${draft.label === '' ? `le repère ${index + 1}` : draft.label}`}
                onClick={() => {
                  setSaved(false);
                  setDrafts(rows.filter((_, at) => at !== index));
                }}
              >
                <Trash2 aria-hidden="true" className="size-4" />
              </Button>
            </div>
          </li>
        ))}
      </ul>

      <div className="mt-3 flex flex-wrap items-center gap-2">
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => {
            setSaved(false);
            setDrafts([...rows, { label: '', address: '', mode: 'transit' }]);
          }}
        >
          <Plus aria-hidden="true" className="size-4" /> Ajouter un repère
        </Button>
        <Button type="button" size="sm" disabled={saving} onClick={() => void handleSave()}>
          {saving ? 'Enregistrement…' : 'Enregistrer'}
        </Button>
        {saved && (
          <span role="status" className="text-[0.85rem] text-muted-foreground">
            Enregistré. Les distances seront recalculées à la prochaine collecte.
          </span>
        )}
      </div>
    </section>
  );
}
