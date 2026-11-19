"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { api } from "@/lib/api";
import { formatDate, formatPrice } from "@/lib/format";
import type { EventInfo, Venue } from "@/lib/types";

const SLUG = "prince-moulay-abdellah";

function Hero() {
  return (
    <svg viewBox="0 0 400 300" className="h-full w-full" aria-hidden>
      <defs>
        <radialGradient id="g" cx="50%" cy="50%" r="60%"><stop offset="0" stopColor="#1f6b34" /><stop offset="1" stopColor="#0f3a1c" /></radialGradient>
      </defs>
      {[0, 1, 2, 3, 4].map((i) => (
        <rect key={i} x={30 + i * 12} y={20 + i * 9} width={340 - i * 24} height={260 - i * 18} rx={90 - i * 12}
          fill="none" stroke={["#e9b44c", "#d9a441", "#4f9d83", "#7aa2c8", "#7aa2c8"][i]} strokeWidth={7} opacity={0.9 - i * 0.12} />
      ))}
      <rect x="95" y="80" width="210" height="140" rx="28" fill="url(#g)" />
      <line x1="95" y1="150" x2="305" y2="150" stroke="#d9f2de" strokeWidth="1.5" />
      <circle cx="200" cy="150" r="22" fill="none" stroke="#d9f2de" strokeWidth="1.5" />
    </svg>
  );
}

export default function Home() {
  const [venue, setVenue] = useState<Venue | null>(null);
  const [events, setEvents] = useState<EventInfo[]>([]);
  const [err, setErr] = useState(false);
  useEffect(() => {
    Promise.all([api<Venue>(`/api/venues/${SLUG}`), api<EventInfo[]>("/api/events")])
      .then(([v, e]) => { setVenue(v); setEvents(e); })
      .catch(() => setErr(true));
  }, []);

  return (
    <div className="mx-auto max-w-6xl px-4 pb-20">
      <section className="grid items-center gap-8 py-10 md:grid-cols-[1.1fr_0.9fr] md:py-16">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.2em] text-gold-400">Billetterie immersive</p>
          <h1 className="mt-3 font-display text-4xl leading-tight text-white md:text-6xl">Voyez votre place<br />avant de l’acheter.</h1>
          <p className="mt-4 max-w-xl text-lg text-slate-300">Explorez le stade en 3D, choisissez un siège précis et découvrez la vue depuis cet emplacement. Comparez, réservez, sans mauvaise surprise.</p>
          <div className="mt-6 flex flex-wrap gap-3">
            {events[0] && <Link href={`/events/${events[0].id}`} className="btn btn-gold px-5 py-3 text-base">Explorer le stade en 3D</Link>}
            <a href="#evenements" className="btn btn-ghost px-5 py-3 text-base">Voir les événements</a>
          </div>
        </div>
        <div className="aspect-[4/3] rounded-3xl border border-white/10 bg-ink-800/60 p-4"><Hero /></div>
      </section>

      {err && <p className="rounded-lg border border-red-400/30 bg-red-500/10 p-4 text-red-200">Le service est momentanément indisponible. Réessayez dans un instant.</p>}

      {venue && (
        <section className="grid gap-4 md:grid-cols-3">
          <div className="card p-5 md:col-span-2">
            <h2 className="font-display text-2xl text-white">{venue.name}</h2>
            <p className="text-sm text-slate-400">{venue.city}, {venue.country}</p>
            <p className="mt-3 text-slate-300">{venue.description}</p>
            <dl className="mt-4 grid grid-cols-2 gap-3 text-sm sm:grid-cols-4">
              {[["Capacité", venue.capacity.toLocaleString("fr-FR")], ["Tribunes", String(venue.stands.length)], ["Secteurs", String(venue.sections.length)], ["Terrain", `${venue.pitch.length} × ${venue.pitch.width} m`]].map(([k, v]) => (
                <div key={k} className="rounded-xl bg-white/5 p-3"><dt className="text-xs uppercase tracking-wider text-slate-400">{k}</dt><dd className="mt-1 text-lg font-semibold text-white">{v}</dd></div>
              ))}
            </dl>
          </div>
          <div className="card border-amber-400/30 bg-amber-400/5 p-5 text-sm text-amber-100/90">
            <h3 className="mb-1 font-semibold text-amber-200">Fidélité du modèle</h3>
            {venue.data_fidelity === "estimated" ? venue.fidelity_notes : "Modèle vérifié à partir des plans et de l'inventaire officiels."}
          </div>
        </section>
      )}

      <section id="evenements" className="mt-12">
        <h2 className="font-display text-3xl text-white">Événements</h2>
        <div className="mt-5 grid gap-4 md:grid-cols-2">
          {events.map((e) => {
            const min = Math.min(...e.prices.filter((p) => p.on_sale).map((p) => p.price_minor));
            return (
              <Link key={e.id} href={`/events/${e.id}`} className="card group block p-5 transition hover:border-gold-400/50">
                <div className="flex items-center justify-between"><span className="chip capitalize">{e.kind}</span>{e.demo_mode && <span className="chip border-amber-400/40 text-amber-200">Démo</span>}</div>
                <h3 className="mt-3 text-xl font-semibold text-white group-hover:text-gold-300">{e.title}</h3>
                <p className="mt-1 text-sm capitalize text-slate-400">{formatDate(e.starts_at)}</p>
                <p className="mt-2 text-sm text-slate-300">{e.description}</p>
                <div className="mt-4 flex items-center justify-between text-sm">
                  <span className="text-slate-400">À partir de <b className="text-white">{Number.isFinite(min) ? formatPrice(min) : "—"}</b></span>
                  <span className="text-gold-400">Choisir mes places →</span>
                </div>
              </Link>
            );
          })}
          {!err && events.length === 0 && <p className="text-slate-400">Aucun événement ouvert à la réservation pour le moment.</p>}
        </div>
      </section>
    </div>
  );
}
