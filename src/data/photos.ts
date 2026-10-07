import { api } from "./api";

export type RepairPhoto = {
  id: number; repair_id: number | null; repair_number: string; customer_name: string | null; original_name: string | null;
  content_type: string; size: number; thumb_size: number; has_thumb: boolean; caption: string | null; created_at: string;
  archived_at: string | null; uploaded_by_name: string | null;
};

export type ArchivedPhotoGroup = { repair_number: string; customer_name: string | null; count: number; bytes: number; archived_at: string; ids: number[] };

export type StorageSummary = {
  available: boolean; path: string | null; disk: { free: number; total: number } | null;
  photos: { count: number; bytes: number }; archived: { count: number; bytes: number }; closed: { count: number; bytes: number };
  autoDeleteDays: number;
};

export type PruneResult = { deleted: number; bytes: number };
export type VerifyResult = { checked: number; missing: { id: number; repair_number: string }[]; orphans: number; fixed: boolean };

export const photoUrl = (id: number, size: "full" | "thumb" = "full") => `/api/photos/${id}${size === "thumb" ? "?size=thumb" : ""}`;
export const photoDownloadUrl = (id: number) => `/api/photos/${id}?download=1`;

export const listRepairPhotos = (repairId: number) => api<RepairPhoto[]>(`/repairs/${repairId}/photos`);
export const updatePhotoCaption = (id: number, caption: string) => api<void>(`/photos/${id}`, { method: "PUT", body: JSON.stringify({ caption }) });
export const deletePhoto = (id: number) => api<void>(`/photos/${id}`, { method: "DELETE" });
export const deletePhotos = (ids: number[]) => api<PruneResult>("/photos/delete", { method: "POST", body: JSON.stringify({ ids }) });
export const deleteRepairPhotos = (repairId: number) => api<PruneResult>(`/repairs/${repairId}/photos`, { method: "DELETE" });
export const listArchivedPhotos = () => api<ArchivedPhotoGroup[]>("/photos/archived");
export const getStorage = () => api<StorageSummary>("/storage");
export const prunePhotos = (target: "archived" | "closed", olderThanDays = 0, repairNumber?: string) =>
  api<PruneResult>("/storage/prune", { method: "POST", body: JSON.stringify({ target, olderThanDays, repairNumber }) });
export const verifyStorage = (fix = false) => api<VerifyResult>("/storage/verify", { method: "POST", body: JSON.stringify({ fix }) });

// Phone cameras take 12–50 megapixel photos. These sizes keep plenty of detail
// for printing while making each photo about 1 MB instead of 5–15 MB.
const FULL_EDGE = 2560;
const THUMB_EDGE = 480;
const directTypes = new Set(["image/jpeg", "image/png", "image/webp"]);

function loadImage(file: Blob): Promise<HTMLImageElement> {
  const url = URL.createObjectURL(file);
  return new Promise<HTMLImageElement>((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error("unsupported"));
    image.src = url;
  }).finally(() => window.setTimeout(() => URL.revokeObjectURL(url), 0));
}

// Browsers apply the camera's rotation flag when drawing, so the result is upright.
function resize(image: HTMLImageElement, edge: number, quality: number): Promise<Blob> {
  const scale = Math.min(1, edge / Math.max(image.naturalWidth, image.naturalHeight));
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(image.naturalWidth * scale));
  canvas.height = Math.max(1, Math.round(image.naturalHeight * scale));
  const context = canvas.getContext("2d");
  if (!context) return Promise.reject(new Error("unsupported"));
  context.fillStyle = "#fff";
  context.fillRect(0, 0, canvas.width, canvas.height);
  context.drawImage(image, 0, 0, canvas.width, canvas.height);
  return new Promise((resolve, reject) => canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error("unsupported"))), "image/jpeg", quality));
}

async function post<T>(path: string, body: Blob, headers: Record<string, string> = {}): Promise<T | undefined> {
  const response = await fetch(`/api${path}`, { method: "POST", headers: { "Content-Type": "application/octet-stream", ...headers }, body });
  if (!response.ok) {
    let message = `HTTP ${response.status}`;
    try { message = (await response.json() as { error?: string }).error || message; } catch { /* keep status */ }
    if (response.status === 401) window.dispatchEvent(new Event("dbrepairs:unauthorized"));
    throw new Error(message);
  }
  return response.status === 204 ? undefined : response.json() as Promise<T>;
}

/** Shrinks a photo in the browser, uploads it, then uploads its small preview. */
export async function uploadRepairPhoto(repairId: number, file: File): Promise<RepairPhoto> {
  let full: Blob = file;
  let thumb: Blob | null = null;
  let name = file.name || "photo.jpg";
  try {
    const image = await loadImage(file);
    full = await resize(image, FULL_EDGE, 0.85);
    // A small PNG screenshot can be smaller than its JPEG copy; keep whichever is smaller.
    if (directTypes.has(file.type) && file.size <= full.size) full = file;
    else name = name.replace(/\.[^.]+$/, "") + ".jpg";
    thumb = await resize(image, THUMB_EDGE, 0.75);
  } catch {
    // The browser cannot open this file (for example HEIC on a desktop browser).
    if (!directTypes.has(file.type)) throw new Error("unsupported");
  }
  const photo = await post<RepairPhoto>(`/repairs/${repairId}/photos`, full, { "X-Filename": encodeURIComponent(name) });
  if (!photo) throw new Error("upload failed");
  if (thumb) {
    try {
      await post(`/photos/${photo.id}/thumbnail`, thumb);
      photo.has_thumb = true;
    } catch {
      // Without a preview the gallery shows the full photo instead.
    }
  }
  return photo;
}

export function formatBytes(bytes: number) {
  if (!bytes) return "0 MB";
  const units = ["B", "KB", "MB", "GB", "TB"];
  const power = Math.min(units.length - 1, Math.floor(Math.log(bytes) / Math.log(1024)));
  const value = bytes / 1024 ** power;
  return `${value >= 100 || power === 0 ? Math.round(value) : value.toFixed(1)} ${units[power]}`;
}
