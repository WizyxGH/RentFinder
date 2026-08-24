/**
 * Formulaire du profil locataire (§25).
 *
 * Le texte d'avertissement n'est pas décoratif : l'utilisateur doit savoir
 * précisément où vont ces données. Elles ne quittent jamais l'appareil (§26).
 */

import { useState } from 'react';
import type { TenantProfile } from '@rentfinder/shared';
import { EMPTY_PROFILE } from '../profile.js';
import { Button } from '@/components/ui/button.js';

interface ProfileFormProps {
  readonly initial: TenantProfile | null;
  readonly onSave: (profile: TenantProfile) => void;
  readonly onCancel: () => void;
  readonly onClear: () => void;
}

const FIELD = 'flex flex-col gap-1 text-[0.88rem] text-muted-foreground';

export function ProfileForm({
  initial,
  onSave,
  onCancel,
  onClear,
}: ProfileFormProps): React.JSX.Element {
  const [profile, setProfile] = useState<TenantProfile>(initial ?? EMPTY_PROFILE);

  const update = <K extends keyof TenantProfile>(key: K, value: TenantProfile[K]): void => {
    setProfile((previous) => ({ ...previous, [key]: value }));
  };

  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        onSave(profile);
      }}
    >
      <h2 className="mb-2 text-lg font-bold">Profil locataire</h2>

      <p className="border-l-3 border-primary pl-2.5 text-[0.85rem] text-muted-foreground">
        Ces informations servent uniquement à composer vos messages de contact. Elles sont
        enregistrées <strong>dans ce navigateur uniquement</strong> : elles ne sont envoyées ni à
        l’API, ni à la base de données, ni à GitHub.
      </p>

      <div className="my-4 grid gap-2.5 sm:grid-cols-2">
        <label className={FIELD}>
          Prénom
          <input
            type="text"
            value={profile.firstName}
            onChange={(event) => update('firstName', event.target.value)}
            required
          />
        </label>

        <label className={FIELD}>
          Nom
          <input
            type="text"
            value={profile.lastName}
            onChange={(event) => update('lastName', event.target.value)}
            required
          />
        </label>

        <label className={FIELD}>
          E-mail
          <input
            type="email"
            value={profile.email}
            onChange={(event) => update('email', event.target.value)}
          />
        </label>

        <label className={FIELD}>
          Téléphone
          <input
            type="tel"
            value={profile.phone}
            onChange={(event) => update('phone', event.target.value)}
          />
        </label>

        <label className={FIELD}>
          Situation professionnelle
          <input
            type="text"
            placeholder="CDI, fonctionnaire, étudiant…"
            value={profile.situation}
            onChange={(event) => update('situation', event.target.value)}
          />
        </label>

        <label className={FIELD}>
          Revenus mensuels (€)
          <input
            type="number"
            min="0"
            value={profile.monthlyIncome ?? ''}
            onChange={(event) =>
              update(
                'monthlyIncome',
                event.target.value === '' ? null : Number.parseInt(event.target.value, 10),
              )
            }
          />
        </label>

        <label className={FIELD}>
          Date d’entrée souhaitée
          <input
            type="date"
            value={profile.moveInDate ?? ''}
            onChange={(event) =>
              update('moveInDate', event.target.value === '' ? null : event.target.value)
            }
          />
        </label>

        <label className="flex flex-row items-center gap-2 text-[0.88rem] text-muted-foreground">
          <input
            type="checkbox"
            checked={profile.hasGuarantor}
            onChange={(event) => update('hasGuarantor', event.target.checked)}
          />
          J’ai un garant
        </label>
      </div>

      {/* §24 : message de candidature UNIQUE, envoyé tel quel pour toutes les
          annonces. C'est TOUJOURS vous qui l'envoyez (bouton « Ouvrir »). */}
      <label className={`${FIELD} my-4`}>
        Message de candidature (identique pour toutes les annonces)
        <textarea
          rows={8}
          value={profile.applicationMessage ?? ''}
          onChange={(event) => update('applicationMessage', event.target.value)}
          placeholder={`Bonjour,\n\nVotre annonce m'intéresse. Je suis en CDI, revenus 3× le loyer, garant possible. Serait-il possible de convenir d'une visite ?\n\nCordialement,\n${profile.firstName} ${profile.lastName}\n${profile.phone}`.trim()}
          className="rounded-lg border border-border bg-card px-2.5 py-2 font-sans text-[0.9rem] text-foreground"
        />
        <span className="text-[0.8rem]">
          Laissé vide, un message personnalisé par annonce est généré à la place. L’objet de
          l’e-mail reprend la référence du bien pour que l’agence l’identifie.
        </span>
      </label>

      <div className="flex flex-wrap gap-2">
        <Button type="button" variant="ghost" onClick={onCancel}>
          Annuler
        </Button>
        <Button type="button" variant="outline" onClick={onClear}>
          Effacer de cet appareil
        </Button>
        <Button type="submit">Enregistrer</Button>
      </div>
    </form>
  );
}
