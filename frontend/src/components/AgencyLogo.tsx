/**
 * Le logo d'une agence, quand on le connaît vraiment.
 *
 * TOUTES LES AGENCES PORTAIENT LA MÊME ICÔNE, ce qui ne distinguait rien : une
 * liste de quarante lignes identiques à gauche du nom. Le logo est le repère le
 * plus rapide — on reconnaît son agence avant d'avoir lu.
 *
 * ON NE L'INVENTE PAS (§17). Il n'est affiché que pour les agences dont nous
 * collectons le SITE PROPRE : leur domaine est alors celui de l'agence, et son
 * favicon est son logo. Pour celles connues seulement par un portail — FNAIM,
 * Studapart —, le domaine est celui du portail : l'afficher donnerait le même
 * logo à des dizaines d'agences différentes. Celles-là gardent l'icône neutre.
 *
 * §11 : l'image n'est ni téléchargée ni réhébergée, seulement pointée. Elle
 * vient du site de l'agence, comme les photos d'annonces.
 */

import { useState } from 'react';
import { Agency } from './icons.js';
import { SOURCES } from '../sources.generated.js';

/**
 * Le domaine PROPRE d'une agence, s'il en existe un.
 *
 * Une agence peut venir de plusieurs sources — son site et un portail. On
 * retient le premier domaine connu : c'est le sien.
 */
export function agencyDomain(sources: readonly string[]): string | null {
  for (const sourceId of sources) {
    const domain = SOURCES[sourceId]?.domain;
    if (domain !== undefined && domain !== null) return domain;
  }
  return null;
}

export function AgencyLogo({
  sources,
  name,
  className = 'size-5',
}: {
  readonly sources: readonly string[];
  readonly name: string;
  readonly className?: string;
}): React.JSX.Element {
  const domain = agencyDomain(sources);
  // Une image qui ne charge pas laisserait un carré vide, plus laid que
  // l'icône qu'elle remplace : on repasse à celle-ci.
  const [broken, setBroken] = useState(false);

  if (domain === null || broken) {
    return <Agency aria-hidden="true" className={`text-muted-foreground shrink-0 ${className}`} />;
  }

  return (
    <img
      src={`https://${domain}/favicon.ico`}
      alt=""
      aria-hidden="true"
      loading="lazy"
      onError={() => setBroken(true)}
      title={name}
      className={`shrink-0 rounded object-contain ${className}`}
    />
  );
}
