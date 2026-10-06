const apiRoot = "/api";
export const unauthorizedEvent = "dbrepairs:unauthorized";

async function responseError(response: Response) {
  try {
    const body = await response.json() as { error?: string };
    return body.error || `HTTP ${response.status}`;
  } catch {
    return `HTTP ${response.status}`;
  }
}

async function ensureOk(response: Response) {
  if (response.ok) return;
  if (response.status === 401) window.dispatchEvent(new Event(unauthorizedEvent));
  throw new Error(await responseError(response));
}

export async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${apiRoot}${path}`, {
    ...init,
    headers: init?.body ? { "Content-Type": "application/json", ...init.headers } : init?.headers,
  });
  await ensureOk(response);
  if (response.status === 204) return undefined as T;
  return response.json() as Promise<T>;
}

export type SessionUser = { id: number; username: string; displayName: string; role: "admin" | "tech"; active: boolean };

export async function getSession(): Promise<SessionUser | null> {
  const response = await fetch(`${apiRoot}/session`);
  if (!response.ok) throw new Error(await responseError(response));
  const body = await response.json() as { authenticated: boolean; user?: SessionUser };
  return body.authenticated && body.user ? body.user : null;
}

export type LoginResult = { status: "ok"; user: SessionUser } | { status: "invalid" | "throttled" };

export async function login(username: string, password: string): Promise<LoginResult> {
  const response = await fetch(`${apiRoot}/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username, password }),
  });
  if (response.ok) return { status: "ok", user: (await response.json() as { user: SessionUser }).user };
  if (response.status === 401) return { status: "invalid" };
  if (response.status === 429) return { status: "throttled" };
  throw new Error(await responseError(response));
}

export async function logout(): Promise<void> {
  await fetch(`${apiRoot}/logout`, { method: "POST" });
}

/** Sends a file as the raw request body (no extra libraries needed). */
export async function uploadFile<T>(path: string, file: File): Promise<T> {
  const response = await fetch(`${apiRoot}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/octet-stream", "X-Filename": encodeURIComponent(file.name), "X-Content-Type": file.type || "application/octet-stream" },
    body: file,
  });
  await ensureOk(response);
  return response.json() as Promise<T>;
}

export async function downloadApiFile(path: string): Promise<string> {
  const response = await fetch(`${apiRoot}${path}`);
  await ensureOk(response);
  const disposition = response.headers.get("Content-Disposition") || "";
  const filename = disposition.match(/filename=([^;]+)/i)?.[1]?.replace(/^"|"$/g, "") || "DBRepairs-backup.dump";
  downloadBlob(await response.blob(), filename);
  return filename;
}

export async function restoreApiBackup(data: ArrayBuffer): Promise<void> {
  const response = await fetch(`${apiRoot}/backups/database`, {
    method: "PUT",
    headers: { "Content-Type": "application/octet-stream" },
    body: data,
  });
  await ensureOk(response);
}

export function downloadTextFile(content: string, filename: string) {
  downloadBlob(new Blob([content], { type: "text/csv;charset=utf-8" }), filename);
}

function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}
