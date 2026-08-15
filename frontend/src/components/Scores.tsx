/**
 * Affichage des quatre scores (§36, §37).
 *
 * Deux exigences du cahier des charges se rejoignent ici :
 *   - §19 : afficher les RAISONS, pas seulement le chiffre ;
 *   - §17/§18 : signaler ce que le score ignore, pour ne pas laisser croire à
 *     une précision inexistante.
 */

import type { ExplainedScore, ListingScores } from '@rentfinder/shared';
import { Card } from '@/components/ui/card.js';

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

interface ScoreChipProps {
  readonly label: string;
  readonly score: ExplainedScore;
  /** `true` pour le risque, où un score bas est une bonne nouvelle. */
  readonly invert?: boolean;
}

/** Chiffre compact, tel qu'affiché dans la liste. */
export function ScoreChip({ label, score, invert = false }: ScoreChipProps): React.JSX.Element {
  const tone = toneFor(score.value, invert);
  const incomplete = score.unknownSignals.length > 0;

  return (
    <div className="rounded-lg border border-border px-1.5 py-1 text-center">
      <span className="block text-[0.68rem] tracking-wide text-muted-foreground uppercase">
        {label}
      </span>
      <span className={`text-[1.05rem] font-bold ${TONE_TEXT[tone]}`}>
        {score.value}
        {/* Astérisque discret : le score repose sur une information partielle. */}
        {incomplete && (
          <span
            className="cursor-help text-xs text-muted-foreground"
            title={`Calculé sans : ${score.unknownSignals.join(', ')}`}
            aria-label={`information partielle : ${score.unknownSignals.join(', ')}`}
          >
            *
          </span>
        )}
      </span>
    </div>
  );
}

/** Rangée de scores de la carte d'annonce. */
export function ScoreRow({ scores }: { readonly scores: ListingScores }): React.JSX.Element {
  return (
    <div className="mt-2.5 grid grid-cols-4 gap-1.5">
      <ScoreChip label="Match" score={scores.match} />
      <ScoreChip label="Opportunité" score={scores.opportunity} />
      <ScoreChip label="Visite" score={scores.visitProbability} />
      <ScoreChip label="Risque" score={scores.risk} invert />
    </div>
  );
}

interface ScoreDetailProps {
  readonly title: string;
  readonly score: ExplainedScore;
  readonly invert?: boolean;
  /** Note méthodologique affichée sous le score, quand elle s'impose (§18). */
  readonly caveat?: string;
}

/** Score détaillé de la fiche : valeur, raisons, angles morts. */
export function ScoreDetail({
  title,
  score,
  invert = false,
  caveat,
}: ScoreDetailProps): React.JSX.Element {
  const tone = toneFor(score.value, invert);

  return (
    <Card className="mb-3">
      <header className="flex items-baseline justify-between">
        <h3 className="text-base font-semibold">{title}</h3>
        <span className={`font-bold ${TONE_TEXT[tone]}`}>{score.value}/100</span>
      </header>

      {caveat !== undefined && (
        <p className="mt-1.5 text-[0.82rem] text-muted-foreground italic">{caveat}</p>
      )}

      <ul className="mt-2 text-sm">
        {score.reasons.map((reason, index) => (
          <li key={`${reason.code}-${index}`} className="flex gap-2 py-0.5">
            <span aria-hidden="true" className="w-4 shrink-0">
              {reason.delta > 0 ? (invert ? '⚠' : '✓') : reason.delta < 0 ? '⚠' : '·'}
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
    </Card>
  );
}
