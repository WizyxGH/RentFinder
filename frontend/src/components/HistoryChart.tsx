/**
 * Évolution de l'inventaire jour par jour (§33).
 *
 * SVG écrit à la main : une courbe et quelques repères ne justifient pas une
 * bibliothèque de graphiques dans le bundle (§65).
 */

import type { DailyStat } from '../types.js';

const WIDTH = 600;
const HEIGHT = 160;
const PADDING = { top: 12, right: 12, bottom: 22, left: 34 };

interface HistoryChartProps {
  readonly history: readonly DailyStat[];
}

/** Date courte pour l'axe : « 01/09 ». */
function shortDay(day: string): string {
  const [, month, date] = day.split('-');
  return `${date ?? ''}/${month ?? ''}`;
}

export function HistoryChart({ history }: HistoryChartProps): React.JSX.Element {
  if (history.length < 2) {
    return (
      <p className="text-sm text-muted-foreground">
        L’historique se construit à chaque collecte — revenez après quelques passages.
        {history.length === 1 &&
          ` Un seul point pour l’instant (${history[0]?.matching} annonces).`}
      </p>
    );
  }

  const plotWidth = WIDTH - PADDING.left - PADDING.right;
  const plotHeight = HEIGHT - PADDING.top - PADDING.bottom;
  // L'échelle part de zéro : une courbe tronquée exagérerait les variations.
  const max = Math.max(...history.map((d) => d.matching + d.uncertain), 1);

  const x = (i: number): number =>
    PADDING.left + (history.length === 1 ? plotWidth / 2 : (i * plotWidth) / (history.length - 1));
  const y = (value: number): number => PADDING.top + plotHeight - (value / max) * plotHeight;

  const line = (pick: (d: DailyStat) => number): string =>
    history.map((d, i) => `${i === 0 ? 'M' : 'L'} ${x(i)} ${y(pick(d))}`).join(' ');

  const last = history[history.length - 1];
  const first = history[0];
  const delta = last !== undefined && first !== undefined ? last.matching - first.matching : 0;

  return (
    <figure className="flex flex-col gap-2">
      <svg
        viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
        className="w-full"
        role="img"
        aria-label={`Évolution des annonces pertinentes : ${first?.matching} le ${first?.day}, ${last?.matching} le ${last?.day}`}
      >
        {[0, max / 2, max].map((v) => (
          <g key={v}>
            <line
              x1={PADDING.left}
              x2={WIDTH - PADDING.right}
              y1={y(v)}
              y2={y(v)}
              className="stroke-border"
              strokeWidth={1}
            />
            <text x={4} y={y(v) + 4} className="fill-muted-foreground text-[10px]">
              {Math.round(v)}
            </text>
          </g>
        ))}

        <path
          d={line((d) => d.matching + d.uncertain)}
          fill="none"
          className="stroke-muted-foreground"
          strokeWidth={1.5}
          strokeDasharray="4 3"
        />
        <path d={line((d) => d.matching)} fill="none" className="stroke-primary" strokeWidth={2} />

        {history.map((d, i) => (
          <circle key={d.day} cx={x(i)} cy={y(d.matching)} r={2.5} className="fill-primary" />
        ))}

        {[first, last].map((d, i) =>
          d === undefined ? null : (
            <text
              key={d.day}
              x={i === 0 ? PADDING.left : WIDTH - PADDING.right}
              y={HEIGHT - 6}
              textAnchor={i === 0 ? 'start' : 'end'}
              className="fill-muted-foreground text-[10px]"
            >
              {shortDay(d.day)}
            </text>
          ),
        )}
      </svg>

      <figcaption className="flex flex-wrap items-center gap-3 text-sm text-muted-foreground">
        <span className="flex items-center gap-1.5">
          <span className="inline-block h-0.5 w-4 bg-primary" aria-hidden="true" />
          pertinentes
        </span>
        <span className="flex items-center gap-1.5">
          <span
            className="inline-block h-0.5 w-4 border-t-2 border-dashed border-muted-foreground"
            aria-hidden="true"
          />
          avec les « à vérifier »
        </span>
        {delta !== 0 && (
          <span className={delta > 0 ? 'font-medium text-primary' : ''}>
            {delta > 0 ? '+' : ''}
            {delta} depuis le {shortDay(first?.day ?? '')}
          </span>
        )}
      </figcaption>
    </figure>
  );
}
