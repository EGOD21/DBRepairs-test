import { api, SessionUser } from "./api";

export type TeamUser = SessionUser & { createdAt: string };
export type UserInput = { username: string; displayName: string; role: "admin" | "tech"; active: boolean; password: string };

export const listUsers = () => api<TeamUser[]>("/users");
export const createUser = (input: UserInput) => api<{ id: number }>("/users", { method: "POST", body: JSON.stringify(input) });
export const updateUser = (id: number, input: Omit<UserInput, "username">) => api<void>(`/users/${id}`, { method: "PUT", body: JSON.stringify(input) });
export const changeMyPassword = (currentPassword: string, newPassword: string) =>
  api<void>("/me/password", { method: "PUT", body: JSON.stringify({ currentPassword, newPassword }) });
