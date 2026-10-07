import { api } from "./api";

export type MessagingStatus = { email: boolean; sms: boolean; push: boolean };
export type OutboxMessage = {
  id: number; channel: "email" | "sms"; recipient: string; subject: string | null; body: string; status: "sent" | "failed"; error: string | null;
  repair_id: number | null; customer_id: number | null; invoice_id: number | null; sent_by_name: string | null; automatic: boolean; created_at: string;
};
export type MessageInput = { channel: "email" | "sms"; to: string; subject?: string; body: string; repair_id?: number | null; customer_id?: number | null; invoice_id?: number | null };

export const messagingStatus = () => api<MessagingStatus>("/messaging/status");
export const sendMessage = (input: MessageInput) => api<{ ok: true }>("/messages", { method: "POST", body: JSON.stringify(input) });
export const listMessages = (filters: { repairId?: number; customerId?: number } = {}) =>
  api<OutboxMessage[]>(`/messages${filters.repairId ? `?repairId=${filters.repairId}` : filters.customerId ? `?customerId=${filters.customerId}` : ""}`);
export const statusLink = (repairId: number) => api<{ url: string | null }>(`/repairs/${repairId}/status-link`);

// ---------- Push notifications on this device ----------
const toKey = (base64url: string) => {
  const raw = atob(base64url.replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(base64url.length / 4) * 4, "="));
  return Uint8Array.from(raw, (char) => char.charCodeAt(0));
};

export function pushSupported() {
  return "serviceWorker" in navigator && "PushManager" in window && "Notification" in window && window.isSecureContext;
}

export async function currentPushSubscription() {
  if (!pushSupported()) return null;
  const registration = await navigator.serviceWorker.getRegistration();
  return registration ? registration.pushManager.getSubscription() : null;
}

export async function enablePush() {
  if (!pushSupported()) throw new Error("unsupported");
  const permission = await Notification.requestPermission();
  if (permission !== "granted") throw new Error("denied");
  const registration = await navigator.serviceWorker.ready;
  const { publicKey } = await api<{ publicKey: string }>("/push/key");
  const subscription = await registration.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: toKey(publicKey) });
  await api<void>("/push/subscriptions", { method: "POST", body: JSON.stringify(subscription.toJSON()) });
}

export async function disablePush() {
  const subscription = await currentPushSubscription();
  if (!subscription) return;
  await api<void>("/push/subscriptions", { method: "DELETE", body: JSON.stringify({ endpoint: subscription.endpoint }) }).catch(() => {});
  await subscription.unsubscribe();
}

export const testPush = () => api<{ devices: number }>("/push/test", { method: "POST", body: "{}" });

// ---------- Knowledge base and checklists ----------
export type Article = { id: number; title: string; body: string; tags: string | null; device_type: string | null; created_at: string; updated_at: string;
  created_by_name: string | null; updated_by_name: string | null };
export type ArticleInput = { title: string; body: string; tags: string; device_type: string };
export type ChecklistTemplate = { id: number; name: string; device_type: string | null; items: string; active: boolean };
export type ChecklistItem = { label: string; done: boolean; by?: string | null; at?: string | null; note?: string | null };
export type RepairChecklist = { id: number; repair_id: number; name: string; items: ChecklistItem[]; created_at: string };

export const listArticles = (search = "") => api<Article[]>(`/kb${search.trim() ? `?search=${encodeURIComponent(search.trim())}` : ""}`);
export const getArticle = (id: number) => api<Article>(`/kb/${id}`);
export const createArticle = (input: ArticleInput) => api<Article>("/kb", { method: "POST", body: JSON.stringify(input) });
export const updateArticle = (id: number, input: ArticleInput) => api<Article>(`/kb/${id}`, { method: "PUT", body: JSON.stringify(input) });
export const deleteArticle = (id: number) => api<void>(`/kb/${id}`, { method: "DELETE" });
export const suggestedArticles = (repairId: number) => api<Pick<Article, "id" | "title" | "tags" | "device_type">[]>(`/repairs/${repairId}/kb`);

export const listTemplates = () => api<ChecklistTemplate[]>("/checklists");
export const createTemplate = (input: Omit<ChecklistTemplate, "id">) => api<ChecklistTemplate>("/checklists", { method: "POST", body: JSON.stringify(input) });
export const updateTemplate = (id: number, input: Omit<ChecklistTemplate, "id">) => api<ChecklistTemplate>(`/checklists/${id}`, { method: "PUT", body: JSON.stringify(input) });
export const deleteTemplate = (id: number) => api<void>(`/checklists/${id}`, { method: "DELETE" });
export const listRepairChecklists = (repairId: number) => api<RepairChecklist[]>(`/repairs/${repairId}/checklists`);
export const addRepairChecklist = (repairId: number, templateId: number) => api<RepairChecklist>(`/repairs/${repairId}/checklists`, { method: "POST", body: JSON.stringify({ template_id: templateId }) });
export const tickChecklist = (id: number, index: number, done: boolean, note?: string) =>
  api<RepairChecklist>(`/repair-checklists/${id}/items/${index}`, { method: "PUT", body: JSON.stringify({ done, note }) });
export const removeRepairChecklist = (id: number) => api<void>(`/repair-checklists/${id}`, { method: "DELETE" });

// Same wording the server falls back to when a template is left empty.
export const defaultTemplates = {
  received: {
    subject: "We received your {device} — repair {number}",
    body: "Hello {name},\n\nThanks for bringing in your {device}. Your repair number is {number}.{statusLine}\n\nWe will let you know as soon as it is ready.\n\n{company}",
    sms: "{company}: we received your {device} (repair {number}).{statusLine}",
  },
  ready: {
    subject: "Your {device} is ready for pickup — repair {number}",
    body: "Hello {name},\n\nGood news: your {device} (repair {number}) is ready for pickup.{balanceLine}{statusLine}\n\n{company}",
    sms: "{company}: your {device} (repair {number}) is ready for pickup.{balanceLine}",
  },
};
