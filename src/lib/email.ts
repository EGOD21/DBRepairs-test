/** Builds a mailto: link that opens the user's email app with the message filled in. */
export function mailtoLink(to: string | null | undefined, subject = "", body = ""): string {
  const params = new URLSearchParams();
  if (subject) params.set("subject", subject);
  if (body) params.set("body", body);
  // URLSearchParams encodes spaces as "+", which mail apps show literally.
  const query = params.toString().replace(/\+/g, "%20");
  return `mailto:${encodeURIComponent((to ?? "").trim()).replace(/%40/g, "@")}${query ? `?${query}` : ""}`;
}

export function telLink(number: string | null | undefined): string {
  return `tel:${(number ?? "").replace(/[^\d+]/g, "")}`;
}

export function smsLink(number: string | null | undefined): string {
  return `sms:${(number ?? "").replace(/[^\d+]/g, "")}`;
}
