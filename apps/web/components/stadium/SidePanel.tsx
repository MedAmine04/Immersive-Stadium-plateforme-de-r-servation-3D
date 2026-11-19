"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { api } from "@/lib/api";
import { formatDate, formatPrice } from "@/lib/format";
import { COVER_LABEL, seatLabel, viewQuality } from "@/lib/seats";
import type { Availability, Category, EventInfo, Reservation, SeatRef, User } from "@/lib/types";

export type Tab = "selection" | "compare" | "recommend";

function useCountdown(initial: number | null, active: boolean) {
  const [left, setLeft] = useState(initial ?? 0);
  useEffect(() => { setLeft(initial ?? 0); }, [initial]);
  useEffect(() => {
    if (!active) return;
    const id = setInterval(() => setLeft((v) => Math.max(v - 1, 0)), 1000);
    return () => clearInterval(id);
  }, [active, initial]);
  return left;
}

const mmss = (s: number) => `${String(Math.floor(s / 60)).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`;

function Money({ v }: { v: number }) { return <span className="tabular-nums">{formatPrice(v)}</span>; }

/* ------------------------------ Réservation en cours ------------------------------ */
function ReservationCard({ res, busy, onConfirm, onCancel, onExpired }: {
  res: Reservation; busy: boolean; onConfirm: () => void; onCancel: () => void; onExpired: () => void;
}) {
  const left = useCountdown(res.expires_in_seconds, res.status === "pending");
  useEffect(() => { if (res.status === "pending" && left === 0 && (res.expires_in_seconds ?? 0) >= 0) onExpired(); }, [left]); // eslint-disable-line react-hooks/exhaustive-deps
  if (res.status === "confirmed") {
    return (
      <div className="rounded-xl border border-emerald-400/30 bg-emerald-400/10 p-4">
        <div className="text-xs font-semibold uppercase tracking-wider text-emerald-300">Réservation de démonstration confirmée</div>
        <div className="mt-1 font-display text-2xl text-white">{res.reference}</div>
        <p className="mt-2 rounded-md bg-amber-400/10 p-2 text-xs text-amber-200">{res.demo_notice}</p>
        <ul className="mt-3 space-y-1 text-sm text-slate-200">
          {res.items.map((i) => <li key={i.seat_id} className="flex justify-between"><span>{i.seat_code}</span><Money v={i.price_minor} /></li>)}
        </ul>
        <div className="mt-2 flex justify-between border-t border-white/10 pt-2 font-semibold text-white"><span>Total (fictif)</span><Money v={res.total_minor} /></div>
        <div className="mt-3 flex gap-2">
          <Link href="/reservations" className="btn btn-ghost flex-1">Mes réservations</Link>
          <button className="btn btn-ghost" onClick={onCancel} disabled={busy}>Annuler</button>
        </div>
      </div>
    );
  }
  return (
    <div className="rounded-xl border border-sky-400/30 bg-sky-400/10 p-4">
      <div className="flex items-center justify-between">
        <div className="text-xs font-semibold uppercase tracking-wider text-sky-300">Places verrouillées pour vous</div>
        <div className={`rounded-md px-2 py-0.5 font-mono text-sm ${left < 60 ? "bg-red-500/20 text-red-300" : "bg-white/10 text-white"}`}>{mmss(left)}</div>
      </div>
      <p className="mt-1 text-xs text-slate-300">Réf. {res.reference}. Confirmez avant la fin du délai, sinon les places seront libérées.</p>
      <ul className="mt-2 space-y-1 text-sm text-slate-200">
        {res.items.map((i) => <li key={i.seat_id} className="flex justify-between"><span>{i.seat_code}</span><Money v={i.price_minor} /></li>)}
      </ul>
      <div className="mt-2 flex justify-between border-t border-white/10 pt-2 font-semibold text-white"><span>Total</span><Money v={res.total_minor} /></div>
      <div className="mt-3 flex gap-2">
        <button className="btn btn-gold flex-1" onClick={onConfirm} disabled={busy || left === 0}>Confirmer (démo, sans paiement)</button>
        <button className="btn btn-ghost" onClick={onCancel} disabled={busy}>Libérer</button>
      </div>
    </div>
  );
}

