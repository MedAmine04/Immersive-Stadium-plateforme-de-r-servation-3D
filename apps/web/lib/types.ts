export type Role = "spectator" | "manager" | "admin";
export interface User { id: number; email: string; full_name: string; role: Role; is_active: boolean }

export interface Category { code: string; name: string; color: string; default_price_minor: number }
export interface SectionInfo {
  code: string; name: string; stand: string; tier: string; block: number;
  category: string; seat_count: number; phi_start: number; phi_end: number;
}
export interface TierSpec { stand: string; tier: string; phi_start: number; phi_end: number; rows: { d: number; y: number }[]; blocks: number }
export interface BowlSpec {
  pitch: { length: number; width: number };
  corner: { r0: number; k: number };
  eye_height: number;
  roof: { edge_d: number; lip_y: number; slope: number };
  slab_thickness: number;
  tiers: TierSpec[];
}
export interface Venue {
  slug: string; name: string; city: string; country: string; description: string; capacity: number;
  data_fidelity: "estimated" | "verified"; fidelity_notes: string;
  pitch: { length: number; width: number }; bowl: BowlSpec;
  stands: { code: string; name: string; phi_start: number; phi_end: number }[];
  sections: SectionInfo[]; categories: Category[];
}
export interface EventPrice { category: string; name: string; color: string; price_minor: number; on_sale: boolean }
export interface EventInfo {
  id: number; title: string; kind: string; description: string; starts_at: string; status: string;
  demo_mode: boolean; venue_id: number; venue_slug: string; prices: EventPrice[];
}
export interface Availability {
  event_id: number; server_time: string; hold_minutes: number;
  taken: number[]; held_by_me: number[]; confirmed_by_me: number[]; blocked_seats: number[];
  closed_sections: string[]; section_categories: Record<string, string>;
  prices: Record<string, { price_minor: number; on_sale: boolean }>;
  counts: { sold: number; held: number }; section_taken: Record<string, number>; demo_mode: boolean;
}
/** Géométrie columnaire d'un secteur (voir l'API). fl = bit0 PMR, bit1 obstrué, bits2-3 couverture */
export interface SectionSeats {
  section: string; count: number; ids: number[]; rows: number[]; numbers: number[];
  x: number[]; y: number[]; z: number[]; ry: number[]; vs: number[]; de: number[]; el: number[];
  cv: number[]; cl: number[]; fl: number[];
}
export interface SeatRef {
  id: number; section: string; row: number; number: number;
  x: number; y: number; z: number; ry: number;
  viewScore: number; distEdge: number; elevation: number; cValue: number; clearance: number;
  accessible: boolean; obstructed: boolean; cover: "open" | "partial" | "covered";
  category: string; priceMinor: number;
}
export interface ReservationItem { seat_id: number; seat_code: string; category: string; price_minor: number; status: string }
export interface Reservation {
  id: string; reference: string; status: "pending" | "confirmed" | "cancelled" | "expired"; is_demo: boolean;
  demo_notice: string | null; event: { id: number; title: string; starts_at: string };
  total_minor: number; currency: string; created_at: string; expires_at: string | null;
  expires_in_seconds: number | null; confirmed_at: string | null; cancelled_at: string | null;
  items: ReservationItem[]; user_email?: string;
}
