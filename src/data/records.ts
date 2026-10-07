import { api } from "./api";

export const assetKinds = ["desktop", "laptop", "server", "nas", "switch", "router", "firewall", "access_point", "printer", "ups", "phone", "tablet", "vm", "other"] as const;
export type AssetKind = typeof assetKinds[number];
export const networkKinds = ["subnet", "vlan", "wifi", "dns", "dhcp", "gateway", "vpn", "port_forward", "isp", "other"] as const;
export type NetworkKind = typeof networkKinds[number];
export const wipeMethods = ["nist_clear", "nist_purge", "crypto_erase", "dod_3pass", "single_pass", "degauss", "shred", "drill"] as const;
export type WipeMethod = typeof wipeMethods[number];

export type Asset = {
  id: number; customer_id: number; customer_name: string; kind: AssetKind; name: string; brand: string | null; model: string | null; serial_number: string | null;
  asset_tag: string | null; os: string | null; cpu: string | null; ram: string | null; storage: string | null; ip_address: string | null; mac_address: string | null;
  location: string | null; purchase_date: string | null; warranty_end: string | null; notes: string | null; status: "active" | "retired";
  repair_count: number; credential_count: number;
};
export type AssetDetail = Asset & {
  repairs: { id: number; repair_number: string; opened_at: string; closed_at: string | null; reported_fault: string | null; status_code: string; status_label_key: string }[];
  plans: { id: number; title: string; frequency: string; interval_count: number; next_due: string; active: boolean }[];
  wipes: { id: number; certificate_number: string; drive_serial: string; method: WipeMethod; completed_at: string; result: string }[];
};
export type AssetInput = Omit<Asset, "id" | "customer_name" | "repair_count" | "credential_count">;
export const blankAsset = (customerId: number): AssetInput => ({
  customer_id: customerId, kind: "desktop", name: "", brand: "", model: "", serial_number: "", asset_tag: "", os: "", cpu: "", ram: "", storage: "",
  ip_address: "", mac_address: "", location: "", purchase_date: "", warranty_end: "", notes: "", status: "active",
});

export type NetworkItem = { id?: number; kind: NetworkKind; name: string; value: string | null; notes: string | null };
export type CustomerFile = { id: number; original_name: string | null; content_type: string; size: number; caption: string | null; created_at: string; uploaded_by_name: string | null };
export type CustomerNetwork = {
  network: { isp: string | null; wan_ip: string | null; notes: string | null; updated_at: string; updated_by: string | null } | null;
  items: NetworkItem[]; files: CustomerFile[];
};

export type Credential = {
  id: number; customer_id: number; asset_id: number | null; asset_name: string | null; label: string; username: string | null; url: string | null;
  notes: string | null; has_secret: boolean; created_at: string; updated_at: string;
};
export type CredentialInput = { customer_id: number; asset_id: number | null; label: string; username: string; secret: string; url: string; notes: string };

export type Wipe = {
  id: number; certificate_number: string; customer_id: number; customer_name: string; customer_company: string | null; repair_id: number | null; repair_number: string | null;
  asset_id: number | null; asset_name: string | null; drive_model: string | null; drive_serial: string; capacity: string | null; interface: string | null; method: WipeMethod;
  tool: string | null; passes: number | null; completed_at: string; result: "passed" | "failed"; verified: boolean; technician: string | null; notes: string | null;
  created_by_name: string | null;
};
export type WipeInput = Pick<Wipe, "customer_id" | "repair_id" | "asset_id" | "method" | "result" | "verified"> & {
  drive_model: string; drive_serial: string; capacity: string; interface: string; tool: string; passes: string; completed_at: string; technician: string; notes: string;
};

export type RepairSignature = { id: number; kind: "intake" | "pickup"; signer_name: string; image: string; signed_at: string };

const q = (params: Record<string, string | number | undefined>) => {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) if (value !== undefined && value !== "") search.set(key, String(value));
  return search.toString() ? `?${search}` : "";
};

export const listAssets = (filters: { customerId?: number; search?: string } = {}) => api<Asset[]>(`/assets${q(filters)}`);
export const getAsset = (id: number) => api<AssetDetail>(`/assets/${id}`);
export const createAsset = (input: AssetInput) => api<Asset>("/assets", { method: "POST", body: JSON.stringify(input) });
export const updateAsset = (id: number, input: AssetInput) => api<Asset>(`/assets/${id}`, { method: "PUT", body: JSON.stringify(input) });
export const deleteAsset = (id: number) => api<void>(`/assets/${id}`, { method: "DELETE" });

export const getNetwork = (customerId: number) => api<CustomerNetwork>(`/customers/${customerId}/network`);
export const saveNetwork = (customerId: number, input: { isp: string; wan_ip: string; notes: string; items: NetworkItem[] }) =>
  api<void>(`/customers/${customerId}/network`, { method: "PUT", body: JSON.stringify(input) });
export const fileUrl = (id: number, download = false) => `/api/files/${id}${download ? "?download=1" : ""}`;
export const deleteFile = (id: number) => api<void>(`/files/${id}`, { method: "DELETE" });

export const vaultStatus = () => api<{ enabled: boolean }>("/vault/status");
export const listCredentials = (filters: { customerId?: number; assetId?: number }) => api<Credential[]>(`/credentials${q(filters)}`);
export const createCredential = (input: CredentialInput) => api<Credential>("/credentials", { method: "POST", body: JSON.stringify(input) });
export const updateCredential = (id: number, input: CredentialInput) => api<Credential>(`/credentials/${id}`, { method: "PUT", body: JSON.stringify(input) });
export const deleteCredential = (id: number) => api<void>(`/credentials/${id}`, { method: "DELETE" });
export const revealCredential = (id: number) => api<{ secret: string }>(`/credentials/${id}/reveal`, { method: "POST", body: "{}" });

export const listRepairSignatures = (repairId: number) => api<RepairSignature[]>(`/repairs/${repairId}/signatures`);
export const signRepair = (repairId: number, kind: "intake" | "pickup", name: string, signature: string) =>
  api<RepairSignature>(`/repairs/${repairId}/signatures`, { method: "POST", body: JSON.stringify({ kind, name, signature }) });

export const listWipes = (filters: { customerId?: number; repairId?: number } = {}) => api<Wipe[]>(`/wipes${q(filters)}`);
export const createWipe = (input: WipeInput) => api<Wipe>("/wipes", { method: "POST", body: JSON.stringify(input) });
export const updateWipe = (id: number, input: WipeInput) => api<Wipe>(`/wipes/${id}`, { method: "PUT", body: JSON.stringify(input) });
export const deleteWipe = (id: number) => api<void>(`/wipes/${id}`, { method: "DELETE" });

/** Intake checklist items from the setting: one per line. */
export const checklistItems = (setting: string) => setting.split("\n").map((line) => line.replace(/^[-*•]\s*/, "").trim()).filter(Boolean).slice(0, 50);
export const defaultChecklist = "Power adapter / charger\nBattery\nBag or case\nHard drive / SSD present\nPassword provided\nPowers on at intake\nVisible damage photographed";

export const saveIntake = (repairId: number, input: { asset_id?: number | null; data_backup?: string | null; intake_checklist?: Record<string, boolean> | null }) =>
  api<void>(`/repairs/${repairId}/intake`, { method: "PUT", body: JSON.stringify(input) });