/* ------------------------------ Onglet sélection ------------------------------ */
function SelectionTab(p: PanelProps) {
  const total = p.selected.reduce((s, x) => s + x.priceMinor, 0);
  const sold = p.availability?.counts.sold ?? 0;
  return (
    <div className="space-y-4">
      {p.reservation && (
        <ReservationCard res={p.reservation} busy={p.busy} onConfirm={p.onConfirm} onCancel={p.onCancel} onExpired={p.onExpired} />
      )}
      {p.error && <div role="alert" className="rounded-lg border border-red-400/30 bg-red-500/10 p-3 text-sm text-red-200">{p.error}</div>}
      {!p.reservation && (
        <>
          <div>
            <div className="mb-2 flex items-baseline justify-between">
              <h3 className="text-sm font-semibold text-white">Ma sélection</h3>
              <span className="text-xs text-slate-400">{p.selected.length} / {p.maxSeats} places</span>
            </div>
            {p.selected.length === 0 ? (
              <p className="rounded-lg border border-dashed border-white/15 p-4 text-center text-sm text-slate-400">
                Cliquez sur un secteur, puis sur un siège, pour l’ajouter ici. Vous pouvez aussi utiliser les recommandations.
              </p>
            ) : (
              <ul className="space-y-1.5">
                {p.selected.map((s) => (
                  <li key={s.id} className="flex items-center gap-2 rounded-lg bg-white/5 px-3 py-2 text-sm">
                    <span className="h-2.5 w-2.5 rounded-sm" style={{ background: p.categories.find((c) => c.code === s.category)?.color }} />
                    <button className="flex-1 text-left text-slate-100 hover:underline" onClick={() => p.onViewSeat(s)}>{seatLabel(s)}</button>
                    <Money v={s.priceMinor} />
                    <button aria-label="Retirer" className="text-slate-400 hover:text-white" onClick={() => p.onRemove(s.id)}>✕</button>
                  </li>
                ))}
              </ul>
            )}
          </div>
          {p.selected.length > 0 && (
            <div className="rounded-xl bg-white/5 p-3">
              <div className="flex justify-between text-sm"><span className="text-slate-300">Total</span><span className="text-lg font-semibold text-white"><Money v={total} /></span></div>
              <p className="mt-1 text-[11px] text-slate-400">Montant fictif : aucun paiement ne sera demandé.</p>
              <div className="mt-3 flex gap-2">
                <button className="btn btn-gold flex-1" onClick={p.onReserve} disabled={p.busy}>{p.user ? "Verrouiller ces places" : "Se connecter pour réserver"}</button>
                <button className="btn btn-ghost" onClick={p.onClear}>Vider</button>
              </div>
            </div>
          )}
        </>
      )}
      <div className="rounded-xl border border-white/10 p-3 text-xs text-slate-400">
        <div className="mb-1 font-semibold uppercase tracking-wider">Disponibilité</div>
        {sold} places vendues · {p.availability?.counts.held ?? 0} temporairement verrouillées. Verrouillage : {p.availability?.hold_minutes ?? 10} min.
      </div>
    </div>
  );
}

