/**
 * Formulaire du profil locataire (§25).
 *
 * Le texte d'avertissement n'est pas décoratif : l'utilisateur doit savoir
 * précisément où vont ces données. Elles ne quittent jamais l'appareil (§26).
 */

import { useState } from 'react';
import type { Guarantor, GuarantorKind, TenantProfile } from '@rentfinder/shared';
import { MAX_GUARANTORS, TENANT_SITUATIONS } from '@rentfinder/shared';
import { EMPTY_PROFILE, GUARANTOR_OPTIONS } from '../profile.js';
import { Plus, Trash2 } from './icons.js';
import { Button } from '@/components/ui/button.js';

interface ProfileFormProps {
  readonly initial: TenantProfile | null;
  readonly onSave: (profile: TenantProfile) => void;
  readonly onCancel: () => void;
  /**
   * Absent pendant le PREMIER PARCOURS : « Effacer de cet appareil » n'a pas
   * de sens devant un profil qu'on est en train de créer, et proposer d'effacer
   * ce qui n'existe pas encore n'inspire rien de bon.
   */
  readonly onClear?: () => void;
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

  /** `false` quand la situation est un texte libre : le champ « Autre » s'ouvre. */
  const knownSituation = TENANT_SITUATIONS.some(
    (one) => one.value === profile.situation && one.value !== 'other',
  );

  const setGuarantors = (guarantors: readonly Guarantor[]): void =>
    setProfile((previous) => ({ ...previous, guarantors }));

  const setGuarantor = (index: number, guarantor: Guarantor): void => {
    // Un nom vide est RETIRÉ plutôt que stocké : le profil ne garde pas de
    // chaîne vide qui se retrouverait ensuite dans un message (§17).
    const name = guarantor.name?.trim() ?? '';
    const cleaned: Guarantor = { kind: guarantor.kind, ...(name === '' ? {} : { name }) };
    setGuarantors(profile.guarantors.map((one, i) => (i === index ? cleaned : one)));
  };

  const removeGuarantor = (index: number): void =>
    setGuarantors(profile.guarantors.filter((_one, i) => i !== index));

  const addGuarantor = (): void => setGuarantors([...profile.guarantors, { kind: 'physical' }]);

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

        {/* UN MENU, ET NON UN CHAMP LIBRE. Le message dit « Je suis {situation} » :
            le texte libre produisait « Je suis en fonctionnaire », et
            « fonctionnaire » était justement l'exemple donné à l'utilisateur.
            Chaque entrée de la liste porte sa propre tournure. La liste reprend
            les situations que bailleurs et organismes de caution distinguent. */}
        <label className={FIELD}>
          Situation professionnelle
          <select
            value={knownSituation ? profile.situation : 'other'}
            onChange={(event) =>
              update('situation', event.target.value === 'other' ? '' : event.target.value)
            }
            className="border-border bg-card text-foreground rounded-lg border px-2.5 py-2 text-[0.9rem]"
          >
            {TENANT_SITUATIONS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </label>

        {!knownSituation && (
          <label className={FIELD}>
            Précisez votre situation
            <input
              type="text"
              placeholder="Intermittent, pensionné…"
              value={profile.situation}
              onChange={(event) => update('situation', event.target.value)}
            />
          </label>
        )}

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

        {/* PLUSIEURS GARANTIES, et non plus une seule. Deux parents se portent
            souvent caution ensemble, et l'on cumule volontiers un garant
            physique avec une garantie Visale — c'est même ce qui fait la force
            d'un dossier. Un champ unique obligeait à taire la moitié de ce
            qu'on a. */}
        <fieldset className="sm:col-span-2">
          <legend className="text-muted-foreground mb-1 text-[0.88rem]">Garanties de loyer</legend>

          {profile.guarantors.length === 0 && (
            <p className="text-muted-foreground mb-2 text-[0.82rem]">
              Aucune pour l’instant. Le dossier reposera sur vos seuls revenus.
            </p>
          )}

          <ul className="mb-2 flex flex-col gap-2">
            {profile.guarantors.map((guarantor, index) => {
              const option = GUARANTOR_OPTIONS.find((one) => one.kind === guarantor.kind);
              return (
                <li key={index} className="border-border rounded-xl border p-2.5">
                  <div className="flex items-start gap-2">
                    <select
                      aria-label={`Garantie ${index + 1}`}
                      value={guarantor.kind}
                      onChange={(event) =>
                        setGuarantor(index, { kind: event.target.value as GuarantorKind })
                      }
                      className="border-border bg-card text-foreground min-w-0 flex-1 rounded-lg border px-2.5 py-2 text-[0.9rem]"
                    >
                      {GUARANTOR_OPTIONS.map((one) => (
                        <option key={one.kind} value={one.kind}>
                          {one.label}
                        </option>
                      ))}
                    </select>
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      aria-label={`Retirer la garantie ${index + 1}`}
                      onClick={() => removeGuarantor(index)}
                    >
                      <Trash2 aria-hidden="true" className="size-4" />
                    </Button>
                  </div>

                  {option?.namePlaceholder !== undefined && (
                    <input
                      type="text"
                      aria-label={`Nom de la garantie ${index + 1}`}
                      placeholder={option.namePlaceholder}
                      value={guarantor.name ?? ''}
                      onChange={(event) =>
                        setGuarantor(index, { kind: guarantor.kind, name: event.target.value })
                      }
                      className="mt-2 w-full"
                    />
                  )}

                  <p className="text-muted-foreground mt-1.5 text-[0.8rem]">{option?.hint}</p>
                </li>
              );
            })}
          </ul>

          {profile.guarantors.length < MAX_GUARANTORS && (
            <Button type="button" variant="outline" size="sm" onClick={addGuarantor}>
              <Plus aria-hidden="true" className="size-4" /> Ajouter une garantie
            </Button>
          )}
        </fieldset>
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
        {onClear !== undefined && (
          <Button type="button" variant="outline" onClick={onClear}>
            Effacer de cet appareil
          </Button>
        )}
        <Button type="submit">Enregistrer</Button>
      </div>
    </form>
  );
}
