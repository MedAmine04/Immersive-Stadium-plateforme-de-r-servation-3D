/** Client d'API : même origine (réécriture Next.js), cookie de session httpOnly, jeton CSRF en double-submit. */
export class ApiError extends Error {
  status: number;
  code?: string;
  data?: any;
  constructor(status: number, message: string, code?: string, data?: any) {
    super(message);
    this.status = status;
    this.code = code;
    this.data = data;
  }
}

function readCookie(name: string): string | null {
  if (typeof document === "undefined") return null;
  const m = document.cookie.match(new RegExp("(?:^|; )" + name + "=([^;]*)"));
  return m ? decodeURIComponent(m[1]) : null;
}

async function ensureCsrf(): Promise<string> {
  let t = readCookie("csrf_token");
  if (!t) {
    const r = await fetch("/api/auth/csrf", { credentials: "include" });
    t = (await r.json()).csrf_token as string;
  }
  return t!;
}

function messageFrom(body: any, fallback: string): { message: string; code?: string } {
  const d = body?.detail;
  if (typeof d === "string") return { message: d };
  if (d && typeof d === "object" && !Array.isArray(d)) return { message: d.message ?? fallback, code: d.code };
  if (Array.isArray(d) && d.length) return { message: d.map((e: any) => e.msg).join(" ; ") };
  return { message: fallback };
}

export async function api<T = any>(
  path: string,
  opts: { method?: string; body?: unknown; headers?: Record<string, string>; form?: FormData; signal?: AbortSignal } = {},
): Promise<T> {
  const method = opts.method ?? (opts.body || opts.form ? "POST" : "GET");
  const headers: Record<string, string> = { ...(opts.headers ?? {}) };
  if (method !== "GET") headers["X-CSRF-Token"] = await ensureCsrf();
  let body: BodyInit | undefined;
  if (opts.form) body = opts.form;
  else if (opts.body !== undefined) {
    headers["Content-Type"] = "application/json";
    body = JSON.stringify(opts.body);
  }
  const res = await fetch(path, { method, headers, body, credentials: "include", signal: opts.signal });
  if (res.status === 204) return undefined as T;
  let data: any = null;
  try { data = await res.json(); } catch { /* corps vide */ }
  if (!res.ok) {
    const { message, code } = messageFrom(data, `Erreur ${res.status}`);
    throw new ApiError(res.status, message, code, data?.detail);
  }
  return data as T;
}

export function newIdempotencyKey(): string {
  return crypto.randomUUID();
}
