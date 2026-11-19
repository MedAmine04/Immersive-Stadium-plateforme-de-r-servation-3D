"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { useAuth } from "@/components/Providers";
import { api } from "@/lib/api";
import { formatDate, formatPrice, STATUS_LABEL } from "@/lib/format";
import type { Reservation } from "@/lib/types";

const tone: Record<string, string> = {
  confirmed: "border-emerald-400/40 text-emerald-300", pending: "border-sky-400/40 text-sky-300",
  cancelled: "border-slate-500/40 text-slate-400", expired: "border-slate-500/40 text-slate-400",
};

export default function Reservations() {
  const { user, ready } = useAuth();
  const router = useRouter();
  const [list, setList] = useState<Reservation[] | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const load = useCallback(() => api<Reservation[]>("/api/reservations").then(setList).catch((e) => setErr(e.message)), []);
  useEffect(() => { if (ready && !user) router.push("/login?next=/reservations"); else if (user) void load(); }, [ready, user, router, load]);

  async function act(r: Reservation, action: "confirm" | "cancel") {
    setErr(null);
    try { await api(`/api/reservations/${r.id}/${action}`, { method: "POST" }); } catch (e: any) { setErr(e.message); }
    await load();
  }
  return (
    <div className="mx-auto max-w-4xl px-4 py-10">
      <h1 className="font-display text-3xl text-white">Mes réservations</h1>
      <p className="mt-1 text-sm text-amber-200/90">Confirmations de démonstration : aucun paiement, aucun accès au stade.</p>
      {err && <div role="alert" className="mt-4 rounded-lg border border-red-400/30 bg-red-500/10 p-3 text-sm text-red-200">{err}</div>}
      {list && list.length === 0 && <p className="mt-8 text-slate-400">Aucune réservation. <Link href="/" className="text-gold-400 underline">Explorer le stade</Link></p>}
      <ul className="mt-6 space-y-4">
        {list?.map((r) => (
          <li key={r.id} className="card p-5">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <div className="font-display text-xl text-white">{r.reference}</div>
                <div className="text-sm text-slate-400">{r.event.title} · {formatDate(r.event.starts_at)}</div>
              </div>
              <span className={`chip ${tone[r.status]}`}>{STATUS_LABEL[r.status]}</span>
            </div>
            <ul className="mt-3 grid gap-1 text-sm text-slate-200 sm:grid-cols-2">
              {r.items.map((i) => <li key={i.seat_id} className="flex justify-between rounded bg-white/5 px-3 py-1.5"><span>{i.seat_code}</span><span className="tabular-nums">{formatPrice(i.price_minor)}</span></li>)}
            </ul>
            <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
              <span className="text-sm text-slate-300">Total fictif : <b className="text-white">{formatPrice(r.total_minor)}</b></span>
              <div className="flex gap-2">
                {r.status === "pending" && <><Link href={`/events/${r.event.id}`} className="btn btn-ghost">Reprendre</Link><button className="btn btn-gold" onClick={() => act(r, "confirm")}>Confirmer</button></>}
                {(r.status === "pending" || r.status === "confirmed") && <button className="btn btn-ghost" onClick={() => act(r, "cancel")}>Annuler</button>}
              </div>
            </div>
            {r.demo_notice && r.status === "confirmed" && <p className="mt-3 rounded-md bg-amber-400/10 p-2 text-xs text-amber-200">{r.demo_notice}</p>}
          </li>
        ))}
      </ul>
    </div>
  );
}
