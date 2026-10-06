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

export async function getSession(): Promise<boolean> {
  const response = await fetch(`${apiRoot}/session`);
  if (!response.ok) throw new Error(await responseError(response));
  return (await response.json() as { authenticated: boolean }).authenticated;
}

export type LoginResult = "ok" | "invalid" | "throttled";

export async function login(password: string): Promise<LoginResult> {
  const response = await fetch(`${apiRoot}/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ password }),
  });
  if (response.ok) return "ok";
  if (response.status === 401) return "invalid";
  if (response.status === 429) return "throttled";
  throw new Error(await responseError(response));
}

export async function logout(): Promise<void> {
  await fetch(`${apiRoot}/logout`, { method: "POST" });
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
