"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect } from "react";
import { useAuth } from "@/components/Providers";

export default function AdminLayout({ children }: { children: React.ReactNode }) {
  const { user, ready } = useAuth();
  const router = useRouter();
  const path = usePathname();
  useEffect(() => {
    if (ready && !user) router.push("/login?next=/admin");
  }, [ready, user, router]);
  if (!ready) return <div className="p-10 text-slate-400">Chargement…</div>;
  if (!user || (user.role !== "manager" && user.role !== "admin"))
    return <div className="mx-auto max-w-lg p-10 text-center text-slate-300">Accès réservé aux gestionnaires et administrateurs.</div>;
  const items = [
    ["/admin", "Tableau de bord"], ["/admin/events", "Événements"], ["/admin/venue", "Stade & ressources"],
    ...(user.role === "admin" ? [["/admin/users", "Utilisateurs"], ["/admin/audit", "Journal"]] : []),
  ];
  return (
    <div className="mx-auto grid max-w-7xl gap-6 px-4 py-8 md:grid-cols-[210px_1fr]">
      <nav className="flex gap-1 overflow-x-auto md:flex-col">
        {items.map(([href, label]) => (
          <Link key={href} href={href} className={`whitespace-nowrap rounded-lg px-3 py-2 text-sm ${path === href ? "bg-white/10 text-white" : "text-slate-300 hover:bg-white/5"}`}>{label}</Link>
        ))}
      </nav>
      <div className="min-w-0">{children}</div>
    </div>
  );
}
