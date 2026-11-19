"use client";

import { useCallback, useEffect, useState } from "react";
import { api } from "@/lib/api";
import type { Venue } from "@/lib/types";

const SLUG = "prince-moulay-abdellah";

export default function AdminVenue() {
  const [venue, setVenue] = useState<Venue | null>(null);
  const [assets, setAssets] = useState<any[]>([]);
  const [msg, setMsg] = useState<string | null>(null);
  const [kind, setKind] = useState("shell_glb");
  const [source, setSource] = useState("original");
  const [secCode, setSecCode] = useState("");
  const [secCat, setSecCat] = useState("");
  const [svcSection, setSvcSection] = useState("");
  const [svcRow, setSvcRow] = useState("");

  const load = useCallback(async () => {
    const [v, a] = await Promise.all([api<Venue>(`/api/venues/${SLUG}`), api<any[]>(`/api/admin/venues/${SLUG}/assets`)]);
    setVenue(v); setAssets(a);
    setSecCode((c) => c || v.sections[0].code); setSvcSection((c) => c || v.sections[0].code); setSecCat((c) => c || v.categories[0].code);
  }, []);
  useEffect(() => { void load().catch((e) => setMsg(e.message)); }, [load]);
  const run = async (fn: () => Promise<any>, ok: string) => { setMsg(null); try { await fn(); setMsg(ok); await load(); } catch (e: any) { setMsg(e.message); } };

  if (!venue) return <p className="text-slate-400">{msg ?? "Chargement…"}</p>;
  return (
    <div className="space-y-6">
      <h1 className="font-display text-3xl text-white">Stade & ressources</h1>
      {msg && <div role="status" className="rounded-lg border border-white/15 bg-white/5 p-3 text-sm text-slate-100">{msg}</div>}

      <section className="card p-5">
        <h2 className="font-semibold text-white">Fidélité des données</h2>
        <p className="mt-1 text-sm text-slate-300"><span className="chip mr-2">{venue.data_fidelity === "estimated" ? "Estimé" : "Vérifié"}</span>{venue.fidelity_notes}</p>
      </section>

      <section className="card p-5">
        <h2 className="font-semibold text-white">Catégorie d’un secteur</h2>
        <div className="mt-3 flex flex-wrap items-end gap-2">
          <div><label className="label">Secteur</label><select className="field" value={secCode} onChange={(e) => setSecCode(e.target.value)}>{venue.sections.map((s) => <option key={s.code} value={s.code}>{s.code} ({s.category})</option>)}</select></div>
          <div><label className="label">Catégorie</label><select className="field" value={secCat} onChange={(e) => setSecCat(e.target.value)}>{venue.categories.map((c) => <option key={c.code} value={c.code}>{c.name}</option>)}</select></div>
          <button className="btn btn-gold" onClick={() => run(() => api(`/api/admin/venues/${SLUG}/sections/${secCode}/category`, { method: "PATCH", body: { category_code: secCat } }), "Catégorie mise à jour.")}>Appliquer</button>
        </div>
      </section>

      <section className="card p-5">
        <h2 className="font-semibold text-white">Sièges hors service</h2>
        <div className="mt-3 flex flex-wrap items-end gap-2">
          <div><label className="label">Secteur</label><select className="field" value={svcSection} onChange={(e) => setSvcSection(e.target.value)}>{venue.sections.map((s) => <option key={s.code}>{s.code}</option>)}</select></div>
          <div><label className="label">Rang (facultatif)</label><input className="field w-28" type="number" min={1} value={svcRow} onChange={(e) => setSvcRow(e.target.value)} /></div>
          {[true, false].map((flag) => (
            <button key={String(flag)} className="btn btn-ghost" onClick={() => run(() => api(`/api/admin/venues/${SLUG}/seats/service`, { body: { section_code: svcSection, row: svcRow ? Number(svcRow) : null, out_of_service: flag } }), flag ? "Sièges mis hors service." : "Sièges remis en service.")}>{flag ? "Mettre hors service" : "Remettre en service"}</button>
          ))}
        </div>
      </section>

      <section className="card p-5">
        <h2 className="font-semibold text-white">Modèles 3D et ressources visuelles</h2>
        <p className="mt-1 text-xs text-slate-400">Fichiers contrôlés (signature binaire, taille). Chaque import crée une nouvelle version, activable manuellement. Indiquez la provenance (les données générées par IA doivent être identifiées).</p>
        <form className="mt-3 flex flex-wrap items-end gap-2" onSubmit={(e) => {
          e.preventDefault();
          const f = (e.currentTarget.elements.namedItem("file") as HTMLInputElement).files?.[0];
          if (!f) return;
          const fd = new FormData(); fd.append("file", f); fd.append("kind", kind); fd.append("source", source);
          void run(() => api(`/api/admin/venues/${SLUG}/assets`, { form: fd }), "Ressource importée (inactive).");
        }}>
          <div><label className="label">Type</label><select className="field" value={kind} onChange={(e) => setKind(e.target.value)}><option value="shell_glb">Modèle GLB</option><option value="panorama">Panorama</option><option value="image">Image</option></select></div>
          <div><label className="label">Provenance</label><select className="field" value={source} onChange={(e) => setSource(e.target.value)}><option value="official">Officielle</option><option value="captured">Capturée sur site</option><option value="original">Création originale</option><option value="ai_generated">Générée par IA</option></select></div>
          <div><label className="label">Fichier</label><input name="file" type="file" required className="field" accept=".glb,.jpg,.jpeg,.png,.webp" /></div>
          <button className="btn btn-gold">Importer</button>
        </form>
        <ul className="mt-4 space-y-2">
          {assets.map((a) => (
            <li key={a.id} className="flex flex-wrap items-center justify-between gap-2 rounded-lg bg-white/5 p-3 text-sm">
              <span>{a.name} <span className="chip ml-2">{a.kind} v{a.version}</span> <span className="chip">{a.source}</span> <span className="text-xs text-slate-400">{(a.size / 1024).toFixed(0)} Ko · {a.sha256.slice(0, 10)}…</span></span>
              <button className="btn btn-ghost" onClick={() => run(() => api(`/api/admin/venues/${SLUG}/assets/${a.id}`, { method: "PATCH", body: { is_active: !a.is_active } }), "Ressource mise à jour.")}>{a.is_active ? "Désactiver" : "Activer"}</button>
            </li>
          ))}
          {assets.length === 0 && <li className="text-sm text-slate-400">Aucune ressource importée. Le moteur utilise le modèle procédural intégré.</li>}
        </ul>
      </section>
    </div>
  );
}
