/**
 * Pièces du dossier de candidature (§25) — écran Paramètres.
 *
 * CE PANNEAU NE STOCKE PLUS RIEN, et il le dit. Les pièces vivaient sur le
 * disque de la machine qui servait le site (`data/`, hors dépôt), servies par
 * un petit serveur local. Ce serveur a été retiré le 2026-09-04 : le site ne
 * tourne plus qu'en ligne, et une page hébergée ne peut pas lire le disque de
 * votre ordinateur.
 *
 * ON NE FAIT PAS SEMBLANT. Un écran de dépôt qui accepterait des fichiers pour
 * les perdre au rechargement serait pire que pas d'écran du tout : on
 * croirait son dossier prêt. Le panneau explique donc où en sont les choses,
 * et ce qu'il faudrait pour les rétablir.
 *
 * L'écran de contact, lui, dégrade proprement : sans pièces à proposer, il
 * n'affiche simplement pas la liste à cocher.
 */

import { FolderOpen } from 'lucide-react';
import { Card } from '@/components/ui/card.js';

export function DocumentsSection(): React.JSX.Element {
  return (
    <section>
      <h2 className="mb-2 text-lg font-bold">Dossier de candidature</h2>
      <Card className="flex gap-3">
        <FolderOpen aria-hidden="true" className="text-muted-foreground mt-0.5 size-5 shrink-0" />
        <div className="text-[0.92rem]">
          <p className="mb-2">
            Les pièces étaient conservées sur l’ordinateur qui servait le site. Ce serveur local a
            été retiré&nbsp;: une page hébergée ne peut pas lire votre disque, et rien ne les
            héberge pour l’instant.
          </p>
          <p className="text-muted-foreground">
            En attendant, joignez-les à la main à vos messages. Elles pourront revenir ici le jour
            où on leur donne un hébergement — un espace de fichiers chez Cloudflare, à côté de
            l’API.
          </p>
        </div>
      </Card>
    </section>
  );
}
