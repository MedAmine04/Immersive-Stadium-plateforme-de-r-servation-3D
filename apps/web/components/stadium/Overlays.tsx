"use client";

import { useSyncExternalStore } from "react";
import { hoverStore } from "@/lib/hoverStore";
import { COVER_LABEL, seatLabel, viewQuality } from "@/lib/seats";
import { formatPrice } from "@/lib/format";
import type { Category, SeatRef } from "@/lib/types";

export function HoverTooltip({ categories }: { categories: Category[] }) {
  const h = useSyncExternalStore(hoverStore.subscribe, hoverStore.get, hoverStore.get);
  if (!h.seat) return null;
  const cat = categories.find((c) => c.code === h.seat!.category);
  return (
    <div className="pointer-events-none fixed z-40 rounded-lg border border-white/10 bg-ink-900/95 px-3 py-2 text-xs shadow-xl backdrop-blur" style={{ left: h.x + 14, top: h.y + 14 }}>
      <div className="font-semibold text-white">{seatLabel(h.seat)}</div>
      <div className="mt-0.5 flex items-center gap-2 text-slate-300">
        <span className="inline-block h-2 w-2 rounded-full" style={{ background: cat?.color }} />
        {cat?.name} · {formatPrice(h.seat.priceMinor)}
      </div>
      <div className="mt-0.5 text-slate-400">{h.status} · vue {viewQuality(h.seat.viewScore).toLowerCase()}</div>
    </div>
  );
}

export function Legend({ categories, prices, onlyUsed }: { categories: Category[]; prices: Record<string, { price_minor: number; on_sale: boolean }> | undefined; onlyUsed?: boolean }) {
  return (
    <div className="rounded-xl border border-white/10 bg-ink-900/80 p-3 text-xs backdrop-blur">
      <div className="mb-1.5 font-semibold uppercase tracking-wider text-slate-400">Catégories</div>
      <ul className="space-y-1">
        {categories.filter((c) => !onlyUsed || prices?.[c.code]).map((c) => (
          <li key={c.code} className="flex items-center gap-2 text-slate-200">
            <span className="h-2.5 w-2.5 shrink-0 rounded-sm" style={{ background: c.color }} />
            <span className="flex-1">{c.name}</span>
            <span className="tabular-nums text-slate-400">{prices?.[c.code] ? formatPrice(prices[c.code].price_minor) : "—"}</span>
          </li>
        ))}
      </ul>
      <div className="mt-2 grid grid-cols-2 gap-x-3 gap-y-1 border-t border-white/10 pt-2 text-slate-400">
        <span className="flex items-center gap-1.5"><i className="h-2 w-2 rounded-sm bg-[#ffd166]" />Sélection</span>
        <span className="flex items-center gap-1.5"><i className="h-2 w-2 rounded-sm bg-[#3b414d]" />Pris</span>
        <span className="flex items-center gap-1.5"><i className="h-2 w-2 rounded-sm bg-[#4cc9f0]" />PMR</span>
        <span className="flex items-center gap-1.5"><i className="h-2 w-2 rounded-sm bg-[#2dd4bf]" />Mon verrou</span>
      </div>
    </div>
  );
}

export function SeatCard({
  seat, status, selected, comparing, canCompare, onView, onToggle, onCompare, onClose, categories,
}: {
  seat: SeatRef; status: string; selected: boolean; comparing: boolean; canCompare: boolean; categories: Category[];
  onView: () => void; onToggle: () => void; onCompare: () => void; onClose: () => void;
}) {
  const cat = categories.find((c) => c.code === seat.category);
  const available = status === "Disponible" || status === "Dans votre sélection" || status === "Verrouillé pour vous";
  return (
    <div className="w-[min(92vw,420px)] rounded-2xl border border-white/10 bg-ink-900/95 p-4 shadow-2xl backdrop-blur">
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="text-xs uppercase tracking-wider text-slate-400">{seat.section}</div>
          <div className="text-lg font-semibold text-white">Rang {seat.row} · Siège {seat.number}</div>
          <div className="mt-0.5 flex items-center gap-2 text-sm text-slate-300">
            <span className="h-2.5 w-2.5 rounded-sm" style={{ background: cat?.color }} />{cat?.name} · {formatPrice(seat.priceMinor)}
          </div>
        </div>
        <button onClick={onClose} aria-label="Fermer" className="rounded-md p-1 text-slate-400 hover:bg-white/10 hover:text-white">✕</button>
      </div>
      <dl className="mt-3 grid grid-cols-3 gap-2 text-center text-xs">
        <div className="rounded-lg bg-white/5 p-2"><dt className="text-slate-400">Distance</dt><dd className="mt-0.5 font-semibold text-white">{seat.distEdge.toFixed(0)} m</dd></div>
        <div className="rounded-lg bg-white/5 p-2"><dt className="text-slate-400">Hauteur de vue</dt><dd className="mt-0.5 font-semibold text-white">{seat.elevation.toFixed(0)}°</dd></div>
        <div className="rounded-lg bg-white/5 p-2"><dt className="text-slate-400">Vue</dt><dd className="mt-0.5 font-semibold text-white">{viewQuality(seat.viewScore)}</dd></div>
      </dl>
      <p className="mt-2 text-xs text-slate-400">
        {COVER_LABEL[seat.cover]}{seat.accessible ? " · Place PMR" : ""}{seat.obstructed ? " · Vue possiblement gênée" : ""} · <span className="text-amber-300/90">estimation indicative</span>
      </p>
      <div className="mt-3 flex flex-wrap gap-2">
        <button onClick={onView} className="btn btn-primary flex-1">Voir depuis ce siège</button>
        <button onClick={onToggle} disabled={!available} className={`btn flex-1 ${selected ? "btn-danger" : "btn-gold"}`}>
          {!available ? status : selected ? "Retirer" : "Ajouter"}
        </button>
        <button onClick={onCompare} disabled={!comparing && !canCompare} className="btn btn-ghost" title="Comparer jusqu'à 3 places">
          {comparing ? "✓ Comparé" : "Comparer"}
        </button>
      </div>
    </div>
  );
}
