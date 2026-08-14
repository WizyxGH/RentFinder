/**
 * Affichage des quatre scores (§36, §37).
 *
 * Deux exigences du cahier des charges se rejoignent ici :
 *   - §19 : afficher les RAISONS, pas seulement le chiffre ;
 *   - §17/§18 : signaler ce que le score ignore, pour ne pas laisser croire à
 *     une précision inexistante.
 */

import type { ExplainedScore, ListingScores } from '@rentfinder/shared';

/** Palette par plage : vert au-dessus de 75, orange au-dessus de 50, rouge sinon. */
function toneFor(value: number, invert: boolean): 'good' | 'medium' | 'bad' {
  const effective = invert ? 100 - value : value;
  if (effective >= 75) return 'good';
  if (effective >= 50) return 'medium';
  return 'bad';
}

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
    <div className={`score-chip score-chip--${tone}`}>
      <span className="score-chip__label">{label}</span>
      <span className="score-chip__value">
        {score.value}
        {/* Astérisque discret : le score repose sur une information partielle. */}
        {incomplete && (
          <span
            className="score-chip__partial"
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
    <div className="score-row">
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
    <section className="score-detail">
      <header className="score-detail__header">
        <h3>{title}</h3>
        <span className={`score-detail__value score-detail__value--${tone}`}>
          {score.value}/100
        </span>
      </header>

      {caveat !== undefined && <p className="score-detail__caveat">{caveat}</p>}

      <ul className="score-detail__reasons">
        {score.reasons.map((reason, index) => (
          <li key={`${reason.code}-${index}`} className="score-detail__reason">
            <span aria-hidden="true" className="score-detail__marker">
              {reason.delta > 0 ? (invert ? '⚠' : '✓') : reason.delta < 0 ? '⚠' : '·'}
            </span>
            <span>{reason.label}</span>
          </li>
        ))}
      </ul>

      {/* §17 : dire explicitement ce qui manquait plutôt que de le taire. */}
      {score.unknownSignals.length > 0 && (
        <p className="score-detail__unknown">
          Information non fournie par les sources : {score.unknownSignals.join(', ')}.
        </p>
      )}
    </section>
  );
}
