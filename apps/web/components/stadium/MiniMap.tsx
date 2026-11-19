"use client";

import { memo, useMemo } from "react";
import { ringPointAtPhi, tierEdges, tierFor, unwrapRange } from "@/lib/geometry";
import type { Availability, SectionInfo, SectionSeats, Venue } from "@/lib/types";

/** Plan 2D du stade (vue du dessus), synchronisé avec la scène 3D : mêmes secteurs, mêmes couleurs, même sélection. */
function MiniMapImpl({
  venue, availability, categoryColors, activeSection, hoverSection, selectedPoints, viewPoint, onSectionClick, onSectionHover,
}: {
  venue: Venue; availability: Availability | null; categoryColors: Record<string, string>;
  activeSection: string | null; hoverSection: string | null;
  selectedPoints: { x: number; z: number }[]; viewPoint: { x: number; z: number } | null;
  onSectionClick: (c: string) => void; onSectionHover: (c: string | null) => void;
}) {
  const { shapes, ext } = useMemo(() => {
    const bowl = venue.bowl;
    let maxD = 0;
    const order: Record<string, number> = { L: 0, M: 1, U: 2 };
    const list = [...venue.sections].sort((a, b) => order[a.tier] - order[b.tier]);
    const shapes = list.map((s: SectionInfo) => {
      const t = tierFor(bowl, s);
      const e = tierEdges(t);
      maxD = Math.max(maxD, e[e.length - 1]);
      const [p0, p1] = unwrapRange(s.phi_start, s.phi_end);
      const n = Math.max(2, Math.ceil((p1 - p0) / 4));
      const outer: string[] = [], inner: string[] = [];
      for (let k = 0; k <= n; k++) {
        const phi = p0 + 0.2 + ((p1 - p0 - 0.4) * k) / n;
        const [ox, oz] = ringPointAtPhi(bowl, e[e.length - 1], phi);
        const [ix, iz] = ringPointAtPhi(bowl, e[0], phi);
        outer.push(`${ox.toFixed(1)},${oz.toFixed(1)}`);
        inner.unshift(`${ix.toFixed(1)},${iz.toFixed(1)}`);
      }
      return { code: s.code, tier: s.tier, d: `M${outer.join("L")}L${inner.join("L")}Z`, category: s.category };
    });
    return { shapes, ext: { x: bowl.pitch.width / 2 + maxD + 3, z: bowl.pitch.length / 2 + maxD + 3 } };
  }, [venue]);

  const closed = new Set(availability?.closed_sections ?? []);
  return (
    <svg viewBox={`${-ext.x} ${-ext.z} ${ext.x * 2} ${ext.z * 2}`} className="h-full w-full" role="img" aria-label="Plan du stade">
      <rect x={-venue.pitch.width / 2} y={-venue.pitch.length / 2} width={venue.pitch.width} height={venue.pitch.length} fill="#2a7035" stroke="#e8f5e9" strokeWidth={0.8} />
      <line x1={-venue.pitch.width / 2} x2={venue.pitch.width / 2} y1={0} y2={0} stroke="#e8f5e9" strokeWidth={0.6} />
      <circle r={9.15} fill="none" stroke="#e8f5e9" strokeWidth={0.6} />
      {shapes.map((s) => {
        const cat = availability?.section_categories[s.code] ?? s.category;
        const isClosed = closed.has(s.code);
        const active = s.code === activeSection, hov = s.code === hoverSection;
        return (
          <path
            key={s.code} d={s.d} fill={isClosed ? "#2c313b" : categoryColors[cat] ?? "#8899aa"}
            fillOpacity={s.tier === "U" ? 0.72 : 0.95} stroke={active ? "#ffd166" : hov ? "#fff" : "#0b1020"}
            strokeWidth={active ? 1.6 : hov ? 1.2 : 0.35} className="cursor-pointer"
            onClick={() => onSectionClick(s.code)} onMouseEnter={() => onSectionHover(s.code)} onMouseLeave={() => onSectionHover(null)}
          >
            <title>{s.code}</title>
          </path>
        );
      })}
      {selectedPoints.map((p, i) => <circle key={i} cx={p.x} cy={p.z} r={2.6} fill="#ffd166" stroke="#0b1020" strokeWidth={0.6} />)}
      {viewPoint && (
        <g>
          <line x1={viewPoint.x} y1={viewPoint.z} x2={0} y2={0} stroke="#fff" strokeWidth={0.6} strokeDasharray="2 2" />
          <circle cx={viewPoint.x} cy={viewPoint.z} r={3.4} fill="#ff6bd6" stroke="#fff" strokeWidth={0.8} />
        </g>
      )}
    </svg>
  );
}
export default memo(MiniMapImpl);
