import { useEffect, useState } from "react";
import Icon from "./Icon";
import { currentPushSubscription, disablePush, enablePush, pushSupported, testPush } from "../data/comms";
import { useI18n } from "../i18n/I18nProvider";

/** Turns notifications on or off for this phone or computer. */
export default function PushToggle() {
  const { t } = useI18n();
  const [on, setOn] = useState<boolean | null>(null);
  const [message, setMessage] = useState<{ tone: "error" | "success"; text: string } | null>(null);
  const supported = pushSupported();
  useEffect(() => { currentPushSubscription().then((s) => setOn(Boolean(s))).catch(() => setOn(false)); }, []);

  async function toggle() {
    setMessage(null);
    try {
      if (on) { await disablePush(); setOn(false); }
      else { await enablePush(); setOn(true); setMessage({ tone: "success", text: t("push.enabled") }); }
    } catch (cause) {
      const reason = cause instanceof Error ? cause.message : "";
      setMessage({ tone: "error", text: reason === "denied" ? t("push.denied") : reason === "unsupported" ? t("push.unsupported") : reason || t("common.saveError") });
    }
  }

  return (
    <div style={{ display: "grid", gap: 10 }}>
      <h3>{t("push.title")}</h3>
      <p className="hint">{t("push.hint")}</p>
      {!supported ? <div className="alert warning">{t("push.unsupported")}</div> : (
        <div className="page-actions">
          <button type="button" className={`btn ${on ? "" : "btn-primary"}`} disabled={on === null} onClick={() => void toggle()}><Icon name="bell" size={15} />{on ? t("push.turnOff") : t("push.turnOn")}</button>
          {on && <button type="button" className="btn" onClick={() => void testPush().then(() => setMessage({ tone: "success", text: t("push.testSent") })).catch((e) => setMessage({ tone: "error", text: e instanceof Error ? e.message : "" }))}>{t("push.test")}</button>}
        </div>
      )}
      {message && <div className={`alert ${message.tone}`}>{message.text}</div>}
    </div>
  );
}
