import type { SeatRef } from "./types";
export interface HoverState { seat: SeatRef | null; x: number; y: number; status: string }
let state: HoverState = { seat: null, x: 0, y: 0, status: "" };
const listeners = new Set<() => void>();
export const hoverStore = {
  get: () => state,
  set(next: HoverState) { state = next; listeners.forEach((l) => l()); },
  subscribe(l: () => void) { listeners.add(l); return () => { listeners.delete(l); }; },
};
