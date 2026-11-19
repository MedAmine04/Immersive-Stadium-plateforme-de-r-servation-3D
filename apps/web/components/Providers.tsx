"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { api } from "@/lib/api";
import type { User } from "@/lib/types";

interface AuthCtx {
  user: User | null;
  ready: boolean;
  refresh: () => Promise<void>;
  login: (email: string, password: string) => Promise<User>;
  register: (email: string, password: string, fullName: string) => Promise<User>;
  logout: () => Promise<void>;
}
const Ctx = createContext<AuthCtx | null>(null);

export function Providers({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [ready, setReady] = useState(false);

  const refresh = useCallback(async () => {
    try { setUser(await api<User>("/api/auth/me")); } catch { setUser(null); } finally { setReady(true); }
  }, []);
  useEffect(() => { void refresh(); }, [refresh]);

  const value = useMemo<AuthCtx>(() => ({
    user, ready, refresh,
    async login(email, password) { const u = await api<User>("/api/auth/login", { body: { email, password } }); setUser(u); return u; },
    async register(email, password, full_name) { const u = await api<User>("/api/auth/register", { body: { email, password, full_name } }); setUser(u); return u; },
    async logout() { await api("/api/auth/logout", { method: "POST" }).catch(() => {}); setUser(null); },
  }), [user, ready, refresh]);

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useAuth() {
  const c = useContext(Ctx);
  if (!c) throw new Error("useAuth hors du Provider");
  return c;
}
