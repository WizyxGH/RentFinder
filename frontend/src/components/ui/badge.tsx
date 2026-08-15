/** Badge shadcn/ui — statuts de suivi, avertissements « hors critères ». */

import { cva, type VariantProps } from 'class-variance-authority';
import { cn } from '@/lib/utils.js';

const badgeVariants = cva(
  'inline-flex items-center rounded-full px-2 py-0.5 text-xs whitespace-nowrap',
  {
    variants: {
      variant: {
        default: 'bg-border text-foreground',
        warning: 'border border-medium bg-transparent text-medium',
        good: 'border border-good/40 bg-good/10 text-good',
      },
    },
    defaultVariants: { variant: 'default' },
  },
);

interface BadgeProps
  extends React.HTMLAttributes<HTMLSpanElement>, VariantProps<typeof badgeVariants> {}

export function Badge({ className, variant, ...props }: BadgeProps): React.JSX.Element {
  return <span className={cn(badgeVariants({ variant }), className)} {...props} />;
}
