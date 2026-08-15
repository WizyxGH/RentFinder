/** Carte shadcn/ui — surface de base de toutes les vues. */

import { cn } from '@/lib/utils.js';

export function Card({
  className,
  ...props
}: React.HTMLAttributes<HTMLDivElement>): React.JSX.Element {
  return (
    <div
      className={cn('rounded-xl border border-border bg-card p-3 text-card-foreground', className)}
      {...props}
    />
  );
}
