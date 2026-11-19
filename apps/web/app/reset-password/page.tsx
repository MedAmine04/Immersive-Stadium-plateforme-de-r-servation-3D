"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useState } from "react";
import { api } from "@/lib/api";

function Inner() {
  const token = useSearchParams().get("token") ?? "";
  const router = useRouter();
  const [pw, setPw] = useState("");
  const [err, setErr] = useState<string | null>(null);
  return (
    <div className="mx-auto max-w-md px-4 py-14">
      <div className="card p-6">
        <h1 className="font-display text-2xl text-white">Nouveau mot de passe</h1>
        <form className="mt-5 space-y-4" onSubmit={async (e) => { e.preventDefault(); setErr(null); try { await api("/api/auth/reset-password", { body: { token, password: pw } }); router.push("/login"); } catch (x: any) { setErr(x.message); } }}>
          <div><label className="label" htmlFor="p">Mot de passe</label><input id="p" className="field" type="password" required autoComplete="new-password" value={pw} onChange={(e) => setPw(e.target.value)} /></div>
          {err && <div role="alert" className="text-sm text-red-300">{err}</div>}
          <button className="btn btn-gold w-full" disabled={!token}>Enregistrer</button>
        </form>
      </div>
    </div>
  );
}
export default function Page() { return <Suspense><Inner /></Suspense>; }
