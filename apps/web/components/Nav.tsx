"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useAuth } from "./Providers";

export default function Nav() {
  const { user, logout, ready } = useAuth();
  const path = usePathname();
  const router = useRouter();
  const staff = user && (user.role === "manager" || user.role === "admin");
  const link = (href: string, label: string) => (
    <Link href={href} className={`rounded-md px-2.5 py-1.5 text-sm ${path === href || (href !== "/" && path.startsWith(href)) ? "bg-white/10 text-white" : "text-slate-300 hover:text-white"}`}>{label}</Link>
  );
  return (
    <header className="sticky top-0 z-50 border-b border-white/10 bg-ink-950/90 backdrop-blur">
      <div className="mx-auto flex h-14 max-w-[1600px] items-center gap-3 px-4">
        <Link href="/" className="flex items-center gap-2 font-display text-lg font-semibold tracking-wide text-white">
          <span className="grid h-7 w-7 place-items-center rounded-md bg-gold-400 text-ink-950">◐</span>
          <span className="hidden sm:inline">Immersive Stadium</span>
        </Link>
        <nav className="ml-2 flex items-center gap-1">
          {link("/", "Stade")}
          {user && link("/reservations", "Mes réservations")}
          {staff && link("/admin", "Administration")}
        </nav>
        <div className="ml-auto flex items-center gap-2">
          {!ready ? null : user ? (
            <>
              <span className="hidden text-sm text-slate-300 md:inline">{user.full_name}</span>
              <button className="btn btn-ghost" onClick={async () => { await logout(); router.push("/"); }}>Déconnexion</button>
            </>
          ) : (
            <>
              <Link href={`/login?next=${encodeURIComponent(path || "/")}`} className="btn btn-ghost">Connexion</Link>
              <Link href="/register" className="btn btn-gold">Créer un compte</Link>
            </>
          )}
        </div>
      </div>
      <div className="border-t border-amber-400/20 bg-amber-400/10 px-4 py-1 text-center text-[11px] text-amber-200">
        Version de démonstration — aucun paiement réel, aucune confirmation ne constitue un billet d’accès.
      </div>
    </header>
  );
}
