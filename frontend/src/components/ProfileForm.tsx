/**
 * Formulaire du profil locataire (§25).
 *
 * Le texte d'avertissement n'est pas décoratif : l'utilisateur doit savoir
 * précisément où vont ces données. Elles ne quittent jamais l'appareil (§26).
 */

import { useState } from 'react';
import type { TenantProfile } from '@rentfinder/shared';
import { EMPTY_PROFILE } from '../profile.js';

interface ProfileFormProps {
  readonly initial: TenantProfile | null;
  readonly onSave: (profile: TenantProfile) => void;
  readonly onCancel: () => void;
  readonly onClear: () => void;
}

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
      className="profile-form"
      onSubmit={(event) => {
        event.preventDefault();
        onSave(profile);
      }}
    >
      <h2>Profil locataire</h2>

      <p className="profile-form__notice">
        Ces informations servent uniquement à composer vos messages de contact. Elles sont
        enregistrées <strong>dans ce navigateur uniquement</strong> : elles ne sont envoyées ni à
        l’API, ni à la base de données, ni à GitHub.
      </p>

      <div className="profile-form__grid">
        <label>
          Prénom
          <input
            type="text"
            value={profile.firstName}
            onChange={(event) => update('firstName', event.target.value)}
            required
          />
        </label>

        <label>
          Nom
          <input
            type="text"
            value={profile.lastName}
            onChange={(event) => update('lastName', event.target.value)}
            required
          />
        </label>

        <label>
          E-mail
          <input
            type="email"
            value={profile.email}
            onChange={(event) => update('email', event.target.value)}
          />
        </label>

        <label>
          Téléphone
          <input
            type="tel"
            value={profile.phone}
            onChange={(event) => update('phone', event.target.value)}
          />
        </label>

        <label>
          Situation professionnelle
          <input
            type="text"
            placeholder="CDI, fonctionnaire, étudiant…"
            value={profile.situation}
            onChange={(event) => update('situation', event.target.value)}
          />
        </label>

        <label>
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

        <label>
          Date d’entrée souhaitée
          <input
            type="date"
            value={profile.moveInDate ?? ''}
            onChange={(event) =>
              update('moveInDate', event.target.value === '' ? null : event.target.value)
            }
          />
        </label>

        <label className="profile-form__checkbox">
          <input
            type="checkbox"
            checked={profile.hasGuarantor}
            onChange={(event) => update('hasGuarantor', event.target.checked)}
          />
          J’ai un garant
        </label>
      </div>

      <div className="profile-form__actions">
        <button type="button" className="btn btn--ghost" onClick={onCancel}>
          Annuler
        </button>
        <button type="button" className="btn btn--secondary" onClick={onClear}>
          Effacer de cet appareil
        </button>
        <button type="submit" className="btn btn--primary">
          Enregistrer
        </button>
      </div>
    </form>
  );
}
