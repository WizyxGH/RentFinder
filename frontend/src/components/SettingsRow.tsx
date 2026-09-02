/**
 * Rangée de réglage : icône, intitulé, précision, et une commande à droite.
 *
 * Motif commun à tout l'écran Paramètres — accès aux autres écrans, pièces du
 * dossier, profil. Les trois s'écrivaient différemment alors qu'ils disent la
 * même chose : « voici un élément, voici son état, voici ce qu'on peut en
 * faire ». Un seul composant les aligne et évite qu'ils dérivent.
 */

import type { LucideIcon } from 'lucide-react';

export function SettingsRow({
  Icon,
  label,
  hint,
  badge,
  trailing,
  onClick,
  tone = 'muted',
  children,
}: {
  readonly Icon: LucideIcon;
  readonly label: string;
  readonly hint?: string;
  /** Court état affiché à côté de l'intitulé (« 2 pièces », « À fournir »). */
  readonly badge?: string;
  /** Commande de droite : chevron, bouton… */
  readonly trailing?: React.ReactNode;
  /** Rend la rangée entière cliquable. Sans lui, elle reste inerte. */
  readonly onClick?: () => void;
  /** `done` colore l'icône : ce qui est fourni se repère d'un coup d'œil. */
  readonly tone?: 'muted' | 'done';
  /** Contenu déplié sous la rangée (liste de fichiers, formulaire…). */
  readonly children?: React.ReactNode;
}): React.JSX.Element {
  const head = (
    <>
      <Icon
        aria-hidden="true"
        className={`size-5 shrink-0 ${tone === 'done' ? 'text-primary' : 'text-muted-foreground'}`}
      />
      <span className="min-w-0 flex-1">
        <span className="flex items-baseline gap-2">
          <span className="font-medium">{label}</span>
          {badge !== undefined && <span className="text-xs text-muted-foreground">{badge}</span>}
        </span>
        {hint !== undefined && (
          <span className="block text-[0.82rem] text-muted-foreground">{hint}</span>
        )}
      </span>
      {trailing}
    </>
  );

  return (
    <li className="rounded-xl border border-border">
      {onClick !== undefined ? (
        <button
          type="button"
          onClick={onClick}
          className="flex w-full cursor-pointer items-center gap-3 p-3 text-left transition-colors hover:bg-muted"
        >
          {head}
        </button>
      ) : (
        <div className="flex items-center gap-3 p-3">{head}</div>
      )}
      {children !== undefined && <div className="border-t border-border p-3">{children}</div>}
    </li>
  );
}

/** Liste de rangées, avec son intitulé de section. */
export function SettingsGroup({
  title,
  count,
  children,
}: {
  readonly title: string;
  /** Avancement, du type « 2/4 ». Omis quand il n'y a rien à compter. */
  readonly count?: string;
  readonly children: React.ReactNode;
}): React.JSX.Element {
  return (
    <section className="mt-5">
      <h3 className="mb-2 flex items-baseline gap-2 text-sm font-semibold text-muted-foreground">
        {title}
        {count !== undefined && <span className="font-normal">{count}</span>}
      </h3>
      <ul className="flex flex-col gap-2">{children}</ul>
    </section>
  );
}
