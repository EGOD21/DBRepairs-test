export type RepairPrintData = {
  repairNumber: string; openedAt: string; customerName: string; phone?: string; email?: string; deviceType?: string; brand?: string; model?: string;
  serialNumber?: string; imei?: string; reportedFault?: string; accessories?: string; generalCondition?: string; internalNotes?: string;
  dueDate?: string; estimate?: string; deposit?: string; technician?: string; priority?: string;
  /** Server edition intake: ticked checklist, backup choice, waiver text and the customer's intake signature. */
  checklist?: { label: string; checked: boolean }[]; dataBackup?: string; waiver?: string; equipment?: string;
  intakeSignature?: { image: string; name: string };
};

export type OfficeSettings = {
  companyName: string; taxNumber: string; address: string; phone: string; email: string; website: string; logoDataUrl: string; terms: string;
};

export type TicketKind = "intake" | "label" | "receipt";

export const labelSizes: Record<string, { width: number; height: number; label: string }> = {
  "62x29": { width: 62, height: 29, label: "62 × 29 mm (Brother DK-11209)" },
  "89x36": { width: 89, height: 36, label: "89 × 36 mm (Dymo 99012)" },
  "102x51": { width: 102, height: 51, label: "4 × 2 in (102 × 51 mm)" },
  "102x152": { width: 102, height: 152, label: "4 × 6 in (102 × 152 mm)" },
};
export const defaultLabelSize = "62x29";
