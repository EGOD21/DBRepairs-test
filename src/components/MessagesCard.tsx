import { useEffect, useState } from "react";
import Icon from "./Icon";
import { listMessages, OutboxMessage } from "../data/comms";
import { formatDbDate } from "../data/dates";
import { useComposer } from "../composer";
import { useI18n } from "../i18n/I18nProvider";

/** Emails and texts this repair sent (by hand or automatically). Hidden until the server sends messages. */
export default function MessagesCard({ repairId }: { repairId: number }) {
  const { t } = useI18n();
  const { status } = useComposer();
  const [messages, setMessages] = useState<OutboxMessage[]>([]);
  const [open, setOpen] = useState<number | null>(null);
  useEffect(() => { if (status.email || status.sms) listMessages({ repairId }).then(setMessages).catch(() => {}); }, [repairId, status.email, status.sms]);
  if (!(status.email || status.sms) || messages.length === 0) return null;
  return (
    <section className="card">
      <div className="card-header"><h2>{t("compose.history")}</h2></div>
      <div className="card-body"><div className="payment-list">{messages.map((m) => (
        <div key={m.id} className="payment-item">
          <div><Icon name={m.channel === "email" ? "mail" : "message"} size={13} /> <strong>{m.subject || m.body.slice(0, 60)}</strong></div>
          <small className="muted">{m.recipient} · {formatDbDate(m.created_at)} · {m.automatic ? t("compose.automatic") : m.sent_by_name}
            {m.status === "failed" && <span className="text-danger"> · {t("compose.failed")}: {m.error}</span>}</small>
          {open === m.id ? <p className="pre" style={{ fontSize: 13 }}>{m.body}</p> : <button type="button" className="link-button" onClick={() => setOpen(m.id)}>{t("compose.show")}</button>}
        </div>
      ))}</div></div>
    </section>
  );
}
