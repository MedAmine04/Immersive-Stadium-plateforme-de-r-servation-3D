"use client";

import { useState } from "react";
import { api } from "@/lib/api";

export default function Forgot() {
  const [email, setEmail] = useState("");
  const [done, setDone] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  return (
    <div className="mx-auto max-w-md px-4 py-14">
      <div className="card p-6">
        <h1 className="font-display text-2xl text-white">Mot de passe oublié</h1>
        {done ? <p className="mt-4 text-slate-300">Si un compte existe pour cette adresse, un lien de réinitialisation vient d’être envoyé.</p> : (
          <form className="mt-5 space-y-4" onSubmit={async (e) => { e.preventDefault(); setErr(null); try { await api("/api/auth/forgot-password", { body: { email } }); setDone(true); } catch (x: any) { setErr(x.message); } }}>
            <div><label className="label" htmlFor="e">E-mail</label><input id="e" className="field" type="email" required value={email} onChange={(e) => setEmail(e.target.value)} /></div>
            {err && <div role="alert" className="text-sm text-red-300">{err}</div>}
            <button className="btn btn-gold w-full">Envoyer le lien</button>
          </form>
        )}
      </div>
    </div>
  );
}
