import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

/** Fusion de classes façon shadcn/ui : conditions via clsx, conflits Tailwind résolus. */
export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
}
