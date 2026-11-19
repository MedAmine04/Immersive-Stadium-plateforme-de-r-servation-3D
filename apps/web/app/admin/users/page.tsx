"use client";

import { useCallback, useEffect, useState } from "react";
import { useAuth } from "@/components/Providers";
import { api } from "@/lib/api";

export default function Users() {
  const { user } = useAuth();
  const [list, setList] = useState<any[]>([]);
  const [err, setErr] = useState<string | null>(null);
  const load = useCallback(() => api<any[]>("/api/admin/users").then(setList).catch((e) => setErr(e.message)), []);
  useEffect(() => { void load(); }, [load]);
  const act = async (fn: () => Promise<any>) => { setErr(null); try { await fn(); } catch (e: any) { setErr(e.message); } await load(); };
  return (
    <div>
      <h1 className="font-display text-3xl text-white">Utilisateurs</h1>
      {err && <p role="alert" className="mt-3 text-red-300">{err}</p>}
      <div className="card mt-5 overflow-x-auto p-4">
        <table className="w-full min-w-[620px] text-left text-sm">
          <thead className="text-xs uppercase text-slate-400"><tr><th className="py-1">E-mail</th><th>Nom</th><th>Rôle</th><th>Actif</th></tr></thead>
          <tbody>{list.map((u) => (
            <tr key={u.id} className="border-t border-white/5">
              <td className="py-2">{u.email}</td><td>{u.full_name}</td>
              <td><select className="field w-36 py-1" disabled={u.id === user?.id} value={u.role} onChange={(e) => act(() => api(`/api/admin/users/${u.id}/role`, { method: "PATCH", body: { role: e.target.value } }))}><option value="spectator">Spectateur</option><option value="manager">Gestionnaire</option><option value="admin">Administrateur</option></select></td>
              <td><input type="checkbox" disabled={u.id === user?.id} checked={u.is_active} onChange={(e) => act(() => api(`/api/admin/users/${u.id}/active`, { method: "PATCH", body: { is_active: e.target.checked } }))} /></td>
            </tr>
          ))}</tbody>
        </table>
      </div>
    </div>
  );
}
