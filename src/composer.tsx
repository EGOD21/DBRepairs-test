import { createContext, MouseEvent, ReactNode, useContext, useEffect, useState } from "react";
import Modal from "./components/Modal";
import { MessageInput, messagingStatus, MessagingStatus, sendMessage } from "./data/comms";
import { isServerMode } from "./data/runtime";
import { useI18n } from "./i18n/I18nProvider";

type Draft = MessageInput;
type ComposerValue = {
  status: MessagingStatus;
  /** Use as an onClick on a mailto:/sms: link: sends from the server when it can, otherwise lets the link open the device's app. */
  intercept: (draft: Draft) => (event: MouseEvent<HTMLElement>) => void;
  open: (draft: Draft) => void;
};

const none: MessagingStatus = { email: false, sms: false, push: false };
const ComposerContext = createContext<ComposerValue>({ status: none, intercept: () => () => {}, open: () => {} });

/** Splits a mailto: link back into its parts, so existing links can be sent from the server instead. */
export function draftFromMailto(href: string, extra: Partial<Draft> = {}): Draft {
  const url = new URL(href);
  return { channel: "email", to: decodeURIComponent(url.pathname), subject: url.searchParams.get("subject") ?? "", body: url.searchParams.get("body") ?? "", ...extra };
}

export function ComposerProvider({ children }: { children: ReactNode }) {
  const { t } = useI18n();
  const [status, setStatus] = useState<MessagingStatus>(none);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [sent, setSent] = useState(false);

  useEffect(() => { if (isServerMode) messagingStatus().then(setStatus).catch(() => {}); }, []);

  const open = (next: Draft) => { setDraft(next); setError(""); setSent(false); setBusy(false); };
  const intercept = (next: Draft) => (event: MouseEvent<HTMLElement>) => {
    if (!status[next.channel]) return;
    event.preventDefault();
    open(next);
  };

  async function send() {
    if (!draft) return;
    setBusy(true); setError("");
    try {
      await sendMessage(draft);
      setSent(true);
      window.setTimeout(() => setDraft(null), 900);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : t("common.saveError"));
    } finally {
      setBusy(false);
    }
  }

  return (
    <ComposerContext.Provider value={{ status, intercept, open }}>
      {children}
      {draft && (
        <Modal title={draft.channel === "email" ? t("compose.email") : t("compose.sms")} onClose={() => setDraft(null)} wide
          footer={<><button type="button" className="btn" onClick={() => setDraft(null)}>{t("common.cancel")}</button>
            <button type="button" className="btn btn-primary" disabled={busy || sent || !draft.to.trim() || !draft.body.trim()} onClick={() => void send()}>{sent ? t("compose.sent") : busy ? t("compose.sending") : t("compose.send")}</button></>}>
          <div className="modal-body">
            <label className="field"><span>{t("compose.to")}</span><input value={draft.to} onChange={(e) => setDraft({ ...draft, to: e.target.value })} /></label>
            {draft.channel === "email" && <label className="field"><span>{t("compose.subject")}</span><input value={draft.subject ?? ""} onChange={(e) => setDraft({ ...draft, subject: e.target.value })} /></label>}
            <label className="field"><span>{t("compose.message")}</span><textarea rows={draft.channel === "email" ? 12 : 5} value={draft.body} onChange={(e) => setDraft({ ...draft, body: e.target.value })} />
              {draft.channel === "sms" && <small>{draft.body.length} / 1600</small>}</label>
            {error && <div className="alert error">{error}</div>}
          </div>
        </Modal>
      )}
    </ComposerContext.Provider>
  );
}

export const useComposer = () => useContext(ComposerContext);
