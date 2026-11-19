"use client";

import { useEffect, useState } from "react";
import { api } from "@/lib/api";

export default function Audit() {
  const [rows, setRows] = useState<any[]>([]);
  useEffect(() => { api<any[]>("/api/admin/audit?limit=200").then(setRows).catch(() => {}); }, []);
  return (
    <div>
      <h1 className="font-display text-3xl text-white">Journal des opérations</h1>
      <div className="card mt-5 overflow-x-auto p-4">
        <table className="w-full min-w-[720px] text-left text-xs">
          <thead className="uppercase text-slate-400"><tr><th className="py-1">Date</th><th>Utilisateur</th><th>Action</th><th>Entité</th><th>IP</th></tr></thead>
          <tbody>{rows.map((r) => <tr key={r.id} className="border-t border-white/5"><td className="py-1.5">{new Date(r.ts).toLocaleString("fr-FR")}</td><td>{r.user_id ?? "—"}</td><td className="font-mono">{r.action}</td><td>{r.entity} {r.entity_id}</td><td>{r.ip}</td></tr>)}</tbody>
        </table>
      </div>
    </div>
  );
}
