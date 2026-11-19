"use client";

import dynamic from "next/dynamic";
import { useParams, useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { api, ApiError, newIdempotencyKey } from "@/lib/api";
import { seatLabel, seatRefAt, viewQuality } from "@/lib/seats";
import type { Availability, EventInfo, Reservation, SeatRef, SectionSeats, Venue } from "@/lib/types";
import { useAuth } from "../Providers";
import MiniMap from "./MiniMap";
import { HoverTooltip, Legend, SeatCard } from "./Overlays";
import type { Focus, QualityMode, SceneApi } from "./Scene";
import SidePanel, { Tab } from "./SidePanel";

const Scene = dynamic(() => import("./Scene"), {
  ssr: false,
  loading: () => <div className="grid h-full place-items-center text-slate-400">Chargement du moteur 3D…</div>,
});

const MAX_SEATS = 8;

export default function Experience() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const { user } = useAuth();

  const [venue, setVenue] = useState<Venue | null>(null);
  const [event, setEvent] = useState<EventInfo | null>(null);
  const [availability, setAvailability] = useState<Availability | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [seatData, setSeatData] = useState<Record<string, SectionSeats>>({});
  const inflight = useRef<Record<string, Promise<SectionSeats>>>({});

  const [focus, setFocus] = useState<Focus>({ kind: "overview" });
  const [focusKey, setFocusKey] = useState(0);
  const [activeSection, setActiveSection] = useState<string | null>(null);
  const [hoverSection, setHoverSection] = useState<string | null>(null);
  const [focusedSeat, setFocusedSeat] = useState<SeatRef | null>(null);

  const [selected, setSelected] = useState<SeatRef[]>([]);
  const [compare, setCompare] = useState<SeatRef[]>([]);
  const [thumbs, setThumbs] = useState<Record<number, string>>({});
  const [tab, setTab] = useState<Tab>("selection");

  const [reservation, setReservation] = useState<Reservation | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);

  const [roofVisible, setRoofVisible] = useState(true);
  const [quality, setQuality] = useState<QualityMode>("auto");
  const [showMap, setShowMap] = useState(true);
  const [fps, setFps] = useState<{ fps: number; dpr: number } | null>(null);
  const apiRef = useRef<SceneApi | null>(null);
  const idem = useRef<{ ids: string; key: string } | null>(null);

  /* ------------------------------ chargement ------------------------------ */
  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const ev = await api<EventInfo>(`/api/events/${id}`);
        const [v, av] = await Promise.all([api<Venue>(`/api/venues/${ev.venue_slug}`), api<Availability>(`/api/events/${id}/availability`)]);
        if (!alive) return;
        setEvent(ev); setVenue(v); setAvailability(av);
      } catch (e: any) {
        if (alive) setLoadError(e instanceof ApiError && e.status === 404 ? "Événement introuvable." : "Impossible de charger l'événement.");
      }
    })();
    return () => { alive = false; };
  }, [id]);

  const refreshAvailability = useCallback(async () => {
    try { setAvailability(await api<Availability>(`/api/events/${id}/availability`)); } catch { /* réseau instable : on réessaiera */ }
  }, [id]);

  useEffect(() => {
    const t = setInterval(() => { if (document.visibilityState === "visible") void refreshAvailability(); }, 8000);
    return () => clearInterval(t);
  }, [refreshAvailability]);

  // reprise d'une réservation en attente après rechargement de la page
  useEffect(() => {
    if (!user || !event) return;
    api<Reservation[]>("/api/reservations").then((list) => {
      const pend = list.find((r) => r.event.id === event.id && r.status === "pending");
      if (pend) setReservation(pend);
    }).catch(() => {});
  }, [user, event]);

  useEffect(() => { if (!toast) return; const t = setTimeout(() => setToast(null), 4500); return () => clearTimeout(t); }, [toast]);

  const categoryColors = useMemo(() => Object.fromEntries((venue?.categories ?? []).map((c) => [c.code, c.color])), [venue]);

  const ensureSection = useCallback((code: string): Promise<SectionSeats> => {
    if (!venue) return Promise.reject(new Error("no venue"));
    const cached = seatData[code];
    if (cached) return Promise.resolve(cached);
    if (!inflight.current[code]) {
      inflight.current[code] = api<SectionSeats>(`/api/venues/${venue.slug}/sections/${code}/seats`).then((d) => {
        setSeatData((s) => ({ ...s, [code]: d }));
        return d;
      }).finally(() => { delete inflight.current[code]; });
    }
    return inflight.current[code];
  }, [venue, seatData]);

  /* ------------------------------ états dérivés ------------------------------ */
  const sets = useMemo(() => ({
    taken: new Set(availability?.taken ?? []),
    blocked: new Set(availability?.blocked_seats ?? []),
    mine: new Set(availability?.held_by_me ?? []),
    closed: new Set(availability?.closed_sections ?? []),
  }), [availability]);
  const selectedIds = useMemo(() => new Set(selected.map((s) => s.id)), [selected]);
  const compareIds = useMemo(() => new Set(compare.map((s) => s.id)), [compare]);

  const statusOf = useCallback((s: SeatRef) => {
    if (selectedIds.has(s.id)) return "Dans votre sélection";
    if (sets.mine.has(s.id)) return "Verrouillé pour vous";
    if (sets.closed.has(s.section) || sets.blocked.has(s.id)) return "Non disponible";
    if (sets.taken.has(s.id)) return "Déjà pris";
    return "Disponible";
  }, [selectedIds, sets]);

  // retire de la sélection un siège pris entre-temps par quelqu'un d'autre
  useEffect(() => {
    if (!availability) return;
    const gone = selected.filter((s) => sets.taken.has(s.id) || sets.blocked.has(s.id) || sets.closed.has(s.section));
    if (gone.length) {
      setSelected((cur) => cur.filter((s) => !gone.some((g) => g.id === s.id)));
      setToast(`${gone.length} siège(s) de votre sélection ne sont plus disponibles.`);
    }
  }, [availability]); // eslint-disable-line react-hooks/exhaustive-deps

  /* ------------------------------ navigation ------------------------------ */
  const go = (f: Focus) => { setFocus(f); setFocusKey((k) => k + 1); };

  const openSection = useCallback(async (code: string) => {
    if (!venue) return;
    if (availability?.closed_sections.includes(code)) { setToast("Ce secteur n'est pas ouvert à la vente pour cet événement."); return; }
    setHoverSection(null); setFocusedSeat(null); setActiveSection(code);
    go({ kind: "section", code });
    try { await ensureSection(code); } catch { setToast("Impossible de charger les sièges de ce secteur."); }
  }, [venue, availability, ensureSection]);

  const back = () => {
    setFocusedSeat(null);
    if (focus.kind === "seat") go({ kind: "section", code: focus.seat.section });
    else { setActiveSection(null); go({ kind: "overview" }); }
  };

  const viewFromSeat = useCallback(async (s: SeatRef) => {
    try {
      await ensureSection(s.section);
      setActiveSection(s.section); setFocusedSeat(null);
      go({ kind: "seat", seat: s });
    } catch { setToast("Impossible de charger la vue."); }
  }, [ensureSection]);

  const neighbor = (s: SeatRef, dRow: number, dNum: number) => {
    const d = seatData[s.section];
    if (!d) return;
    let best = -1, bestDist = Infinity;
    for (let i = 0; i < d.count; i++) {
      if (d.rows[i] !== s.row + dRow) continue;
      if (dRow === 0 && d.numbers[i] !== s.number + dNum) continue;
      const dist = Math.hypot(d.x[i] - s.x, d.z[i] - s.z);
      if (dist < bestDist) { bestDist = dist; best = i; }
    }
    if (best >= 0) go({ kind: "seat", seat: seatRefAt(d, best, availability, availability?.section_categories[s.section] ?? s.category) });
  };

  /* ------------------------------ sélection / comparaison ------------------------------ */
  const toggleSeat = (s: SeatRef) => {
    setError(null);
    if (selectedIds.has(s.id)) { setSelected((c) => c.filter((x) => x.id !== s.id)); return; }
    if (statusOf(s) !== "Disponible") return;
    if (selected.length >= MAX_SEATS) { setToast(`Maximum ${MAX_SEATS} places par réservation.`); return; }
    setSelected((c) => [...c, s]);
    setTab("selection");
  };

  const toggleCompare = (s: SeatRef) => {
    if (compareIds.has(s.id)) { setCompare((c) => c.filter((x) => x.id !== s.id)); return; }
    if (compare.length >= 3) { setToast("Comparaison limitée à 3 places."); return; }
    setCompare((c) => [...c, s]);
    setTab("compare");
    setTimeout(() => {
      const url = apiRef.current?.captureThumb(s);
      if (url) setThumbs((t) => ({ ...t, [s.id]: url }));
    }, 60);
  };

  /* ------------------------------ réservation ------------------------------ */
  const reserve = async () => {
    if (!user) { router.push(`/login?next=${encodeURIComponent(`/events/${id}`)}`); return; }
    setBusy(true); setError(null);
    const ids = selected.map((s) => s.id).sort((a, b) => a - b);
    const sig = ids.join(",");
    if (!idem.current || idem.current.ids !== sig) idem.current = { ids: sig, key: newIdempotencyKey() };
    try {
      const r = await api<Reservation>(`/api/events/${id}/locks`, { body: { seat_ids: ids }, headers: { "Idempotency-Key": idem.current.key } });
      setReservation(r); setSelected([]); idem.current = null;
      await refreshAvailability();
    } catch (e: any) {
      if (e instanceof ApiError && e.code === "seat_taken") {
        const bad: number[] = e.data?.seat_ids ?? [];
        setSelected((c) => c.filter((s) => !bad.includes(s.id)));
        setError("Un ou plusieurs sièges viennent d'être pris par un autre spectateur. Ils ont été retirés de votre sélection.");
        idem.current = null;
      } else if (e instanceof ApiError && e.status === 401) router.push(`/login?next=${encodeURIComponent(`/events/${id}`)}`);
      else setError(e.message || "Réservation impossible.");
      await refreshAvailability();
    } finally { setBusy(false); }
  };

  const confirmRes = async () => {
    if (!reservation) return;
    setBusy(true); setError(null);
    try { setReservation(await api<Reservation>(`/api/reservations/${reservation.id}/confirm`, { method: "POST" })); }
    catch (e: any) {
      setError(e.message);
      if (e instanceof ApiError && (e.status === 410 || e.status === 409)) setReservation(null);
    } finally { setBusy(false); await refreshAvailability(); }
  };

  const cancelRes = async () => {
    if (!reservation) return;
    setBusy(true);
    try { await api(`/api/reservations/${reservation.id}/cancel`, { method: "POST" }); setReservation(null); }
    catch (e: any) { setError(e.message); } finally { setBusy(false); await refreshAvailability(); }
  };

  const expired = () => { setReservation(null); setError("Votre verrouillage a expiré : les places ont été libérées. Sélectionnez-les de nouveau."); void refreshAvailability(); };

  /* ------------------------------ recommandations ------------------------------ */
  const seatsFromIds = async (ids: number[], section: string) => {
    const d = await ensureSection(section);
    const cat = availability?.section_categories[section] ?? "";
    return ids.map((sid) => d.ids.indexOf(sid)).filter((i) => i >= 0).map((i) => seatRefAt(d, i, availability, cat));
  };
  const recView = async (ids: number[], section: string) => { const s = await seatsFromIds(ids, section); if (s[0]) await viewFromSeat(s[0]); };
  const recAdd = async (ids: number[], section: string) => {
    const s = await seatsFromIds(ids, section);
    setSelected((cur) => [...cur, ...s.filter((x) => !cur.some((c) => c.id === x.id))].slice(0, MAX_SEATS));
    setTab("selection");
  };

  /* ------------------------------ rendu ------------------------------ */
  if (loadError) return <div className="mx-auto max-w-xl p-10 text-center text-slate-300">{loadError}</div>;
  if (!venue || !event) return <div className="grid h-[60dvh] place-items-center text-slate-400">Chargement de l’expérience…</div>;

  const inSeat = focus.kind === "seat";
  const markerPoints = selected.map((s) => ({ x: s.x, z: s.z }));
  const sectionInfo = activeSection ? venue.sections.find((s) => s.code === activeSection) : null;

  return (
    <div className="grid h-[calc(100dvh-84px)] min-h-[560px] grid-rows-[minmax(380px,62dvh)_1fr] lg:grid-cols-[1fr_400px] lg:grid-rows-1">
      <div className="relative min-h-0 overflow-hidden bg-ink-950">
        <Scene
          venue={venue} availability={availability} categoryColors={categoryColors}
          focus={focus} focusKey={focusKey} activeSection={activeSection} seatData={seatData}
          selectedIds={selectedIds} compareIds={compareIds} roofVisible={roofVisible} quality={quality}
          hoverSectionCode={hoverSection}
          onSectionClick={(c) => void openSection(c)} onSectionHover={setHoverSection}
          onSeatClick={(s) => { setFocusedSeat(s); }}
          apiRef={apiRef} onFps={(f, d) => setFps({ fps: f, dpr: d })}
        />

        {/* haut-gauche : navigation */}
        <div className="pointer-events-none absolute left-3 top-3 flex max-w-[70%] flex-wrap items-center gap-2">
          {focus.kind !== "overview" && <button className="btn btn-ghost pointer-events-auto bg-ink-900/85 backdrop-blur" onClick={back}>← {inSeat ? "Retour au secteur" : "Vue d’ensemble"}</button>}
          {inSeat && <button className="btn btn-ghost pointer-events-auto bg-ink-900/85 backdrop-blur" onClick={() => { setActiveSection(null); setFocusedSeat(null); go({ kind: "overview" }); }}>Vue d’ensemble</button>}
          <span className="pointer-events-auto rounded-lg border border-white/10 bg-ink-900/85 px-3 py-1.5 text-xs text-slate-200 backdrop-blur">
            {inSeat ? seatLabel(focus.seat) : sectionInfo ? sectionInfo.name : venue.name}
          </span>
        </div>

        {/* haut-droite : options */}
        <div className="absolute right-3 top-3 flex flex-wrap items-center justify-end gap-2">
          <button className="btn btn-ghost bg-ink-900/85 backdrop-blur" aria-pressed={roofVisible} onClick={() => setRoofVisible((v) => !v)}>Toit : {roofVisible ? "visible" : "masqué"}</button>
          <button className="btn btn-ghost bg-ink-900/85 backdrop-blur" onClick={() => setQuality((q) => (q === "auto" ? "high" : q === "high" ? "low" : "auto"))} title="Qualité graphique">
            Qualité : {quality === "auto" ? "auto" : quality === "high" ? "haute" : "économe"}
          </button>
          <button className="btn btn-ghost bg-ink-900/85 backdrop-blur lg:hidden" onClick={() => setShowMap((v) => !v)}>Plan</button>
        </div>

        {/* avertissement de fidélité : toujours visible */}
        <div className="pointer-events-none absolute left-1/2 top-14 hidden -translate-x-1/2 xl:block">
          {venue.data_fidelity === "estimated" && (
            <span className="rounded-full border border-amber-400/40 bg-amber-400/15 px-3 py-1 text-[11px] font-medium text-amber-200 backdrop-blur" title={venue.fidelity_notes}>
              Modèle estimé · vues indicatives, non issues des plans officiels
            </span>
          )}
        </div>

        {/* bas-gauche : légende */}
        {!inSeat && <div className="absolute bottom-3 left-3 hidden w-64 md:block"><Legend categories={venue.categories} prices={availability?.prices} onlyUsed /></div>}

        {/* bas-droit : plan 2D synchronisé */}
        {showMap && !inSeat && (
          <div className="absolute bottom-3 right-3 h-52 w-40 rounded-xl border border-white/10 bg-ink-900/85 p-1.5 backdrop-blur sm:h-64 sm:w-48">
            <MiniMap
              venue={venue} availability={availability} categoryColors={categoryColors} activeSection={activeSection} hoverSection={hoverSection}
              selectedPoints={markerPoints} viewPoint={null} onSectionClick={(c) => void openSection(c)} onSectionHover={setHoverSection}
            />
          </div>
        )}

        {/* carte de siège */}
        {focusedSeat && !inSeat && (
          <div className="absolute bottom-3 left-1/2 -translate-x-1/2">
            <SeatCard
              seat={focusedSeat} status={statusOf(focusedSeat)} categories={venue.categories}
              selected={selectedIds.has(focusedSeat.id)} comparing={compareIds.has(focusedSeat.id)} canCompare={compare.length < 3}
              onView={() => void viewFromSeat(focusedSeat)} onToggle={() => toggleSeat(focusedSeat)}
              onCompare={() => toggleCompare(focusedSeat)} onClose={() => setFocusedSeat(null)}
            />
          </div>
        )}

        {/* HUD vue depuis le siège */}
        {inSeat && (
          <>
            <div className="pointer-events-none absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/70 to-transparent p-4 pt-16">
              <div className="pointer-events-auto mx-auto flex max-w-3xl flex-wrap items-center justify-between gap-3">
                <div>
                  <div className="text-xs uppercase tracking-wider text-gold-300">Vue depuis le siège · indicative</div>
                  <div className="text-lg font-semibold text-white">{seatLabel(focus.seat)}</div>
                  <div className="text-xs text-slate-300">
                    {focus.seat.distEdge.toFixed(0)} m du terrain · angle {focus.seat.elevation.toFixed(0)}° · vue {viewQuality(focus.seat.viewScore).toLowerCase()} · hauteur des yeux {venue.bowl.eye_height} m
                  </div>
                </div>
                <div className="flex flex-wrap gap-2">
                  <button className="btn btn-ghost bg-ink-900/70" onClick={() => neighbor(focus.seat, 0, -1)} aria-label="Siège précédent">◀ Siège</button>
                  <button className="btn btn-ghost bg-ink-900/70" onClick={() => neighbor(focus.seat, 0, 1)} aria-label="Siège suivant">Siège ▶</button>
                  <button className="btn btn-ghost bg-ink-900/70" onClick={() => neighbor(focus.seat, -1, 0)}>▲ Rang devant</button>
                  <button className="btn btn-ghost bg-ink-900/70" onClick={() => neighbor(focus.seat, 1, 0)}>▼ Rang derrière</button>
                  <button className={`btn ${selectedIds.has(focus.seat.id) ? "btn-danger" : "btn-gold"}`} disabled={statusOf(focus.seat) !== "Disponible" && !selectedIds.has(focus.seat.id)} onClick={() => toggleSeat(focus.seat)}>
                    {selectedIds.has(focus.seat.id) ? "Retirer" : statusOf(focus.seat) === "Disponible" ? "Ajouter" : statusOf(focus.seat)}
                  </button>
                  <button className="btn btn-ghost bg-ink-900/70" onClick={() => toggleCompare(focus.seat)}>{compareIds.has(focus.seat.id) ? "✓ Comparé" : "Comparer"}</button>
                </div>
              </div>
              <p className="pointer-events-none mt-2 text-center text-[11px] text-slate-400">Glissez pour regarder autour · molette ou +/− pour zoomer · flèches du clavier pour pivoter</p>
            </div>
            <div className="pointer-events-none absolute left-1/2 top-3 -translate-x-1/2 rounded-full border border-amber-400/40 bg-amber-400/15 px-3 py-1 text-[11px] text-amber-200 xl:hidden">Vue indicative</div>
          </>
        )}

        {toast && <div role="status" className="absolute left-1/2 top-16 -translate-x-1/2 rounded-lg border border-white/15 bg-ink-900/95 px-4 py-2 text-sm text-white shadow-xl">{toast}</div>}
        {fps && quality !== "low" && <div className="pointer-events-none absolute bottom-1 left-1 text-[10px] text-slate-600">{fps.fps} fps · ×{fps.dpr.toFixed(1)}</div>}
        <HoverTooltip categories={venue.categories} />
      </div>

      <SidePanel
        event={event} availability={availability} categories={venue.categories} user={user}
        selected={selected} maxSeats={MAX_SEATS} compare={compare} thumbs={thumbs}
        reservation={reservation} busy={busy} error={error} tab={tab} setTab={setTab}
        onRemove={(sid) => setSelected((c) => c.filter((s) => s.id !== sid))} onClear={() => setSelected([])}
        onViewSeat={(s) => void viewFromSeat(s)} onRemoveCompare={(sid) => setCompare((c) => c.filter((s) => s.id !== sid))}
        onReserve={() => void reserve()} onConfirm={() => void confirmRes()} onCancel={() => void cancelRes()} onExpired={expired}
        onRecView={(ids, sec) => void recView(ids, sec)} onRecAdd={(ids, sec) => void recAdd(ids, sec)}
      />
    </div>
  );
}
