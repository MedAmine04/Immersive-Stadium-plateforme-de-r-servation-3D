"use client";

import { useCallback, useEffect, useState } from "react";
import { api } from "@/lib/api";
import { formatDate, formatPrice, STATUS_LABEL } from "@/lib/format";
import type { EventInfo, Reservation, Venue } from "@/lib/types";

const SLUG = "prince-moulay-abdellah";
const toLocalInput = (iso: string) => { const d = new Date(iso); d.setMinutes(d.getMinutes() - d.getTimezoneOffset()); return d.toISOString().slice(0, 16); };

function EventForm({ venue, initial, onSaved, onCancel }: { venue: Venue; initial?: EventInfo; onSaved: () => void; onCancel: () => void }) {
  const [title, setTitle] = useState(initial?.title ?? "");
  const [kind, setKind] = useState(initial?.kind ?? "football");
  const [desc, setDesc] = useState(initial?.description ?? "");
  const [starts, setStarts] = useState(initial ? toLocalInput(initial.starts_at) : "");
  const [status, setStatus] = useState(initial?.status ?? "draft");
  const [prices, setPrices] = useState<Record<string, string>>(() =>
    Object.fromEntries(venue.categories.map((c) => [c.code, String(((initial?.prices.find((p) => p.category === c.code)?.price_minor ?? c.default_price_minor)) / 100)])));
  const [closed, setClosed] = useState<string[]>([]);
  const [err, setErr] = useState<string | null>(null);
  const stands = Array.from(new Set(venue.sections.map((s) => s.stand)));

  async function save(e: React.FormEvent) {
    e.preventDefault(); setErr(null);
    const body: any = {
      title, kind, description: desc, starts_at: new Date(starts).toISOString(), status,
      prices: venue.categories.map((c) => ({ category_code: c.code, price_minor: Math.round(Number(prices[c.code] || 0) * 100), on_sale: true })),
    };
    if (!initial || closed.length) body.closed_sections = closed;
    try {
      if (initial) await api(`/api/admin/events/${initial.id}`, { method: "PATCH", body });
      else await api("/api/admin/events", { body: { ...body, venue_slug: venue.slug } });
      onSaved();
    } catch (x: any) { setErr(x.message); }
  }
  return (
    <form onSubmit={save} className="card space-y-4 p-5">
      <h2 className="text-lg font-semibold text-white">{initial ? "Modifier l’événement" : "Nouvel événement"}</h2>
      <div className="grid gap-3 md:grid-cols-2">
        <div className="md:col-span-2"><label className="label">Titre</label><input className="field" required minLength={3} value={title} onChange={(e) => setTitle(e.target.value)} /></div>
        <div><label className="label">Type</label><select className="field" value={kind} onChange={(e) => setKind(e.target.value)}><option value="football">Football</option><option value="concert">Concert</option><option value="autre">Autre</option></select></div>
        <div><label className="label">Date et heure</label><input className="field" type="datetime-local" required value={starts} onChange={(e) => setStarts(e.target.value)} /></div>
        <div><label className="label">Statut</label><select className="field" value={status} onChange={(e) => setStatus(e.target.value)}><option value="draft">Brouillon</option><option value="published">Publié</option><option value="cancelled">Annulé</option></select></div>
        <div className="md:col-span-2"><label className="label">Description</label><textarea className="field" rows={2} value={desc} onChange={(e) => setDesc(e.target.value)} /></div>
      </div>
      <div>
        <label className="label">Tarifs par catégorie (MAD)</label>
        <div className="grid gap-2 sm:grid-cols-2">
          {venue.categories.map((c) => (
            <div key={c.code} className="flex items-center gap-2"><span className="h-3 w-3 rounded-sm" style={{ background: c.color }} /><span className="flex-1 text-sm text-slate-200">{c.name}</span>
              <input className="field w-28" type="number" min={0} value={prices[c.code]} onChange={(e) => setPrices({ ...prices, [c.code]: e.target.value })} /></div>
          ))}
        </div>
      </div>
      <div>
        <label className="label">Configuration : tribunes fermées à la vente{initial ? " (laisser vide = inchangé)" : ""}</label>
        <div className="flex flex-wrap gap-2">
          {stands.map((st) => {
            const codes = venue.sections.filter((s) => s.stand === st).map((s) => s.code);
            const all = codes.every((c) => closed.includes(c));
            return <button type="button" key={st} className={`chip ${all ? "border-red-400/60 bg-red-500/20 text-red-200" : ""}`} onClick={() => setClosed(all ? closed.filter((c) => !codes.includes(c)) : Array.from(new Set([...closed, ...codes])))}>{venue.stands.find((s) => s.code === st)?.name} {all ? "· fermée" : ""}</button>;
          })}
        </div>
      </div>
      {err && <div role="alert" className="text-sm text-red-300">{err}</div>}
      <div className="flex gap-2"><button className="btn btn-gold">Enregistrer</button><button type="button" className="btn btn-ghost" onClick={onCancel}>Annuler</button></div>
    </form>
  );
}

