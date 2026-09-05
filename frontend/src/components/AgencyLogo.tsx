/**
 * Le logo d'une agence, quand on le connaît vraiment.
 *
 * TOUTES LES AGENCES PORTAIENT LA MÊME ICÔNE, ce qui ne distinguait rien : une
 * liste de quarante lignes identiques à gauche du nom. Le logo est le repère le
 * plus rapide — on reconnaît son agence avant d'avoir lu.
 *
 * ON NE L'INVENTE PAS (§17). Deux conditions, et il en fallait bien deux :
 *
 *   1. la source doit être le SITE PROPRE d'une agence — pour un portail comme
 *      FNAIM ou Studapart, le domaine est celui du portail, et l'afficher
 *      donnerait le même logo à des dizaines d'agences différentes ;
 *   2. le nom de la source doit désigner LA MÊME AGENCE. Cette seconde
 *      condition manquait, et c'est ce qui donnait de faux logos : le site
 *      d'une agence locale publie parfois un bien dont le contact est une autre
 *      agence, qui héritait alors du logo de la première.
 *
 * Un logo faux est pire qu'une icône neutre : on le croit.
 *
 * §11 : l'image n'est ni téléchargée ni réhébergée, seulement pointée. Elle
 * vient du site de l'agence, comme les photos d'annonces.
 */

import { useState } from 'react';
import { Agency } from './icons.js';
import { SOURCES } from '../sources.generated.js';

/**
 * Réduit un nom d'agence à sa forme comparable : sans accents, sans casse, sans
 * ponctuation ni espaces. « I.C.I Info Conseil » et « ici info conseil »
 * deviennent la même chaîne.
 */
function comparableName(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '');
}

/**
 * Longueur minimale pour qu'une inclusion de noms fasse foi.
 *
 * Sous ce seuil, l'inclusion ne prouve rien : « immo » se retrouve dans
 * « immo3000 », « immojbf » et la moitié des agences de France.
 */
const MIN_NAME_MATCH = 5;

/** Deux noms désignent-ils la même agence ? */
export function sameAgency(a: string, b: string): boolean {
  const left = comparableName(a);
  const right = comparableName(b);
  if (left === '' || right === '') return false;
  const shorter = left.length <= right.length ? left : right;
  if (shorter.length < MIN_NAME_MATCH) return false;
  return left.includes(right) || right.includes(left);
}

/**
 * Le domaine PROPRE d'une agence, s'il en existe un.
 *
 * LE NOM DOIT CORRESPONDRE, et c'est ce qui manquait. On retenait le premier
 * domaine venu parmi les sources qui mentionnent l'agence — or une source
 * d'agence locale publie parfois des biens dont le contact est une AUTRE
 * agence. Celle-ci héritait alors du logo de la première : un logo faux, ce
 * qui est pire qu'une icône neutre, parce qu'on le croit.
 *
 * On n'affiche donc un logo que lorsqu'on peut l'ATTRIBUER : le nom de l'agence
 * et celui de la source doivent désigner la même maison. Dans le doute, l'icône
 * neutre (§17).
 */
export function agencyDomain(sources: readonly string[], name: string): string | null {
  for (const sourceId of sources) {
    const source = SOURCES[sourceId];
    if (source?.domain === undefined || source.domain === null) continue;
    if (sameAgency(source.name, name)) return source.domain;
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
  const domain = agencyDomain(sources, name);
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
