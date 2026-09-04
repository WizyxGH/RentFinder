/**
 * Bandeau éphémère shadcn/ui.
 *
 * Le surface et la pile étaient dessinés à la main dans `ToastStack`, avec des
 * classes propres à lui. Les voici en primitive, comme Button et Card : le
 * bandeau prend le même vocabulaire de thème que le reste, et une deuxième
 * sorte de bandeau — une confirmation, une erreur — n'aura pas à réinventer
 * son cadre.
 */

import { cva, type VariantProps } from 'class-variance-authority';
import { X } from 'lucide-react';
import { cn } from '@/lib/utils.js';

const toastVariants = cva(
  'pointer-events-auto flex w-full items-start gap-2.5 rounded-xl border p-3 shadow-lg',
  {
    variants: {
      variant: {
        default: 'border-border bg-card text-card-foreground',
        /** Une nouveauté à saisir : c'est une bonne nouvelle, pas une alarme. */
        accent: 'border-hot bg-card text-card-foreground',
      },
    },
    defaultVariants: { variant: 'default' },
  },
);

interface ToastProps
  extends React.HTMLAttributes<HTMLDivElement>,
    VariantProps<typeof toastVariants> {}

export function Toast({ className, variant, ...props }: ToastProps): React.JSX.Element {
  return <div className={cn(toastVariants({ variant }), className)} {...props} />;
}

/**
 * Zone d'ancrage de la pile : en bas sur téléphone, au-dessus de la barre
 * d'onglets ; en haut à droite sur grand écran, là où l'œil attend une
 * notification.
 */
export function ToastViewport({
  className,
  ...props
}: React.HTMLAttributes<HTMLDivElement>): React.JSX.Element {
  return (
    <div
      // `aria-live="polite"` : le lecteur d'écran annonce le bandeau sans
      // interrompre la lecture en cours.
      aria-live="polite"
      className={cn(
        'pointer-events-none fixed inset-x-3 bottom-24 z-[3000] flex flex-col gap-2 sm:inset-x-auto sm:top-4 sm:right-4 sm:bottom-auto sm:w-80',
        className,
      )}
      {...props}
    />
  );
}

export function ToastTitle({
  className,
  ...props
}: React.HTMLAttributes<HTMLSpanElement>): React.JSX.Element {
  return <span className={cn('block truncate font-semibold', className)} {...props} />;
}

export function ToastDescription({
  className,
  ...props
}: React.HTMLAttributes<HTMLSpanElement>): React.JSX.Element {
  return (
    <span
      className={cn('text-muted-foreground block truncate text-[0.85rem]', className)}
      {...props}
    />
  );
}

export function ToastClose({
  className,
  ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement>): React.JSX.Element {
  return (
    <button
      type="button"
      aria-label="Fermer"
      className={cn(
        'text-muted-foreground hover:text-foreground shrink-0 cursor-pointer transition-colors',
        className,
      )}
      {...props}
    >
      <X aria-hidden="true" className="size-4" />
    </button>
  );
}
