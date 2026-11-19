"use client";

import { useEffect, useState } from "react";
import { api } from "@/lib/api";
import { formatPrice } from "@/lib/format";

export default function Dashboard() {
  const [s, setS] = useState<any>(null);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => { api("/api/admin/stats").then(setS).catch((e) => setErr(e.message)); }, []);
  if (err) return <p className="text-red-300">{err}</p>;
  if (!s) return <p className="text-slate-400">Chargement…</p>;
  const r = s.reservations as Record<string, number>;
  const tiles = [
    ["Confirmées", r.confirmed ?? 0], ["En attente", r.pending ?? 0], ["Annulées", r.cancelled ?? 0], ["Expirées", r.expired ?? 0],
    ["Événements", s.events], ["Utilisateurs", s.users],
  ];
  return (
    <div>
      <h1 className="font-display text-3xl text-white">Tableau de bord</h1>
      <div className="mt-5 grid grid-cols-2 gap-3 md:grid-cols-3">
        {tiles.map(([k, v]) => <div key={k as string} className="card p-4"><div className="text-xs uppercase tracking-wider text-slate-400">{k}</div><div className="mt-1 text-3xl font-semibold text-white">{v}</div></div>)}
      </div>
      <div className="card mt-4 p-4"><div className="text-xs uppercase tracking-wider text-slate-400">Volume de démonstration</div><div className="mt-1 text-2xl text-white">{formatPrice(s.demo_total_minor)}</div><p className="text-xs text-amber-200/80">{s.notice}</p></div>
      <h2 className="mt-8 text-lg font-semibold text-white">Places vendues par événement</h2>
      <ul className="mt-3 space-y-2">
        {s.seats_sold_per_event.length === 0 && <li className="text-slate-400">Aucune vente.</li>}
        {s.seats_sold_per_event.map((e: any) => <li key={e.event_id} className="card flex justify-between p-3 text-sm"><span>{e.title}</span><b>{e.seats}</b></li>)}
      </ul>
    </div>
  );
}
