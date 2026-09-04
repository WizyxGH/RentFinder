/**
 * « Enregistrer cette recherche ».
 *
 * Le geste est celui d'un signet : on vient de régler budget, surface, pièces
 * et sources, la liste montre enfin ce qu'on veut — et on aimerait retrouver
 * cet état demain sans tout refaire.
 *
 * Le nom est PRÉ-REMPLI avec la ville et le budget, les deux faits qui
 * distinguent le mieux une recherche d'une autre. On peut donc enregistrer
 * sans rien taper ; un « Recherche 3 » ne se serait pas reconnu.
 */

import { useState } from 'react';
import { Bookmark, Check } from 'lucide-react';
import { Button } from '@/components/ui/button.js';

interface SaveSearchButtonProps {
  /** Nom proposé, calculé à partir des critères courants. */
  readonly suggestion: string;
  readonly onSave: (name: string) => Promise<void>;
}

export function SaveSearchButton({ suggestion, onSave }: SaveSearchButtonProps): React.JSX.Element {
  const [naming, setNaming] = useState(false);
  const [name, setName] = useState(suggestion);
  const [saved, setSaved] = useState(false);

  if (saved) {
    return (
      <span className="text-good inline-flex items-center gap-1.5 text-sm font-medium">
        <Check aria-hidden="true" className="size-4" /> Recherche enregistrée
      </span>
    );
  }

  if (!naming) {
    return (
      <Button
        variant="outline"
        size="sm"
        onClick={() => {
          setName(suggestion);
          setNaming(true);
        }}
      >
        <Bookmark aria-hidden="true" className="size-4" />
        <span className="hidden sm:inline">Enregistrer cette recherche</span>
        <span className="sm:hidden">Enregistrer</span>
      </Button>
    );
  }

  const confirm = async (): Promise<void> => {
    const trimmed = name.trim();
    if (trimmed === '') return;
    await onSave(trimmed);
    setNaming(false);
    setSaved(true);
    // Le mot « enregistrée » s'efface : c'est un accusé de réception, pas un
    // état. Le bouton revient, prêt pour une autre recherche.
    window.setTimeout(() => setSaved(false), 4000);
  };

  return (
    <form
      className="flex min-w-0 flex-1 items-center gap-2 sm:flex-none"
      onSubmit={(event) => {
        event.preventDefault();
        void confirm();
      }}
    >
      <input
        type="text"
        value={name}
        autoFocus
        aria-label="Nom de la recherche"
        onChange={(event) => setName(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === 'Escape') setNaming(false);
        }}
        // 16 px sur mobile : en dessous, iOS zoome à la mise au point.
        className="min-w-0 flex-1 rounded-full px-3 py-1.5 text-base sm:w-52 sm:flex-none sm:text-sm"
      />
      <Button size="sm" type="submit">
        Enregistrer
      </Button>
      <Button variant="ghost" size="sm" type="button" onClick={() => setNaming(false)}>
        Annuler
      </Button>
    </form>
  );
}
