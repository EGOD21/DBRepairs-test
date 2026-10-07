import { useEffect, useState } from "react";
import Icon from "../components/Icon";
import Markdown from "../components/Markdown";
import { Article, ArticleInput, createArticle, deleteArticle, getArticle, listArticles, updateArticle } from "../data/comms";
import { formatDbDate } from "../data/dates";
import { fill } from "../lib/format";
import { useI18n } from "../i18n/I18nProvider";
import { href, navigate } from "../router";

/** Shop knowledge: fixes that worked, model quirks, setup steps, vendor contacts. */
export default function KnowledgePage({ id }: { id?: number }) {
  const { t } = useI18n();
  const [articles, setArticles] = useState<Article[]>([]);
  const [search, setSearch] = useState("");
  const [article, setArticle] = useState<Article | null>(null);
  const [editing, setEditing] = useState<ArticleInput | null>(null);
  const [error, setError] = useState("");

  useEffect(() => { const timer = window.setTimeout(() => { listArticles(search).then(setArticles).catch(() => setError(t("common.databaseError"))); }, 200); return () => window.clearTimeout(timer); }, [search]);
  useEffect(() => { setEditing(null); if (id) getArticle(id).then(setArticle).catch(() => setArticle(null)); else setArticle(null); }, [id]);

  async function save() {
    if (!editing) return;
    try {
      const saved = article ? await updateArticle(article.id, editing) : await createArticle(editing);
      setEditing(null); setArticle(saved);
      setArticles((list) => [saved, ...list.filter((a) => a.id !== saved.id)]);
      navigate({ name: "knowledge", id: saved.id });
    } catch (cause) { setError(cause instanceof Error ? cause.message : t("common.saveError")); }
  }
  async function remove() {
    if (!article || !window.confirm(fill(t("kb.deleteConfirm"), { title: article.title }))) return;
    await deleteArticle(article.id);
    setArticles((list) => list.filter((a) => a.id !== article.id));
    navigate({ name: "knowledge" });
  }

  return (
    <div className="page">
      <header className="page-header">
        <div><h1>{t("kb.title")}</h1><p>{t("kb.subtitle")}</p></div>
        <div className="page-actions"><button type="button" className="btn btn-primary" onClick={() => { setArticle(null); setEditing({ title: "", body: "", tags: "", device_type: "" }); }}><Icon name="plus" size={16} />{t("kb.add")}</button></div>
      </header>
      {error && <div className="alert error">{error}</div>}
      <div className="kb-layout">
        <section className="card kb-list">
          <div className="toolbar"><div className="search"><Icon name="search" size={16} /><input className="input" type="search" value={search} onChange={(e) => setSearch(e.target.value)} placeholder={t("kb.search")} /></div></div>
          {articles.length === 0 ? <div className="empty">{search ? t("kb.noResults") : t("kb.empty")}</div> : (
            <nav>{articles.map((a) => (
              <a key={a.id} href={href({ name: "knowledge", id: a.id })} className={article?.id === a.id ? "active" : ""}>
                <strong>{a.title}</strong><small className="muted">{[a.device_type, a.tags].filter(Boolean).join(" · ") || formatDbDate(a.updated_at)}</small>
              </a>
            ))}</nav>
          )}
        </section>
        <section className="card kb-article">
          {editing ? (
            <div className="card-body" style={{ display: "grid", gap: 14 }}>
              <label className="field"><span>{t("kb.articleTitle")}</span><input value={editing.title} onChange={(e) => setEditing({ ...editing, title: e.target.value })} placeholder={t("kb.titlePlaceholder")} /></label>
              <div className="form-grid">
                <label className="field"><span>{t("repair.deviceType")}</span><input value={editing.device_type} onChange={(e) => setEditing({ ...editing, device_type: e.target.value })} /></label>
                <label className="field"><span>{t("kb.tags")}</span><input value={editing.tags} onChange={(e) => setEditing({ ...editing, tags: e.target.value })} placeholder={t("kb.tagsPlaceholder")} /></label>
              </div>
              <label className="field"><span>{t("kb.body")}</span><textarea rows={16} className="mono" value={editing.body} onChange={(e) => setEditing({ ...editing, body: e.target.value })} placeholder={t("kb.bodyPlaceholder")} />
                <small>{t("kb.formatHint")}</small></label>
              <div className="page-actions" style={{ justifyContent: "flex-end" }}>
                <button type="button" className="btn" onClick={() => setEditing(null)}>{t("common.cancel")}</button>
                <button type="button" className="btn btn-primary" disabled={!editing.title.trim()} onClick={() => void save()}>{t("common.save")}</button>
              </div>
            </div>
          ) : article ? (
            <>
              <div className="card-header">
                <div><h2>{article.title}</h2><p>{[article.device_type, article.tags].filter(Boolean).join(" · ")}{article.updated_by_name ? ` · ${article.updated_by_name}, ${formatDbDate(article.updated_at)}` : ""}</p></div>
                <div className="card-actions">
                  <button type="button" className="btn btn-sm" onClick={() => setEditing({ title: article.title, body: article.body, tags: article.tags ?? "", device_type: article.device_type ?? "" })}><Icon name="pencil" size={14} />{t("common.edit")}</button>
                  <button type="button" className="btn btn-sm btn-icon btn-ghost" onClick={() => void remove()} aria-label={t("common.delete")}><Icon name="trash" size={14} /></button>
                </div>
              </div>
              <div className="card-body"><Markdown text={article.body} /></div>
            </>
          ) : <div className="empty"><Icon name="book" size={28} /><strong>{t("kb.pick")}</strong><span>{t("kb.pickHint")}</span></div>}
        </section>
      </div>
    </div>
  );
}