/* ------------------------------ Onglet comparaison ------------------------------ */
function CompareTab(p: PanelProps) {
  if (p.compare.length === 0) {
    return <p className="rounded-lg border border-dashed border-white/15 p-4 text-center text-sm text-slate-400">Sélectionnez un siège puis « Comparer » (jusqu’à 3) pour comparer proximité, angle, couverture et vue.</p>;
  }
  const best = (f: (s: SeatRef) => number, hi = true) => {
    const vals = p.compare.map(f);
    return hi ? Math.max(...vals) : Math.min(...vals);
  };
  const rows: { label: string; get: (s: SeatRef) => string; num?: (s: SeatRef) => number; hi?: boolean }[] = [
    { label: "Catégorie", get: (s) => p.categories.find((c) => c.code === s.category)?.name ?? s.category },
    { label: "Prix", get: (s) => formatPrice(s.priceMinor), num: (s) => s.priceMinor, hi: false },
    { label: "Distance au terrain", get: (s) => `${s.distEdge.toFixed(0)} m`, num: (s) => s.distEdge, hi: false },
    { label: "Angle de vue", get: (s) => `${s.elevation.toFixed(0)}°` },
    { label: "Couverture", get: (s) => COVER_LABEL[s.cover] },
    { label: "Dégagement visuel", get: (s) => (s.obstructed ? "Gêne possible" : "Dégagé"), num: (s) => (s.obstructed ? 0 : 1) },
    { label: "Score de vue", get: (s) => `${s.viewScore.toFixed(0)} / 100 · ${viewQuality(s.viewScore)}`, num: (s) => s.viewScore },
  ];
  return (
    <div className="space-y-3">
      <div className={`grid gap-2`} style={{ gridTemplateColumns: `repeat(${p.compare.length}, minmax(0,1fr))` }}>
        {p.compare.map((s) => (
          <div key={s.id} className="overflow-hidden rounded-xl border border-white/10 bg-white/5">
            <button className="block aspect-video w-full bg-ink-900" onClick={() => p.onViewSeat(s)} title="Voir depuis ce siège">
              {p.thumbs[s.id] ? <img src={p.thumbs[s.id]} alt={`Vue depuis ${seatLabel(s)}`} className="h-full w-full object-cover" /> : <span className="text-xs text-slate-500">Aperçu…</span>}
            </button>
            <div className="p-2 text-xs">
              <div className="font-semibold text-white">{s.section}</div>
              <div className="text-slate-400">Rang {s.row} · n° {s.number}</div>
              <button className="mt-1 text-slate-400 underline hover:text-white" onClick={() => p.onRemoveCompare(s.id)}>Retirer</button>
            </div>
          </div>
        ))}
      </div>
      <div className="overflow-hidden rounded-xl border border-white/10 text-xs">
        {rows.map((r) => {
          const top = r.num ? best(r.num, r.hi ?? true) : null;
          return (
            <div key={r.label} className="grid border-b border-white/5 last:border-0" style={{ gridTemplateColumns: `100px repeat(${p.compare.length}, minmax(0,1fr))` }}>
              <div className="bg-white/5 p-2 text-slate-400">{r.label}</div>
              {p.compare.map((s) => (
                <div key={s.id} className={`p-2 ${top !== null && p.compare.length > 1 && r.num!(s) === top ? "font-semibold text-emerald-300" : "text-slate-200"}`}>{r.get(s)}</div>
              ))}
            </div>
          );
        })}
      </div>
      <p className="text-[11px] text-slate-500">Vignettes et métriques calculées sur un modèle estimé : indicatif.</p>
    </div>
  );
}

/* ------------------------------ Onglet recommandations ------------------------------ */
interface Rec { seat_ids: number[]; section: string; row: number; numbers: number[]; total_minor: number; score: number; why: { view_score: number; dist_edge_m: number; elevation_deg: number; cover: string } }

