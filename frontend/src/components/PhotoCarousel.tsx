/**
 * Carrousel de photos d'une carte d'annonce (§36).
 *
 * Un vrai carrousel — flèches, points et GLISSEMENT du doigt —, pas une barre
 * de défilement : une photo à la fois, navigation explicite.
 *
 * CHAQUE GESTE À SA PLACE. Le glissement latéral est le geste du téléphone ;
 * les flèches sont celui de la souris, et ne s'affichent donc QUE sur grand
 * écran. Superposées à la photo sur un écran tactile, elles mangeaient l'image
 * pour doubler un geste déjà naturel.
 *
 * ET LA SÉRIE A DEUX BOUTS. Le carrousel bouclait : à la dernière photo, un
 * glissement ramenait à la première. Rien ne le disait, et on croyait avoir
 * raté un geste ou vu deux fois la même image. La série s'arrête maintenant à
 * ses extrémités — la flèche s'y éteint, le glissement n'y produit rien.
 *
 * Les images sont affichées directement depuis le site d'origine (§11 : jamais
 * téléchargées ni stockées). Une image cassée (retirée côté source) est retirée
 * du carrousel plutôt que d'afficher un cadre vide.
 */

import { useRef, useState } from 'react';
import { ChevronLeft, ChevronRight } from './icons.js';

/** En deçà, c'est une hésitation du doigt, pas une intention de changer de photo. */
const SWIPE_MIN_PX = 40;

/**
 * Flèches : masquées sur téléphone, éteintes au bout de la série.
 *
 * `disabled:opacity-30` plutôt que de les retirer : une flèche qui disparaît
 * décale l'autre et fait sauter la photo. Éteinte, elle dit « c'est le bout »
 * en restant à sa place.
 */
const ARROW =
  'absolute top-1/2 hidden size-7 -translate-y-1/2 cursor-pointer items-center justify-center rounded-full bg-black/45 text-white transition-[background-color,opacity] hover:bg-black/65 disabled:cursor-default disabled:opacity-30 disabled:hover:bg-black/45 sm:flex';

export function PhotoCarousel({
  urls,
  tall = false,
}: {
  readonly urls: readonly string[];
  /**
   * Format FICHE : plus haut, et sans les marges négatives qui font déborder
   * le carrousel des bords de la carte de liste. La fiche n'a pas de cadre à
   * remplir, elle a une image à montrer.
   */
  readonly tall?: boolean;
}): React.JSX.Element {
  const [index, setIndex] = useState(0);
  // Les URLs dont le chargement échoue sont retirées : le carrousel ne montre
  // que des photos réellement disponibles.
  const [broken, setBroken] = useState<ReadonlySet<string>>(new Set());
  // Abscisse du doigt au début du geste. Une `ref` et non un état : elle change
  // à chaque touche et ne doit déclencher aucun rendu.
  const swipeFrom = useRef<number | null>(null);
  const photos = urls.filter((url) => !broken.has(url));

  if (photos.length === 0) return <></>;

  const last = photos.length - 1;
  const clamped = Math.min(index, last);
  // Bornée, et non circulaire : `go(-1)` sur la première ne fait rien.
  const go = (next: number): void => setIndex(Math.max(0, Math.min(next, last)));

  return (
    <div
      className={`relative overflow-hidden bg-muted ${
        tall ? 'h-64 w-full sm:h-80' : '-mx-3 -mt-3 mb-3 h-44 w-[calc(100%+1.5rem)]'
      }`}
      // `touch-pan-y` : le geste VERTICAL reste à la page (on continue de faire
      // défiler la liste en partant d'une photo), l'horizontal nous revient.
      style={{ touchAction: 'pan-y' }}
      onTouchStart={(event) => {
        swipeFrom.current = event.touches[0]?.clientX ?? null;
      }}
      onTouchEnd={(event) => {
        const from = swipeFrom.current;
        swipeFrom.current = null;
        if (from === null || photos.length < 2) return;
        const delta = (event.changedTouches[0]?.clientX ?? from) - from;
        if (Math.abs(delta) < SWIPE_MIN_PX) return;
        // Le glissement ne doit pas ouvrir la fiche : toute la carte est
        // cliquable, et un swipe s'y traduirait sinon par une navigation. Vrai
        // AUSSI au bout de la série, où le geste ne change pas de photo : on a
        // glissé, on n'a pas tapé.
        event.stopPropagation();
        // `go` borne : à la première, un glissement vers la droite ne fait
        // rien ; à la dernière, un glissement vers la gauche non plus.
        go(delta < 0 ? clamped + 1 : clamped - 1);
      }}
    >
      {/* Piste : toutes les photos côte à côte, décalée par transformation. */}
      <div
        className="flex h-full transition-transform duration-300 ease-out"
        style={{ transform: `translateX(-${clamped * 100}%)` }}
      >
        {photos.map((url) => (
          <img
            key={url}
            src={url}
            alt=""
            loading="lazy"
            referrerPolicy="no-referrer"
            className={`w-full shrink-0 object-cover ${tall ? 'h-64 sm:h-80' : 'h-44'}`}
            onError={() => setBroken((current) => new Set(current).add(url))}
          />
        ))}
      </div>

      {photos.length > 1 && (
        <>
          {/* `hidden sm:flex` : la souris seule a besoin de flèches. Sur
            téléphone, le glissement fait le même travail sans rien couvrir. */}
          <button
            type="button"
            aria-label="Photo précédente"
            disabled={clamped === 0}
            onClick={(event) => {
              event.stopPropagation();
              go(clamped - 1);
            }}
            className={`${ARROW} left-1.5`}
          >
            <ChevronLeft aria-hidden="true" className="size-4" />
          </button>
          <button
            type="button"
            aria-label="Photo suivante"
            disabled={clamped === last}
            onClick={(event) => {
              event.stopPropagation();
              go(clamped + 1);
            }}
            className={`${ARROW} right-1.5`}
          >
            <ChevronRight aria-hidden="true" className="size-4" />
          </button>

          {/* Points de position, cliquables. */}
          <div className="absolute right-0 bottom-1.5 left-0 flex justify-center gap-1">
            {photos.map((url, dot) => (
              <button
                key={url}
                type="button"
                aria-label={`Aller à la photo ${dot + 1}`}
                aria-current={dot === clamped}
                onClick={(event) => {
                  event.stopPropagation();
                  setIndex(dot);
                }}
                className={`size-1.5 cursor-pointer rounded-full transition-colors ${
                  dot === clamped ? 'bg-white' : 'bg-white/50'
                }`}
              />
            ))}
          </div>
        </>
      )}
    </div>
  );
}
