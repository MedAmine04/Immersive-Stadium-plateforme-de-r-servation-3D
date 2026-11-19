"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useState } from "react";
import { useAuth } from "./Providers";

function safeNext(n: string | null) {
  return n && n.startsWith("/") && !n.startsWith("//") ? n : "/";
}

function Inner({ mode }: { mode: "login" | "register" }) {
  const { login, register } = useAuth();
  const router = useRouter();
  const next = safeNext(useSearchParams().get("next"));
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [name, setName] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true); setErr(null);
    try {
      if (mode === "login") await login(email, password); else await register(email, password, name);
      router.push(next);
    } catch (e: any) { setErr(e.message); } finally { setBusy(false); }
  }
  return (
    <div className="mx-auto max-w-md px-4 py-14">
      <div className="card p-6">
        <h1 className="font-display text-2xl text-white">{mode === "login" ? "Connexion" : "Créer un compte"}</h1>
        <form onSubmit={submit} className="mt-5 space-y-4">
          {mode === "register" && <div><label className="label" htmlFor="name">Nom complet</label><input id="name" className="field" required minLength={2} autoComplete="name" value={name} onChange={(e) => setName(e.target.value)} /></div>}
          <div><label className="label" htmlFor="email">E-mail</label><input id="email" className="field" type="email" required autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} /></div>
          <div>
            <label className="label" htmlFor="pw">Mot de passe</label>
            <input id="pw" className="field" type="password" required autoComplete={mode === "login" ? "current-password" : "new-password"} value={password} onChange={(e) => setPassword(e.target.value)} />
            {mode === "register" && <p className="mt-1 text-xs text-slate-500">10 caractères minimum, avec au moins une lettre et un chiffre.</p>}
          </div>
          {err && <div role="alert" className="rounded-lg border border-red-400/30 bg-red-500/10 p-3 text-sm text-red-200">{err}</div>}
          <button className="btn btn-gold w-full" disabled={busy}>{busy ? "Veuillez patienter…" : mode === "login" ? "Se connecter" : "Créer mon compte"}</button>
        </form>
        <div className="mt-4 flex justify-between text-sm text-slate-400">
          {mode === "login" ? <><Link href="/register" className="hover:text-white">Créer un compte</Link><Link href="/forgot-password" className="hover:text-white">Mot de passe oublié ?</Link></> : <Link href="/login" className="hover:text-white">J’ai déjà un compte</Link>}
        </div>
      </div>
    </div>
  );
}

export default function AuthForm({ mode }: { mode: "login" | "register" }) {
  return <Suspense><Inner mode={mode} /></Suspense>;
}
