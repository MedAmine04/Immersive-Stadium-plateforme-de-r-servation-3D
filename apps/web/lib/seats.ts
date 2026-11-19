import type { Availability, SeatRef, SectionSeats } from "./types";

export function seatRefAt(sd: SectionSeats, i: number, av: Availability | null, category: string): SeatRef {
  const fl = sd.fl[i];
  return {
    id: sd.ids[i], section: sd.section, row: sd.rows[i], number: sd.numbers[i],
    x: sd.x[i], y: sd.y[i], z: sd.z[i], ry: sd.ry[i],
    viewScore: sd.vs[i], distEdge: sd.de[i], elevation: sd.el[i], cValue: sd.cv[i], clearance: sd.cl[i],
    accessible: (fl & 1) === 1, obstructed: (fl & 2) === 2,
    cover: (["open", "partial", "covered"] as const)[(fl >> 2) & 3] ?? "open",
    category, priceMinor: av?.prices[category]?.price_minor ?? 0,
  };
}

export const COVER_LABEL = { open: "Découverte", partial: "Partiellement couverte", covered: "Couverte" } as const;

export function seatLabel(s: Pick<SeatRef, "section" | "row" | "number">) {
  return `${s.section} · rang ${s.row} · siège ${s.number}`;
}

export function viewQuality(score: number) {
  if (score >= 72) return "Excellente";
  if (score >= 60) return "Très bonne";
  if (score >= 48) return "Bonne";
  return "Correcte";
}
