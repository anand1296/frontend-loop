/**
 * The "loop": one ring for the whole interview loop. Each arc is a section,
 * sized by its number of questions and filled by how many you've done.
 * Decorative for assistive tech (the section list next to it carries the same
 * information as text), but clickable for pointer users.
 */
import type { SectionMeta } from '../content/types.ts';

interface Segment {
  section: SectionMeta;
  done: number;
}

const SIZE = 240;
const CENTER = SIZE / 2;
const RADIUS = 98;
const STROKE = 18;
const GAP_DEG = 2.4;

function polar(angleDeg: number): [number, number] {
  const rad = ((angleDeg - 90) * Math.PI) / 180;
  return [CENTER + RADIUS * Math.cos(rad), CENTER + RADIUS * Math.sin(rad)];
}

function arcPath(startDeg: number, endDeg: number): string {
  const [x1, y1] = polar(startDeg);
  const [x2, y2] = polar(endDeg);
  const large = endDeg - startDeg > 180 ? 1 : 0;
  return `M ${x1.toFixed(2)} ${y1.toFixed(2)} A ${RADIUS} ${RADIUS} 0 ${large} 1 ${x2.toFixed(2)} ${y2.toFixed(2)}`;
}

export function LoopRing({
  segments,
  done,
  total,
  onSelect,
}: {
  segments: Segment[];
  done: number;
  total: number;
  onSelect: (sectionId: string) => void;
}) {
  const usable = 360 - GAP_DEG * segments.length;
  let cursor = GAP_DEG / 2;

  return (
    <figure className="loop-ring">
      <svg viewBox={`0 0 ${SIZE} ${SIZE}`} role="img" aria-label={`${done} of ${total} questions done`}>
        {segments.map(({ section, done: sectionDone }) => {
          const count = section.questions.length;
          const sweep = (count / total) * usable;
          const start = cursor;
          const end = start + sweep;
          const filledEnd = start + sweep * (count === 0 ? 0 : sectionDone / count);
          cursor = end + GAP_DEG;
          return (
            <g key={section.id} className="loop-seg" onClick={() => onSelect(section.id)}>
              <title>{`${section.title}: ${sectionDone} of ${count} done`}</title>
              <path d={arcPath(start, end)} className="loop-track" strokeWidth={STROKE} fill="none" />
              {sectionDone > 0 ? (
                <path
                  d={arcPath(start, Math.max(filledEnd, start + 0.5))}
                  className={sectionDone === count ? 'loop-fill is-complete' : 'loop-fill'}
                  strokeWidth={STROKE}
                  fill="none"
                />
              ) : null}
            </g>
          );
        })}
        <text x={CENTER} y={CENTER - 4} textAnchor="middle" className="loop-count">
          {done}
          <tspan className="loop-total">/{total}</tspan>
        </text>
        <text x={CENTER} y={CENTER + 22} textAnchor="middle" className="loop-caption">
          questions done
        </text>
      </svg>
    </figure>
  );
}