function RecommendTab(p: PanelProps) {
  const [count, setCount] = useState(2);
  const [budget, setBudget] = useState("");
  const [priority, setPriority] = useState<"view" | "proximity" | "value">("view");
  const [adjacent, setAdjacent] = useState(true);
  const [pmr, setPmr] = useState(false);
  const [res, setRes] = useState<Rec[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function run() {
    setLoading(true); setErr(null);
    try {
      const body = { count, priority, adjacent, accessible_only: pmr, max_price_minor: budget ? Math.round(Number(budget) * 100) : null, limit: 5 };
      const r = await api<{ results: Rec[] }>(`/api/events/${p.event.id}/recommend`, { body });
      setRes(r.results);
    } catch (e: any) { setErr(e.message); } finally { setLoading(false); }
  }
  return (
    <div className="space-y-3">
      <p className="text-xs text-slate-400">Le moteur filtre les places disponibles selon vos critères puis les classe avec un score explicable (proximité, angle, centralité). Aucune boîte noire.</p>
      <div className="grid grid-cols-2 gap-2">
        <div><label className="label">Nombre de places</label><input className="field" type="number" min={1} max={8} value={count} onChange={(e) => setCount(Math.min(8, Math.max(1, Number(e.target.value) || 1)))} /></div>
        <div><label className="label">Budget max / place (MAD)</label><input className="field" type="number" min={0} placeholder="illimité" value={budget} onChange={(e) => setBudget(e.target.value)} /></div>
      </div>
      <div>
        <label className="label">Priorité</label>
        <select className="field" value={priority} onChange={(e) => setPriority(e.target.value as any)}>
          <option value="view">Meilleure vue d’ensemble</option>
          <option value="proximity">Au plus près du terrain</option>
          <option value="value">Meilleur rapport vue / prix</option>
        </select>
      </div>
      <label className="flex items-center gap-2 text-sm text-slate-200"><input type="checkbox" checked={adjacent} onChange={(e) => setAdjacent(e.target.checked)} />Places côte à côte</label>
      <label className="flex items-center gap-2 text-sm text-slate-200"><input type="checkbox" checked={pmr} onChange={(e) => setPmr(e.target.checked)} />Places accessibles PMR uniquement</label>
      <button className="btn btn-gold w-full" onClick={run} disabled={loading}>{loading ? "Recherche…" : "Trouver mes places"}</button>
      {err && <div role="alert" className="text-sm text-red-300">{err}</div>}
      {res && res.length === 0 && <p className="text-sm text-slate-400">Aucune place ne répond à ces critères. Élargissez le budget ou décochez « côte à côte ».</p>}
      <ul className="space-y-2">
        {res?.map((r, i) => (
          <li key={i} className="rounded-xl border border-white/10 bg-white/5 p-3 text-sm">
            <div className="flex items-baseline justify-between"><span className="font-semibold text-white">{r.section} · rang {r.row}</span><Money v={r.total_minor} /></div>
            <div className="text-xs text-slate-400">Sièges {r.numbers.join(", ")} · vue {r.why.view_score}/100 · {r.why.dist_edge_m} m du terrain · {r.why.elevation_deg}° · {COVER_LABEL[r.why.cover as keyof typeof COVER_LABEL]}</div>
            <div className="mt-2 flex gap-2">
              <button className="btn btn-ghost flex-1" onClick={() => p.onRecView(r.seat_ids, r.section)}>Voir</button>
              <button className="btn btn-gold flex-1" onClick={() => p.onRecAdd(r.seat_ids, r.section)}>Ajouter</button>
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}

/* ------------------------------ Panneau ------------------------------ */
export interface PanelProps {
  event: EventInfo; availability: Availability | null; categories: Category[]; user: User | null;
  selected: SeatRef[]; maxSeats: number; compare: SeatRef[]; thumbs: Record<number, string>;
  reservation: Reservation | null; busy: boolean; error: string | null;
  tab: Tab; setTab: (t: Tab) => void;
  onRemove: (id: number) => void; onClear: () => void; onViewSeat: (s: SeatRef) => void;
  onRemoveCompare: (id: number) => void;
  onReserve: () => void; onConfirm: () => void; onCancel: () => void; onExpired: () => void;
  onRecView: (ids: number[], section: string) => void; onRecAdd: (ids: number[], section: string) => void;
}

export default function SidePanel(p: PanelProps) {
  const tabs: { id: Tab; label: string; badge?: number }[] = [
    { id: "selection", label: "Sélection", badge: p.selected.length },
    { id: "compare", label: "Comparer", badge: p.compare.length },
    { id: "recommend", label: "Recommandations" },
  ];
  return (
    <aside className="flex h-full min-h-0 flex-col border-l border-white/10 bg-ink-900">
      <div className="border-b border-white/10 p-4">
        <div className="text-[11px] font-semibold uppercase tracking-wider text-gold-400">{p.event.kind}</div>
        <h1 className="font-display text-xl leading-snug text-white">{p.event.title}</h1>
        <div className="mt-0.5 text-sm text-slate-400">{formatDate(p.event.starts_at)}</div>
      </div>
      <div role="tablist" className="flex border-b border-white/10">
        {tabs.map((t) => (
          <button key={t.id} role="tab" aria-selected={p.tab === t.id} onClick={() => p.setTab(t.id)}
            className={`flex-1 px-2 py-2.5 text-sm ${p.tab === t.id ? "border-b-2 border-gold-400 text-white" : "text-slate-400 hover:text-white"}`}>
            {t.label}{t.badge ? <span className="ml-1.5 rounded-full bg-gold-400 px-1.5 text-[11px] font-semibold text-ink-950">{t.badge}</span> : null}
          </button>
        ))}
      </div>
      <div className="scroll-thin min-h-0 flex-1 overflow-y-auto p-4">
        {p.tab === "selection" && <SelectionTab {...p} />}
        {p.tab === "compare" && <CompareTab {...p} />}
        {p.tab === "recommend" && <RecommendTab {...p} />}
      </div>
    </aside>
  );
}
