import { ChangeEvent, KeyboardEvent, ReactNode, useEffect, useMemo, useRef, useState } from "react";
import Icon from "../components/Icon";
import {
  attachmentUrl, ChatAttachment, ChatMessage, deleteMessage, listMessages, listOlderMessages, presetTags, sendMessage, setLastSeen,
  setResolved, uploadAttachment,
} from "../data/chat";
import { parseDbDate } from "../data/dates";
import { useI18n } from "../i18n/I18nProvider";
import { useSession } from "../session";
import { href } from "../router";

const MAX_FILE_BYTES = 15 * 1024 * 1024;
const MAX_FILES = 6;
const POLL_MS = 4000;

type Filter = "all" | "open-questions" | string;

// Web links and repair numbers (2026-000012) in messages become clickable.
const tokenPattern = /(https?:\/\/[^\s<>"']+[^\s<>"'.,;:!?)\]])|(\b\d{4}-\d{6}\b)/g;

function MessageText({ text }: { text: string }) {
  const parts: ReactNode[] = [];
  let last = 0;
  for (const match of text.matchAll(tokenPattern)) {
    const index = match.index ?? 0;
    if (index > last) parts.push(text.slice(last, index));
    if (match[1]) parts.push(<a key={index} href={match[1]} target="_blank" rel="noopener noreferrer">{match[1]}</a>);
    else parts.push(<a key={index} href={href({ name: "repairs", filter: `q:${match[2]}` })}>{match[2]}</a>);
    last = index + match[0].length;
  }
  if (last < text.length) parts.push(text.slice(last));
  return <p className="chat-text">{parts}</p>;
}

function formatSize(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

function Attachment({ file }: { file: ChatAttachment }) {
  if (/^image\/(png|jpeg|gif|webp)$/.test(file.contentType)) {
    return <a className="chat-image" href={attachmentUrl(file.id)} target="_blank" rel="noopener noreferrer"><img src={attachmentUrl(file.id)} alt={file.filename} loading="lazy" /></a>;
  }
  return <a className="chat-file" href={attachmentUrl(file.id, true)} download={file.filename}><Icon name="file" size={16} /><span className="truncate">{file.filename}</span><small>{formatSize(file.size)}</small></a>;
}

function initials(name: string) {
  return name.split(/\s+/).filter(Boolean).slice(0, 2).map((part) => part[0]?.toUpperCase()).join("") || "?";
}

export default function ChatPage() {
  const { t } = useI18n();
  const { user, isAdmin } = useSession();
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [loading, setLoading] = useState(true);
  const [hasOlder, setHasOlder] = useState(true);
  const [error, setError] = useState("");
  const [filter, setFilter] = useState<Filter>("all");
  const [body, setBody] = useState("");
  const [tags, setTags] = useState<string[]>([]);
  const [customTag, setCustomTag] = useState("");
  const [files, setFiles] = useState<File[]>([]);
  const [sending, setSending] = useState(false);
  const listRef = useRef<HTMLDivElement>(null);
  const latestId = useRef(0);
  const stickToBottom = useRef(true);

  function merge(incoming: ChatMessage[]) {
    if (!incoming.length) return;
    setMessages((current) => {
      const byId = new Map(current.map((m) => [m.id, m]));
      for (const message of incoming) byId.set(message.id, message);
      return Array.from(byId.values()).sort((a, b) => a.id - b.id);
    });
    latestId.current = Math.max(latestId.current, ...incoming.map((m) => m.id));
    setLastSeen(latestId.current);
  }

  useEffect(() => {
    let active = true;
    listMessages()
      .then((list) => { if (!active) return; merge(list); setHasOlder(list.length >= 100); })
      .catch(() => { if (active) setError(t("common.databaseError")); })
      .finally(() => { if (active) setLoading(false); });
    const timer = window.setInterval(() => {
      if (document.hidden || !latestId.current) return;
      listMessages(latestId.current).then((list) => { if (active) merge(list); }).catch(() => {});
    }, POLL_MS);
    return () => { active = false; window.clearInterval(timer); };
  }, []);

  // Stay at the newest message unless the reader has scrolled up.
  useEffect(() => {
    const list = listRef.current;
    if (list && stickToBottom.current) list.scrollTop = list.scrollHeight;
  }, [messages]);

  const knownTags = useMemo(() => Array.from(new Set([...presetTags, ...messages.flatMap((m) => m.tags)])), [messages]);
  const visible = useMemo(() => messages.filter((m) => {
    if (filter === "all") return true;
    if (filter === "open-questions") return m.tags.includes("question") && !m.resolved;
    return m.tags.includes(filter);
  }), [messages, filter]);
  const openQuestions = messages.filter((m) => m.tags.includes("question") && !m.resolved).length;

  async function loadOlder() {
    const oldest = messages[0]?.id;
    if (!oldest) return;
    stickToBottom.current = false;
    try {
      const older = await listOlderMessages(oldest);
      setHasOlder(older.length >= 100);
      merge(older);
    } catch {
      setError(t("common.databaseError"));
    }
  }

  function addFiles(event: ChangeEvent<HTMLInputElement>) {
    const chosen = Array.from(event.target.files ?? []);
    event.target.value = "";
    const tooBig = chosen.find((file) => file.size > MAX_FILE_BYTES);
    if (tooBig) { setError(t("chat.fileTooLarge").replace("{name}", tooBig.name)); return; }
    setFiles((current) => [...current, ...chosen].slice(0, MAX_FILES));
  }

  function toggleTag(tag: string) {
    setTags((current) => (current.includes(tag) ? current.filter((x) => x !== tag) : [...current, tag]));
  }

  function addCustomTag() {
    const tag = customTag.trim().toLowerCase().replace(/^#/, "").replace(/[^a-z0-9-]/g, "-").replace(/^-+|-+$/g, "").slice(0, 30);
    if (tag && !tags.includes(tag)) setTags((current) => [...current, tag].slice(0, 6));
    setCustomTag("");
  }

  async function send() {
    if (sending || (!body.trim() && !files.length)) return;
    setSending(true); setError("");
    try {
      const uploaded = [];
      for (const file of files) uploaded.push(await uploadAttachment(file));
      const message = await sendMessage(body, tags, uploaded.map((file) => file.id));
      stickToBottom.current = true;
      merge([message]);
      setBody(""); setTags([]); setFiles([]);
    } catch (cause) {
      setError(cause instanceof Error && cause.message ? cause.message : t("common.saveError"));
    } finally {
      setSending(false);
    }
  }

  function onKey(event: KeyboardEvent<HTMLElement>) {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      void send();
    }
  }

  async function toggleResolved(message: ChatMessage) {
    try {
      await setResolved(message.id, !message.resolved);
      merge([{ ...message, resolved: !message.resolved }]);
    } catch { setError(t("common.saveError")); }
  }

  async function remove(message: ChatMessage) {
    if (!window.confirm(t("chat.deleteConfirm"))) return;
    try {
      await deleteMessage(message.id);
      setMessages((current) => current.filter((m) => m.id !== message.id));
    } catch { setError(t("common.saveError")); }
  }

  let lastDay = "";
  return (
    <div className="page chat-page">
      <header className="page-header">
        <div><h1>{t("chat.title")}</h1><p>{t("chat.subtitle")}</p></div>
      </header>
      {error && <div className="alert error" role="alert">{error}</div>}
      <section className="card chat-card">
        <div className="toolbar">
          <div className="chat-filters">
            <button type="button" className={`chip${filter === "all" ? " active" : ""}`} onClick={() => setFilter("all")}>{t("chat.filter.all")}</button>
            <button type="button" className={`chip${filter === "open-questions" ? " active" : ""}`} onClick={() => setFilter("open-questions")}>{t("chat.filter.openQuestions")}{openQuestions > 0 && <span className="chip-count">{openQuestions}</span>}</button>
            {knownTags.map((tag) => <button key={tag} type="button" className={`chip${filter === tag ? " active" : ""}`} onClick={() => setFilter(tag)}>#{tag}</button>)}
          </div>
        </div>
        <div className="chat-list" ref={listRef} onScroll={(e) => { const el = e.currentTarget; stickToBottom.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80; }}>
          {hasOlder && messages.length > 0 && filter === "all" && <div className="chat-older"><button type="button" className="btn btn-sm" onClick={() => void loadOlder()}>{t("chat.loadOlder")}</button></div>}
          {loading ? <div className="empty">{t("common.loading")}</div> : visible.length === 0 ? <div className="empty"><strong>{t("chat.empty")}</strong><span>{t("chat.emptyHint")}</span></div> : visible.map((message) => {
            const date = parseDbDate(message.created_at);
            const day = date.toLocaleDateString();
            const showDay = day !== lastDay;
            lastDay = day;
            const mine = message.user_id === user?.id;
            const isQuestion = message.tags.includes("question");
            return (
              <div key={message.id}>
                {showDay && <div className="chat-day"><span>{day}</span></div>}
                <article className={`chat-message${isQuestion && !message.resolved ? " question" : ""}`}>
                  <div className="chat-avatar" aria-hidden="true">{initials(message.author_name)}</div>
                  <div className="chat-content">
                    <div className="chat-meta">
                      <strong>{message.author_name}</strong>
                      <span className="muted">{date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</span>
                      {message.tags.map((tag) => <button key={tag} type="button" className={`badge ${tag === "urgent" ? "danger" : tag === "question" ? "warning" : "accent"}`} onClick={() => setFilter(tag)}>#{tag}</button>)}
                      {isQuestion && message.resolved && <span className="badge success"><Icon name="check" size={12} />{t("chat.resolved")}</span>}
                      <span className="chat-actions">
                        {isQuestion && <button type="button" className="btn btn-ghost btn-sm" onClick={() => void toggleResolved(message)}>{message.resolved ? t("chat.reopen") : t("chat.markResolved")}</button>}
                        {(mine || isAdmin) && <button type="button" className="btn btn-ghost btn-sm btn-icon" title={t("common.delete")} aria-label={t("common.delete")} onClick={() => void remove(message)}><Icon name="trash" size={14} /></button>}
                      </span>
                    </div>
                    {message.body && <MessageText text={message.body} />}
                    {message.attachments.length > 0 && <div className="chat-attachments">{message.attachments.map((file) => <Attachment key={file.id} file={file} />)}</div>}
                  </div>
                </article>
              </div>
            );
          })}
        </div>
        <div className="chat-composer">
          <div className="chat-tag-picker">
            {presetTags.map((tag) => <button key={tag} type="button" className={`chip${tags.includes(tag) ? " active" : ""}`} onClick={() => toggleTag(tag)}>#{tag}</button>)}
            {tags.filter((tag) => !presetTags.includes(tag)).map((tag) => <button key={tag} type="button" className="chip active" onClick={() => toggleTag(tag)}>#{tag} ×</button>)}
            <input className="chip-input" value={customTag} onChange={(e) => setCustomTag(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); addCustomTag(); } }} placeholder={t("chat.addTag")} aria-label={t("chat.addTag")} />
          </div>
          {files.length > 0 && (
            <div className="chat-pending">{files.map((file, index) => (
              <span key={`${file.name}-${index}`} className="chip active"><Icon name="file" size={13} />{file.name}<button type="button" aria-label={t("common.delete")} onClick={() => setFiles((current) => current.filter((_, i) => i !== index))}>×</button></span>
            ))}</div>
          )}
          <div className="chat-input-row">
            <label className="btn btn-icon file-button" title={t("chat.attach")} aria-label={t("chat.attach")}><Icon name="plus" size={18} /><input type="file" multiple onChange={addFiles} /></label>
            <textarea className="input" rows={2} value={body} onChange={(e) => setBody(e.target.value)} onKeyDown={onKey} placeholder={t("chat.placeholder")} aria-label={t("chat.placeholder")} />
            <button type="button" className="btn btn-primary" disabled={sending || (!body.trim() && !files.length)} onClick={() => void send()}>{sending ? t("chat.sending") : t("chat.send")}</button>
          </div>
          <small className="hint">{t("chat.hint")}</small>
        </div>
      </section>
    </div>
  );
}
