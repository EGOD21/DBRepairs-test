import { Repair } from "../data/repairs";
import { AppSettings } from "../data/settings";
import { deviceLabel, fill, formatMoney } from "./format";
import { mailtoLink } from "./email";

export const repairEmailTemplates = ["received", "estimate", "waitingParts", "ready", "thanks", "blank"] as const;
export type RepairEmailTemplate = typeof repairEmailTemplates[number];

export function emailSignature(settings: AppSettings) {
  const custom = settings["email.signature"].trim();
  if (custom) return custom;
  return [settings["office.companyName"] || "DBRepairs", settings["office.phone"], settings["office.website"]].filter(Boolean).join("\n");
}

/** Builds a ready-to-send mailto: link for a repair, in the interface language. */
export function repairEmail(template: RepairEmailTemplate, repair: Repair, settings: AppSettings, t: (key: string) => string) {
  const firstName = repair.customer_name.split(/\s+/)[0] || repair.customer_name;
  const values = {
    name: firstName,
    customer: repair.customer_name,
    number: repair.repair_number,
    device: deviceLabel(repair),
    estimate: formatMoney(repair.estimated_value),
    total: formatMoney(repair.final_value ?? repair.estimated_value),
    company: settings["office.companyName"] || "DBRepairs",
    status: t(repair.status_label_key),
    signature: emailSignature(settings),
  };
  if (template === "blank") return mailtoLink(repair.customer_email, fill(t("email.blank.subject"), values), fill(t("email.blank.body"), values));
  return mailtoLink(repair.customer_email, fill(t(`email.${template}.subject`), values), fill(t(`email.${template}.body`), values));
}