export default function AdminEvents() {
  const [venue, setVenue] = useState<Venue | null>(null);
  const [events, setEvents] = useState<EventInfo[]>([]);
  const [editing, setEditing] = useState<EventInfo | "new" | null>(null);
  const [resv, setResv] = useState<Reservation[] | null>(null);
  const [sel, setSel] = useState<EventInfo | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const load = useCallback(async () => {
    try { const [v, e] = await Promise.all([api<Venue>(`/api/venues/${SLUG}`), api<EventInfo[]>("/api/admin/events")]); setVenue(v); setEvents(e); }
    catch (x: any) { setErr(x.message); }
  }, []);
  useEffect(() => { void load(); }, [load]);
  const loadResv = async (e: EventInfo) => { setSel(e); setResv(await api<Reservation[]>(`/api/admin/reservations?event_id=${e.id}&limit=200`)); };
  const cancel = async (r: Reservation) => { await api(`/api/admin/reservations/${r.id}/cancel`, { method: "POST" }); if (sel) await loadResv(sel); };

  if (!venue) return <p className="text-slate-400">{err ?? "Chargement…"}</p>;
  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between"><h1 className="font-display text-3xl text-white">Événements</h1>{!editing && <button className="btn btn-gold" onClick={() => setEditing("new")}>Nouvel événement</button>}</div>
      {editing && <EventForm venue={venue} initial={editing === "new" ? undefined : editing} onCancel={() => setEditing(null)} onSaved={() => { setEditing(null); void load(); }} />}
      <ul className="space-y-3">
        {events.map((e) => (
          <li key={e.id} className="card p-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div><div className="font-semibold text-white">{e.title}</div><div className="text-sm text-slate-400">{formatDate(e.starts_at)} · <span className="chip">{STATUS_LABEL[e.status]}</span></div></div>
              <div className="flex gap-2"><button className="btn btn-ghost" onClick={() => void loadResv(e)}>Réservations</button><button className="btn btn-ghost" onClick={() => setEditing(e)}>Modifier</button></div>
            </div>
          </li>
        ))}
      </ul>
      {sel && resv && (
        <div className="card overflow-x-auto p-4">
          <h2 className="mb-3 font-semibold text-white">Réservations — {sel.title}</h2>
          {resv.length === 0 ? <p className="text-sm text-slate-400">Aucune réservation.</p> : (
            <table className="w-full min-w-[640px] text-left text-sm">
              <thead className="text-xs uppercase text-slate-400"><tr><th className="py-1">Référence</th><th>Client</th><th>Sièges</th><th>Total</th><th>Statut</th><th /></tr></thead>
              <tbody>{resv.map((r) => (
                <tr key={r.id} className="border-t border-white/5"><td className="py-2 font-mono">{r.reference}</td><td>{r.user_email}</td><td>{r.items.length}</td><td>{formatPrice(r.total_minor)}</td><td>{STATUS_LABEL[r.status]}</td>
                  <td>{(r.status === "pending" || r.status === "confirmed") && <button className="text-red-300 hover:underline" onClick={() => cancel(r)}>Annuler</button>}</td></tr>
              ))}</tbody>
            </table>
          )}
        </div>
      )}
    </div>
  );
}
