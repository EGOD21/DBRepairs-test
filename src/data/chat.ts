import { api, uploadFile } from "./api";

export type ChatAttachment = { id: number; filename: string; contentType: string; size: number };
export type ChatMessage = {
  id: number; user_id: number | null; author_name: string; author_username: string | null; body: string; tags: string[];
  resolved: boolean; created_at: string; attachments: ChatAttachment[];
};

export const presetTags = ["question", "parts", "urgent", "customer", "info"];

export const listMessages = (after?: number) => api<ChatMessage[]>(after ? `/chat/messages?after=${after}` : "/chat/messages");
export const listOlderMessages = (before: number) => api<ChatMessage[]>(`/chat/messages?before=${before}`);
export const sendMessage = (body: string, tags: string[], attachmentIds: number[]) =>
  api<ChatMessage>("/chat/messages", { method: "POST", body: JSON.stringify({ body, tags, attachmentIds }) });
export const uploadAttachment = (file: File) => uploadFile<ChatAttachment>("/chat/attachments", file);
export const setResolved = (id: number, resolved: boolean) => api<void>(`/chat/messages/${id}/resolved`, { method: "PUT", body: JSON.stringify({ resolved }) });
export const deleteMessage = (id: number) => api<void>(`/chat/messages/${id}`, { method: "DELETE" });
export const unreadCount = (after: number) => api<{ count: number; latest: number }>(`/chat/unread?after=${after}`);
export const attachmentUrl = (id: number, download = false) => `/api/chat/attachments/${id}${download ? "?download=1" : ""}`;

const lastSeenKey = "dbrepairs.chatLastSeen";
export function getLastSeen(): number {
  try { return Number(localStorage.getItem(lastSeenKey)) || 0; } catch { return 0; }
}
export function setLastSeen(id: number) {
  try { if (id > getLastSeen()) localStorage.setItem(lastSeenKey, String(id)); } catch { /* unread badge just won't persist */ }
}
