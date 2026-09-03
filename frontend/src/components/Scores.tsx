/**
 * Affichage détaillé des quatre scores, sur la FICHE (§37).
 *
 * La carte de liste n'en montre plus aucun : sa barre de priorité les résume.
 * Ici on vient au contraire pour comprendre, d'où le détail complet.
 *
 * Deux exigences du cahier des charges se rejoignent ici :
 *   - §19 : afficher les RAISONS, pas seulement le chiffre ;
 *   - §17/§18 : signaler ce que le score ignore, pour ne pas laisser croire à
 *     une précision inexistante.
 */

import type { ExplainedScore } from '@rentfinder/shared';
import { Card } from '@/components/ui/card.js';
import { Check, Dot, TriangleAlert } from 'lucide-react';

/** Palette par plage : vert au-dessus de 75, orange au-dessus de 50, rouge sinon. */
function toneFor(value: number, invert: boolean): 'good' | 'medium' | 'bad' {
  const effective = invert ? 100 - value : value;
  if (effective >= 75) return 'good';
  if (effective >= 50) return 'medium';
  return 'bad';
}

/**
 * Classes complètes par ton — jamais de `text-${tone}` dynamique : le scanner
 * Tailwind ne détecte que les littéraux.
 */
const TONE_TEXT: Record<'good' | 'medium' | 'bad', string> = {
  good: 'text-good',
  medium: 'text-medium',
  bad: 'text-bad',
};

interface ScoreDetailProps {
  readonly title: string;
  readonly score: ExplainedScore;
  readonly invert?: boolean;
  /** Note méthodologique affichée sous le score, quand elle s'impose (§18). */
  readonly caveat?: string;
}

/**
 * Score détaillé de la fiche : valeur, raisons, angles morts.
 *
 * Repliable (§37 : agir vite) — l'en-tête (titre + score) reste toujours
 * visible, le détail se déplie à la demande. `<details>` natif : accessible au
 * clavier, sans JavaScript.
 */
export function ScoreDetail({
  title,
  score,
  invert = false,
  caveat,
}: ScoreDetailProps): React.JSX.Element {
  const tone = toneFor(score.value, invert);
  const incomplete = score.unknownSignals.length > 0;

  return (
    <Card className="mb-3 p-0">
      <details className="group">
        <summary className="flex cursor-pointer list-none items-baseline justify-between p-3">
          <h3 className="text-base font-semibold">
            {title}
            <span
              aria-hidden="true"
              className="ml-1.5 inline-block text-xs text-muted-foreground transition-transform group-open:rotate-90"
            >
              ▸
            </span>
          </h3>
          <span className={`font-bold ${TONE_TEXT[tone]}`}>
            {score.value}/100
            {incomplete && <span className="text-[0.7rem] text-muted-foreground">*</span>}
          </span>
        </summary>

        <div className="px-3 pb-3">
          {caveat !== undefined && (
            <p className="text-[0.82rem] text-muted-foreground italic">{caveat}</p>
          )}

          <ul className="mt-2 text-sm">
            {score.reasons.map((reason, index) => (
              <li key={`${reason.code}-${index}`} className="flex gap-2 py-0.5">
                <span aria-hidden="true" className="flex w-4 shrink-0 justify-center pt-0.5">
                  <ReasonIcon delta={reason.delta} invert={invert} />
                </span>
                <span>{reason.label}</span>
              </li>
            ))}
          </ul>

          {/* §17 : dire explicitement ce qui manquait plutôt que de le taire. */}
          {score.unknownSignals.length > 0 && (
            <p className="mt-1.5 text-[0.82rem] text-muted-foreground italic">
              Information non fournie par les sources : {score.unknownSignals.join(', ')}.
            </p>
          )}
        </div>
      </details>
    </Card>
  );
}

/**
 * Pictogramme d'une raison de score : un point quand elle est neutre, une
 * coche quand elle joue en faveur, un avertissement quand elle pèse contre.
 * Le score de RISQUE s'inverse — un delta positif y est une mauvaise nouvelle.
 */
function ReasonIcon({
  delta,
  invert,
}: {
  readonly delta: number;
  readonly invert: boolean;
}): React.JSX.Element {
  if (delta === 0) return <Dot className="size-4" />;
  const bad = delta < 0 || invert;
  return bad ? <TriangleAlert className="size-3.5" /> : <Check className="size-3.5" />;
}
