/**
 * Profil locataire en lecture, avec accès à sa modification (§25).
 *
 * Le formulaire s'ouvrait dépliée en permanence : huit champs en haut de
 * l'écran Paramètres, alors qu'on les remplit une fois pour toutes. On voit
 * désormais ce qui est renseigné, ce qui manque, et l'on n'ouvre le formulaire
 * que pour y toucher.
 *
 * Ce que ce composant montre ne quitte jamais l'appareil : il lit ce que le
 * navigateur a stocké, rien d'autre (§26).
 */

import type { TenantProfile } from '@rentfinder/shared';
import { BadgeEuro, CalendarDays, Mail, Phone, ShieldCheck, User } from './icons.js';
import { UNKNOWN_LABEL, formatPhone } from '../format.js';
import { guarantorLabel } from '../profile.js';
import { SettingsGroup, SettingsRow } from './SettingsRow.js';
import { Button } from '@/components/ui/button.js';

/** Champs affichés, dans l'ordre où une agence les demande. */
function lines(profile: TenantProfile): readonly {
  readonly key: string;
  readonly Icon: typeof User;
  readonly label: string;
  readonly value: string | null;
}[] {
  const name = [profile.firstName, profile.lastName].filter((part) => part !== '').join(' ');
  return [
    { key: 'name', Icon: User, label: 'Identité', value: name === '' ? null : name },
    {
      key: 'email',
      Icon: Mail,
      label: 'E-mail',
      value: profile.email === '' ? null : profile.email,
    },
    {
      key: 'phone',
      Icon: Phone,
      label: 'Téléphone',
      value: profile.phone === '' ? null : formatPhone(profile.phone),
    },
    {
      key: 'situation',
      Icon: ShieldCheck,
      label: 'Situation',
      value: profile.situation === '' ? null : profile.situation,
    },
    {
      key: 'income',
      Icon: BadgeEuro,
      label: 'Revenus mensuels',
      value: profile.monthlyIncome === null ? null : `${profile.monthlyIncome} €`,
    },
    {
      key: 'guarantor',
      Icon: ShieldCheck,
      label: 'Garantie',
      value: guarantorLabel(profile),
    },
    {
      key: 'moveIn',
      Icon: CalendarDays,
      label: 'Entrée souhaitée',
      value:
        profile.moveInDate === null
          ? null
          : new Date(profile.moveInDate).toLocaleDateString('fr-FR'),
    },
  ];
}

export function ProfileSummary({
  profile,
  onEdit,
}: {
  readonly profile: TenantProfile | null;
  readonly onEdit: () => void;
}): React.JSX.Element {
  if (profile === null) {
    return (
      <section aria-labelledby="profile-title">
        <h2 id="profile-title" className="text-lg font-bold">
          Profil locataire
        </h2>
        <p className="mt-1 text-[0.85rem] text-muted-foreground">
          Renseigné une fois, il compose vos messages de candidature. Il reste sur cet appareil et
          n’est jamais transmis.
        </p>
        <Button className="mt-3" onClick={onEdit}>
          Renseigner mon profil
        </Button>
      </section>
    );
  }

  const rows = lines(profile);
  const filled = rows.filter((row) => row.value !== null).length;

  return (
    <section aria-labelledby="profile-title">
      <div className="flex items-baseline justify-between gap-2">
        <h2 id="profile-title" className="text-lg font-bold">
          Profil locataire
        </h2>
        <Button variant="outline" size="sm" onClick={onEdit}>
          Modifier
        </Button>
      </div>
      <p className="mt-1 text-[0.85rem] text-muted-foreground">
        Reste sur cet appareil, jamais transmis.
      </p>

      <SettingsGroup title="Vos informations" count={`${filled}/${rows.length}`}>
        {rows.map(({ key, Icon, label, value }) => (
          <SettingsRow
            key={key}
            Icon={Icon}
            tone={value !== null ? 'done' : 'muted'}
            label={label}
            hint={value ?? UNKNOWN_LABEL}
          />
        ))}
      </SettingsGroup>
    </section>
  );
}
