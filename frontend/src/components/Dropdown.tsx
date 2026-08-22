/**
 * Menu déroulant générique (§39) : un bouton ouvre un panneau flottant.
 *
 * Mutualise le comportement commun des filtres de la barre d'outils —
 * ouverture/fermeture, fermeture au clic extérieur et à Échap — pour que la
 * liste reste lisible et compacte, sur mobile comme sur ordinateur.
 */

import { useEffect, useId, useRef, useState, type ReactNode } from 'react';
import { Button } from '@/components/ui/button.js';

interface DropdownProps {
  /** Texte du bouton. */
  readonly label: string;
  /** Compteur affiché en pastille (ex. nombre de filtres actifs). 0 = caché. */
  readonly badge?: number;
  /** Contenu du panneau. */
  readonly children: ReactNode;
  /** Largeur du panneau (classe Tailwind), défaut `w-64`. */
  readonly panelClassName?: string;
  /** Filtre actif : surligne le bouton (façon SeLoger) pour le signaler. */
  readonly active?: boolean;
}

export function Dropdown({
  label,
  badge = 0,
  children,
  panelClassName = 'w-64',
  active = false,
}: DropdownProps): React.JSX.Element {
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const panelId = useId();

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: PointerEvent): void => {
      if (!containerRef.current?.contains(event.target as Node)) setOpen(false);
    };
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') setOpen(false);
    };
    document.addEventListener('pointerdown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('pointerdown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [open]);

  return (
    <div ref={containerRef} className="relative">
      <Button
        type="button"
        variant="outline"
        size="sm"
        aria-haspopup="true"
        aria-expanded={open}
        aria-controls={panelId}
        onClick={() => setOpen((value) => !value)}
        className={active ? 'border-primary font-semibold text-primary' : undefined}
      >
        {label}
        {badge > 0 && (
          <span className="ml-1.5 inline-flex min-w-4 items-center justify-center rounded-full bg-primary px-1 text-[0.7rem] leading-none font-semibold text-primary-foreground">
            {badge}
          </span>
        )}{' '}
        <span aria-hidden="true">▾</span>
      </Button>

      {open && (
        <div
          id={panelId}
          className={`absolute left-0 z-20 mt-1 max-h-72 overflow-y-auto rounded-xl border border-border bg-card p-2 text-sm shadow-lg ${panelClassName}`}
        >
          {children}
        </div>
      )}
    </div>
  );
}
