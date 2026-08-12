// Thin API client. All calls are same-origin (Vite proxies /api in dev;
// Express serves /api + static client in prod). Cookies travel automatically.

// ADR-008: the environment selection is persisted here and sent on EVERY
// request as the X-Environment header (the session cookie is not involved).
export const ENV_STORAGE_KEY = "qorvexa.env";
export function getEnvHeader(): Record<string, string> {
  try {
    const env = localStorage.getItem(ENV_STORAGE_KEY);
    return env ? { "x-environment": env } : {};
  } catch {
    return {};
  }
}

export class ApiError extends Error {
  status: number;
  issues?: string[];
  data?: Record<string, unknown>; // raw response body (e.g. duplicateId on 409)
  constructor(status: number, message: string, issues?: string[], data?: Record<string, unknown>) {
    super(message);
    this.status = status;
    this.issues = issues;
    this.data = data;
  }
}

export async function api<T = unknown>(path: string, options: RequestInit = {}): Promise<T> {
  const res = await fetch(path, {
    ...options,
    headers: {
      "content-type": "application/json",
      ...getEnvHeader(),
      ...(options.headers ?? {}),
    },
    credentials: "same-origin",
  });
  if (!res.ok) {
    let data: { error?: string; issues?: string[] } = {};
    try {
      data = await res.json();
    } catch {
      /* ignore */
    }
    throw new ApiError(res.status, data.error ?? `Request failed (${res.status})`, data.issues, data as Record<string, unknown>);
  }
  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}

export const get = <T>(path: string) => api<T>(path);
export const post = <T>(path: string, body?: unknown) =>
  api<T>(path, { method: "POST", body: body === undefined ? undefined : JSON.stringify(body) });
export const patch = <T>(path: string, body: unknown) =>
  api<T>(path, { method: "PATCH", body: JSON.stringify(body) });
export const del = <T>(path: string) => api<T>(path, { method: "DELETE" });

/** Download a server-generated CSV (keeps the X-Environment header + auth cookie). */
export async function downloadCsv(path: string, filename: string) {
  const res = await fetch(path, { headers: { ...getEnvHeader() }, credentials: "same-origin" });
  if (!res.ok) {
    let data: { error?: string } = {};
    try {
      data = await res.json();
    } catch {
      /* ignore */
    }
    throw new ApiError(res.status, data.error ?? `Export failed (${res.status})`);
  }
  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

export type User = {
  id: string;
  orgId: string;
  email: string;
  name: string;
  role: string;
  title: string | null;
  active: boolean;
  lastLoginAt: string | null;
  createdAt: string;
};

export type Org = {
  id: string;
  name: string;
  slug: string;
  plan: string;
  settings: Record<string, unknown>;
};
