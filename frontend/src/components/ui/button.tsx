/**
 * Bouton shadcn/ui, adapté au projet :
 *   - `min-h-11` (44 px) sur toutes les tailles : cible tactile mobile (§36) ;
 *   - variantes limitées à ce que l'interface utilise réellement (§65).
 */

import { cva, type VariantProps } from 'class-variance-authority';
import { cn } from '@/lib/utils.js';

const buttonVariants = cva(
  // Pilule arrondie, à la SeLoger — la forme signature des CTA du site.
  'inline-flex min-h-11 cursor-pointer items-center justify-center gap-2 rounded-full text-[0.95rem] font-medium whitespace-nowrap no-underline transition-colors focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none disabled:pointer-events-none disabled:opacity-50',
  {
    variants: {
      variant: {
        default: 'bg-primary font-semibold text-primary-foreground hover:bg-primary/90',
        outline: 'border border-border bg-card text-foreground hover:border-primary',
        ghost: 'text-primary hover:bg-primary/10',
      },
      size: {
        default: 'px-3.5 py-2',
        sm: 'px-3 py-1.5 text-sm',
      },
    },
    defaultVariants: { variant: 'default', size: 'default' },
  },
);

interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>, VariantProps<typeof buttonVariants> {}

export function Button({ className, variant, size, ...props }: ButtonProps): React.JSX.Element {
  return <button className={cn(buttonVariants({ variant, size }), className)} {...props} />;
}

/** Mêmes styles pour un lien qui se présente comme un bouton (action « Ouvrir »). */
export function ButtonLink({
  className,
  variant,
  size,
  ...props
}: React.AnchorHTMLAttributes<HTMLAnchorElement> &
  VariantProps<typeof buttonVariants>): React.JSX.Element {
  return <a className={cn(buttonVariants({ variant, size }), className)} {...props} />;
}

export { buttonVariants };
