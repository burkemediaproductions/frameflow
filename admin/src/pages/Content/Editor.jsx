import { useEffect, useMemo, useState, useCallback } from "react";
import { useNavigate, useParams, useSearchParams } from "react-router-dom";
import { api } from "../../lib/api";
import FieldInput from "../../components/FieldInput";

// Simple slug helper
function slugify(value) {
  return (value || "")
    .toString()
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function normalizeConfig(cfg) {
  if (!cfg) return {};
  if (typeof cfg === "object") return cfg;
  if (typeof cfg === "string") {
    try {
      return JSON.parse(cfg);
    } catch {
      return {};
    }
  }
  return {};
}

function getRoleFromToken() {
  try {
    const token =
      window.localStorage.getItem("token") ||
      window.localStorage.getItem("serviceup_token") ||
      window.localStorage.getItem("jwt") ||
      window.localStorage.getItem("authToken");

    if (!token) return null;

    const parts = String(token).split(".");
    if (parts.length < 2) return null;

    const b64 = parts[1].replace(/-/g, "+").replace(/_/g, "/");
    const json = decodeURIComponent(
      atob(b64)
        .split("")
        .map((c) => `%${("00" + c.charCodeAt(0).toString(16)).slice(-2)}`)
        .join("")
    );

    const payload = JSON.parse(json);
    return (
      payload?.role ||
      payload?.user?.role ||
      payload?.claims?.role ||
      payload?.app_metadata?.role ||
      null
    );
  } catch {
    return null;
  }
}

/**
 * Build a layout from the editor view config + content type fields.
 * If no config exists, falls back to a single section with all fields.
 *
 * Updated: gracefully handle legacy editor view configs that store field references
 * under `field` or `field_key` instead of `key`. Prefer `field_key` from API.
 */
function buildLayoutFromView(contentType, viewConfig) {
  if (!contentType) return [];

  // Build a lookup of custom fields by key. Do NOT include built-in fields
  const rawFields = Array.isArray(contentType.fields) ? contentType.fields : [];
  const fields = rawFields
    .map((f) => {
      if (!f) return null;
      const key = f.field_key || f.key;
      return key ? { ...f, key } : null;
    })
    .filter(Boolean);

  const fieldsByKey = {};
  fields.forEach((f) => {
    if (f && f.key) fieldsByKey[f.key] = f;
  });

  const sections = [];

  // IMPORTANT: distinguish between "no config provided" vs "config exists but empty"
  const cfgSections =
    viewConfig && Array.isArray(viewConfig.sections) ? viewConfig.sections : null;

  const hasAnyViewSectionsConfig = Array.isArray(cfgSections);

  if (cfgSections && cfgSections.length) {
    for (const sec of cfgSections) {
      const rows = [];

      let columns = 1;
      if (typeof sec.layout === "string") {
        if (sec.layout.includes("two")) columns = 2;
        if (sec.layout.includes("three")) columns = 3;
      }
      if (sec.columns && Number.isInteger(sec.columns)) {
        columns = sec.columns;
      }

      for (const fCfgRaw of sec.fields || []) {
        let key;
        let width = 1;
        let visible = true;

        if (typeof fCfgRaw === "string") key = fCfgRaw;
        else if (typeof fCfgRaw === "object" && fCfgRaw) {
          key = fCfgRaw.key || fCfgRaw.field_key || fCfgRaw.field || fCfgRaw.id;
          width = fCfgRaw.width || fCfgRaw.colSpan || width;
          if (typeof fCfgRaw.visible === "boolean") visible = fCfgRaw.visible;
        }

        if (!key || !visible) continue;

        // built-ins come through as strings too, so allow them through
        const def = fieldsByKey[key] || { key, type: "builtin" };

        rows.push({ def, width });
      }

      if (rows.length) {
        sections.push({
          id: sec.id || "section",
          title: sec.title || "Section",
          columns,
          rows,
        });
      }
    }
  }

  // Fallback ONLY when there is NO view config at all.
  // If a view exists but contains only built-ins (or invalid keys),
  // we should NOT fall back to "all fields" because that looks like the wrong view loaded.
  if (!sections.length && fields.length && !hasAnyViewSectionsConfig) {
    sections.push({
      id: "main",
      title: "Fields",
      columns: 1,
      rows: fields.map((def) => ({ def, width: 1 })),
    });
  }

  return sections;
}


// ✅ helper: normalize field config across legacy config/options shapes
function getFieldConfig(def) {
  return (
    (def?.config && typeof def.config === "object" ? def.config : null) ||
    (def?.options && typeof def.options === "object" ? def.options : null) ||
    {}
  );
}

// ✅ helper: read relationship target slug across common shapes
function getRelationshipTargetSlug(field) {
  const cfg =
    (field?.config && typeof field.config === "object" ? field.config : null) ||
    (field?.options && typeof field.options === "object" ? field.options : null) ||
    {};

  const v =
    cfg?.relation?.contentType ||
    cfg?.relation?.slug ||
    cfg?.relatedType ||
    cfg?.contentType ||
    cfg?.targetType ||
    cfg?.target ||
    field?.relatedType ||
    field?.contentType ||
    null;

  if (v && typeof v === "object") {
    return v.slug || v.contentType || v.relatedType || null;
  }

  return v ? String(v) : null;
}

// ✅ helper: detect dynamic choice source slug
function getDynamicChoiceSourceSlug(def) {
  const cfg = getFieldConfig(def);
  const sourceType = cfg?.sourceType || cfg?.source_type || null;
  const optionsSource = cfg?.optionsSource || cfg?.options_source || null;

  if (sourceType) return String(sourceType);
  if (optionsSource === "dynamic" && cfg?.source) return String(cfg.source);
  return null;
}

// ----------------------------
// ✅ Derived title helpers
// ----------------------------
function getByPath(obj, path) {
  if (!path) return undefined;
  const parts = String(path)
    .split(".")
    .map((s) => s.trim())
    .filter(Boolean);

  let cur = obj;
  for (const p of parts) {
    if (cur == null) return undefined;
    cur = cur[p];
  }
  return cur;
}

function asPrettyInline(value) {
  if (value == null) return "";
  if (
    typeof value === "string" ||
    typeof value === "number" ||
    typeof value === "boolean"
  )
    return String(value);

  // name field object common shape
  if (typeof value === "object" && !Array.isArray(value)) {
    const first = value.first || "";
    const last = value.last || "";
    const middle = value.middle || "";
    const title = value.title || "";
    const suffix = value.suffix || "";

    const looksLikeName =
      "first" in value ||
      "last" in value ||
      "middle" in value ||
      "title" in value ||
      "suffix" in value;

    if (looksLikeName) {
      const bits = [];
      if (title) bits.push(String(title));
      if (first) bits.push(String(first));
      if (middle) bits.push(String(middle));
      if (last) bits.push(String(last));
      let out = bits.join(" ").trim();
      if (suffix) out = `${out} ${suffix}`.trim();
      return out;
    }

    // fallback
    try {
      return JSON.stringify(value);
    } catch {
      return String(value);
    }
  }

  if (Array.isArray(value)) {
    return value.map(asPrettyInline).filter(Boolean).join(", ");
  }

  return String(value);
}

function deriveTitleFromTemplate(template, data) {
  const tpl = String(template || "");
  if (!tpl.trim()) return "";

  // replace {path.to.field} tokens
  const out = tpl.replace(/\{([^}]+)\}/g, (_, tokenRaw) => {
    const token = String(tokenRaw || "").trim();
    if (!token) return "";
    const val = getByPath(data, token);
    return asPrettyInline(val);
  });

  return out.replace(/\s+/g, " ").trim();
}

export default function Editor() {
  const { typeSlug, entryId } = useParams();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();

  // ✅ only depend on the string value, not the searchParams object
  const viewParam = searchParams.get("view") || "";
  const setViewParamInUrl = useCallback(
    (nextView) => {
      const next = new URLSearchParams(searchParams);
      if (nextView) next.set("view", nextView);
      else next.delete("view");
      setSearchParams(next, { replace: true });
    },
    [searchParams, setSearchParams]
  );



  const roleUpper = useMemo(() => {
    const r = getRoleFromToken();
    return String(r || "ADMIN").toUpperCase();
  }, []);

  const isNew = !entryId || entryId === "new";

  const [loadingEntry, setLoadingEntry] = useState(!isNew);
  const [loadingType, setLoadingType] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [saveMessage, setSaveMessage] = useState("");

  // Core entry fields
  const [title, setTitle] = useState("");
  const [slug, setSlug] = useState("");
  const [status, setStatus] = useState("draft");

  // Structured custom data from entries.data
  const [data, setData] = useState({});

  // Caches used by FieldInput for relation fields and dynamic choice sources
  const [relatedCache, setRelatedCache] = useState({});
  const [choicesCache, setChoicesCache] = useState({});

  // ✅ resolved payload from API (Option B)
  const [resolved, setResolved] = useState(null);

  // Content type + editor view
  const [contentType, setContentType] = useState(null);
  const [editorViewConfig, setEditorViewConfig] = useState(null);
  const [editorViews, setEditorViews] = useState([]);
  const [activeViewSlug, setActiveViewSlug] = useState("");
  const [activeViewLabel, setActiveViewLabel] = useState("");

  const overallLoading = loadingEntry || loadingType;

  // ✅ core config (from EntryViews builder)
  const coreCfg = useMemo(() => {
    const c =
      editorViewConfig?.core && typeof editorViewConfig.core === "object"
        ? editorViewConfig.core
        : {};
    return {
      titleLabel: c.titleLabel || "Title",
      slugLabel: c.slugLabel || "Slug",
      statusLabel: c.statusLabel || "Status",
      titleMode: c.titleMode || "manual",
      titleTemplate: c.titleTemplate || "",
      hideTitle: !!c.hideTitle,
      hideSlug: !!c.hideSlug,
      hideStatus: !!c.hideStatus,
      hidePreview: !!c.hidePreview,
      autoSlugFromTitleIfEmpty: c.autoSlugFromTitleIfEmpty !== false,
    };
  }, [editorViewConfig]);

  // ---------------------------------------------------------------------------
  // Load content type (with fields) + editor views for the current role
  // ---------------------------------------------------------------------------
  useEffect(() => {
    let cancelled = false;

    async function loadTypeAndView() {
      setLoadingType(true);
      setError("");

      try {
        const res = await api.get("/api/content-types");
        const list = Array.isArray(res) ? res : res?.data || [];

        const basicCt =
          list.find(
            (t) =>
              t.slug === typeSlug ||
              t.slug?.toLowerCase() === typeSlug?.toLowerCase()
          ) || null;

        if (!basicCt) {
          if (!cancelled) setError(`Content type "${typeSlug}" not found.`);
          return;
        }
        if (cancelled) return;

        let fullCt;
        try {
          const fullRes = await api.get(
            `/api/content-types/${basicCt.id}?all=true`
          );
          fullCt = fullRes?.data || fullRes || basicCt;
        } catch (e) {
          console.warn(
            "Failed to load full content type, falling back to basic",
            e
          );
          fullCt = basicCt;
        }

        if (cancelled) return;
        setContentType(fullCt);

        // editor views
        let views = [];
        if (fullCt && fullCt.id) {
          try {
            const vRes = await api.get(
              `/api/content-types/${
                fullCt.id
              }/editor-views?role=${encodeURIComponent(roleUpper)}&_=${Date.now()}`
            );
            const rawViews = vRes?.data ?? vRes;
            if (Array.isArray(rawViews)) views = rawViews;
            else if (rawViews && Array.isArray(rawViews.views))
              views = rawViews.views;
          } catch (err) {
            console.warn(
              "[Editor] Failed to load editor views for type; falling back to auto layout",
              err?.response?.data || err
            );
          }
        }

        if (!cancelled) setEditorViews(views || []);

        // choose view
        let chosenView = null;
        if (views && views.length) {
          const defaultView =
            views.find((v) => {
              const cfg = normalizeConfig(v.config || {});
              const dRoles = Array.isArray(cfg.default_roles)
                ? cfg.default_roles.map((r) => String(r || "").toUpperCase())
                : [];
              if (dRoles.length) return dRoles.includes(roleUpper);
              return !!v.is_default;
            }) || views[0];

          if (viewParam) {
            const fromUrl = views.find((v) => v.slug === viewParam);
            chosenView = fromUrl || defaultView;
          } else {
            chosenView = defaultView;
          }
        }

        if (chosenView) {
          if (!cancelled) {
            setActiveViewSlug(chosenView.slug);
            setActiveViewLabel(
              chosenView.label ||
                chosenView.name ||
                chosenView.title ||
                chosenView.slug
            );
            setEditorViewConfig(normalizeConfig(chosenView.config));
          }

          // ✅ keep URL in sync, but only when needed
          if (viewParam !== chosenView.slug) {
           setViewParamInUrl(chosenView.slug);
         }
        } else {
          if (!cancelled) {
            setActiveViewSlug("");
            setActiveViewLabel("");
            setEditorViewConfig({});
          }
          if (viewParam) {
            setViewParamInUrl("");
          }
        }
      } catch (err) {
        console.error("Failed to load content types", err);
        if (!cancelled)
          setError(err.message || "Failed to load content type");
      } finally {
        if (!cancelled) setLoadingType(false);
      }
    }

    loadTypeAndView();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [typeSlug, roleUpper, viewParam]);

  const sections = useMemo(
    () => buildLayoutFromView(contentType, editorViewConfig),
    [contentType, editorViewConfig]
  );

  // ---------------------------------------------------------------------------
  // ✅ Build caches for relationship fields + dynamic choice sources
  // ---------------------------------------------------------------------------
  useEffect(() => {
    let cancelled = false;

    async function loadCaches() {
      const fields = Array.isArray(contentType?.fields) ? contentType.fields : [];
      if (!fields.length) {
        setRelatedCache({});
        setChoicesCache({});
        return;
      }

      const relSlugs = new Set();
      const choiceSlugs = new Set();

      for (const f of fields) {
        const type = String(f?.type || "").toLowerCase();

        if (type === "relation" || type === "relationship") {
          const slug = getRelationshipTargetSlug(f);
          if (slug) relSlugs.add(slug);
        }

        const isChoice = ["radio", "dropdown", "checkbox", "select", "multiselect"].includes(type);
        if (isChoice) {
          const cfg = getFieldConfig(f);
          const sourceType = cfg?.sourceType || cfg?.source_type;
          const optionsSource = cfg?.optionsSource || cfg?.options_source;

          if (sourceType || optionsSource === "dynamic") {
            const sourceSlug = getDynamicChoiceSourceSlug(f);
            if (sourceSlug) choiceSlugs.add(String(sourceSlug));
          }
        }
      }

      async function fetchList(slug) {
        const res = await api.get(`/api/content/${encodeURIComponent(slug)}?limit=200`);
        const data = res?.data ?? res;

        const list =
          data?.entries ||
          data?.items ||
          (Array.isArray(data) ? data : null) ||
          [];

        return Array.isArray(list) ? list : [];
      }

      const nextRelated = {};
      for (const slug of relSlugs) {
        try {
          if (cancelled) return;
          nextRelated[slug] = await fetchList(slug);
        } catch {
          nextRelated[slug] = [];
        }
      }

      const nextChoices = {};
      for (const slug of choiceSlugs) {
        try {
          if (cancelled) return;
          nextChoices[slug] = await fetchList(slug);
        } catch {
          nextChoices[slug] = [];
        }
      }

      if (!cancelled) {
        setRelatedCache(nextRelated);
        setChoicesCache(nextChoices);
      }
    }

    loadCaches();

    return () => {
      cancelled = true;
    };
    // ✅ avoid refetch loops from array identity churn
  }, [contentType?.id]);

  // ---------------------------------------------------------------------------
  // Load existing entry (edit mode only)
  // ---------------------------------------------------------------------------
  useEffect(() => {
    if (isNew) {
      setTitle("");
      setSlug("");
      setStatus("draft");
      setData({});
      setResolved(null);
      setLoadingEntry(false);
      return;
    }

    let cancelled = false;

    async function load() {
      setLoadingEntry(true);
      setError("");
      setSaveMessage("");
      try {
        const res = await api.get(`/api/content/${typeSlug}/${entryId}`);
        if (res && res.ok === false) {
          throw new Error(res.error || res.detail || "Failed to load entry");
        }
        const entry = res.entry || res.data || res;
        if (cancelled) return;

        setResolved(entry?._resolved || null);

        const rawData =
          entry && typeof entry.data === "object" && entry.data !== null ? entry.data : {};
        let entryData = rawData && typeof rawData === "object" ? { ...rawData } : {};

        const SYSTEM_KEYS = new Set([
          "id",
          "content_type_id",
          "data",
          "created_at",
          "updated_at",
          "title",
          "slug",
          "status",
          "_title",
          "_slug",
          "_status",
          "version",
          "version_of",
          "published_at",
          "_resolved",
        ]);

        Object.entries(entry || {}).forEach(([k, v]) => {
          if (SYSTEM_KEYS.has(k)) return;
          if (entryData[k] === undefined) entryData[k] = v;
        });

        while (
          entryData &&
          typeof entryData === "object" &&
          entryData.undefined &&
          typeof entryData.undefined === "object"
        ) {
          entryData = { ...entryData, ...entryData.undefined };
          delete entryData.undefined;
        }

        const loadedTitle = entry.title ?? entryData.title ?? entryData._title ?? "";
        const loadedSlug = entry.slug ?? entryData.slug ?? entryData._slug ?? "";
        const loadedStatus = entry.status ?? entryData.status ?? entryData._status ?? "draft";

        setTitle(loadedTitle);
        setSlug(loadedSlug);
        setStatus(loadedStatus);
        setData(entryData || {});
      } catch (err) {
        console.error("Failed to load entry", err);
        if (!cancelled) setError(err.message || "Failed to load entry");
      } finally {
        if (!cancelled) setLoadingEntry(false);
      }
    }

    load();
    return () => {
      cancelled = true;
    };
  }, [isNew, typeSlug, entryId]);

  // ---------------------------------------------------------------------------
  // ✅ Derive Title live from template (if enabled in view)
  // ---------------------------------------------------------------------------
  useEffect(() => {
    if (!coreCfg) return;
    if ((coreCfg.titleMode || "manual") !== "template") return;

    const derived = deriveTitleFromTemplate(coreCfg.titleTemplate || "", data || {});
    if (!derived) return;

    setTitle(derived);

    if (coreCfg.autoSlugFromTitleIfEmpty && !String(slug || "").trim()) {
      setSlug(slugify(derived));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [coreCfg.titleMode, coreCfg.titleTemplate, data]);

  // ---------------------------------------------------------------------------
  // Save / Delete
  // ---------------------------------------------------------------------------
  async function handleSave(e) {
    e.preventDefault();
    setError("");
    setSaveMessage("");

    const computedTitle =
      (coreCfg.titleMode === "template"
        ? deriveTitleFromTemplate(coreCfg.titleTemplate || "", data || {})
        : title) || "";

    if (!computedTitle.trim()) {
      setError("Title is required.");
      return;
    }

    // ✅ always slugify user-provided slug, or derive from title
    const finalSlug = slugify((slug || "").trim() || computedTitle);

    try {
      setSaving(true);

      const sanitized = {};
      if (data && typeof data === "object") {
        Object.entries(data).forEach(([k, v]) => {
          if (!k || k === "undefined") return;
          sanitized[k] = v;
        });
      }

      const mergedData = {
        ...sanitized,
        title: computedTitle.trim(),
        slug: finalSlug,
        status,
        _title: computedTitle.trim(),
        _slug: finalSlug,
        _status: status,
      };

      const payload = {
        title: computedTitle.trim(),
        slug: finalSlug,
        status,
        data: mergedData,
      };

      if (isNew) {
        const res = await api.post(`/api/content/${typeSlug}`, payload);
        if (res && res.ok === false) {
          throw new Error(res.error || res.detail || "Failed to create entry");
        }

        const created = res.entry || res.data || res;
        setResolved(created?._resolved || null);

        const newId = created?.id ?? created?.entry?.id ?? created?.data?.id ?? null;
        const newSlug =
          created?.slug ?? created?.entry?.slug ?? created?.data?.slug ?? finalSlug;

        if (newId) {
          navigate(`/admin/content/${typeSlug}/${newSlug || newId}`, { replace: true });
          setSaveMessage("Entry created.");
        } else {
          setSaveMessage("Entry created (reload list to see it).");
        }
      } else {
        const res = await api.put(`/api/content/${typeSlug}/${entryId}`, payload);
        if (res && res.ok === false) {
          throw new Error(res.error || res.detail || "Failed to save entry");
        }

        const updated = res.entry || res.data || res;
        setResolved(updated?._resolved || null);

        if (updated) {
          const entryData = updated.data || mergedData;

          const loadedTitle =
            updated.title ?? entryData.title ?? entryData._title ?? computedTitle;
          const loadedSlug = updated.slug ?? entryData.slug ?? entryData._slug ?? finalSlug;
          const loadedStatus =
            updated.status ?? entryData.status ?? entryData._status ?? status;

          setTitle(loadedTitle);
          setSlug(loadedSlug);
          setStatus(loadedStatus);
          setData(entryData);

          if (loadedSlug && loadedSlug !== entryId) {
            navigate(`/admin/content/${typeSlug}/${loadedSlug}`, { replace: true });
          }
        }

        setSaveMessage("Entry saved.");
      }
    } catch (err) {
      console.error("Failed to save entry", err);
      setError(err.message || "Failed to save entry");
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete() {
    if (isNew) {
      navigate(`/admin/content/${typeSlug}`);
      return;
    }

    if (!window.confirm("Delete this entry? This cannot be undone.")) return;

    try {
      setSaving(true);
      setSaveMessage("");
      // NOTE: api wrappers typically use `.delete`, not `.del`
      const res = await api.delete(`/api/content/${typeSlug}/${entryId}`);
      if (res && res.ok === false) {
        throw new Error(res.error || res.detail || "Failed to delete entry");
      }
      navigate(`/admin/content/${typeSlug}`);
    } catch (err) {
      console.error("Failed to delete entry", err);
      setError(err.message || "Failed to delete entry");
    } finally {
      setSaving(false);
    }
  }

  // ---------------------------------------------------------------------------
  // Preview helpers
  // ---------------------------------------------------------------------------
  const previewData = useMemo(
    () => ({ ...data, title, slug, status }),
    [data, title, slug, status]
  );

  const fieldDefByKey = useMemo(() => {
    const map = {};
    const f = Array.isArray(contentType?.fields) ? contentType.fields : [];
    for (const def of f) {
      const key = def?.field_key || def?.key;
      if (key) map[key] = { ...def, key };
    }
    return map;
  }, [contentType]);

  // ✅ hide system-ish keys from the preview list
  const customFieldEntries = useMemo(() => {
    const SYSTEM = new Set(["title", "slug", "status", "_title", "_slug", "_status"]);
    return Object.entries(data || {}).filter(([k]) => !SYSTEM.has(k));
  }, [data]);

  function userLabelFromResolved(user, display) {
    if (!user) return "";
    const name = user.name || "";
    const email = user.email || "";
    if (display === "email") return email || name || "";
    if (display === "name") return name || email || "";
    return name && email ? `${name} — ${email}` : name || email || "";
  }

  function prettyValue(v) {
    if (v === null || v === undefined) return "";
    if (typeof v === "string" || typeof v === "number" || typeof v === "boolean")
      return String(v);
    if (Array.isArray(v)) {
      if (!v.length) return "";
      if (v.every((x) => typeof x === "string" || typeof x === "number"))
        return v.join(", ");
      return JSON.stringify(v);
    }
    if (typeof v === "object") {
      if (v.label && (typeof v.value === "string" || typeof v.value === "number")) {
        return `${v.label} (${v.value})`;
      }
      if (v.label && !v.value) return String(v.label);
      return JSON.stringify(v);
    }
    return String(v);
  }

  function prettyValueForField(key, v) {
    const def = fieldDefByKey[key];
    const type = String(def?.type || "").toLowerCase();

    if (type === "relation_user") {
      const userFields = resolved?.userFields || {};
      const usersById = resolved?.usersById || {};
      const cfg = userFields[key] || def?.config || {};
      const display = cfg?.display || "name_email";

      if (Array.isArray(v)) {
        return v
          .map((id) => userLabelFromResolved(usersById[id], display) || String(id))
          .filter(Boolean)
          .join(", ");
      }

      if (typeof v === "string") {
        return userLabelFromResolved(usersById[v], display) || v;
      }
      return "";
    }

    return prettyValue(v);
  }

  // ---------------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------------
  return (
    <div className="su-grid cols-2">
      {/* LEFT: Editor card */}
      <div className="su-card">
        <h2 style={{ marginTop: 0, marginBottom: 12 }}>
          {overallLoading ? "Edit entry" : isNew ? `New ${typeSlug} entry` : `Edit ${typeSlug}`}
        </h2>

        {editorViews.length > 0 && (
          <div className="su-card su-mb-md">
            <div className="su-card-body su-flex su-flex-wrap su-gap-sm su-items-center">
              <span className="su-text-sm su-text-muted">Views:</span>
              {editorViews.map((v) => {
                const cfg = normalizeConfig(v.config || {});
                const dRoles = Array.isArray(cfg.default_roles)
                  ? cfg.default_roles.map((r) => String(r || "").toUpperCase())
                  : [];
                const isDefaultForRole = dRoles.length ? dRoles.includes(roleUpper) : !!v.is_default;

                return (
                  <button
                    key={v.slug}
                    type="button"
                    className={"su-chip" + (v.slug === activeViewSlug ? " su-chip--active" : "")}
                    onClick={() => {
                      if (v.slug === activeViewSlug) return;
                      // ✅ drive selection via URL param; loader effect will apply config
                      setViewParamInUrl(v.slug);
                    }}
                  >
                    {v.label || v.name || v.title || v.slug}
                    {isDefaultForRole && <span className="su-chip-badge">default</span>}
                  </button>
                );
              })}
            </div>
          </div>
        )}

        {error && (
          <div
            style={{
              marginBottom: 12,
              padding: "8px 10px",
              borderRadius: 10,
              border: "1px solid #fecaca",
              background: "#fef2f2",
              color: "#991b1b",
              fontSize: 13,
            }}
          >
            {error}
          </div>
        )}

        {saveMessage && !error && (
          <div
            style={{
              marginBottom: 12,
              padding: "8px 10px",
              borderRadius: 10,
              border: "1px solid #bbf7d0",
              background: "#ecfdf3",
              color: "#166534",
              fontSize: 13,
            }}
          >
            {saveMessage}
          </div>
        )}

        {overallLoading && !isNew && <p style={{ fontSize: 13, opacity: 0.7 }}>Loading entry…</p>}

        <form onSubmit={handleSave}>
          {/* Core fields */}
          <div style={{ display: "grid", gap: 12, marginBottom: 20 }}>
            {!coreCfg.hideTitle && (
              <label style={{ fontSize: 13 }}>
                {coreCfg.titleLabel || "Title"}
                <input
                  className="su-input"
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  placeholder="My great entry"
                  disabled={coreCfg.titleMode === "template"}
                />
              </label>
            )}

            {!coreCfg.hideSlug && (
              <label style={{ fontSize: 13 }}>
                {coreCfg.slugLabel || "Slug"}
                <input
                  className="su-input"
                  value={slug}
                  // ✅ keep slugs clean as the user types
                  onChange={(e) => setSlug(slugify(e.target.value))}
                  placeholder={slugify(title || "my-entry")}
                />
              </label>
            )}

            {!coreCfg.hideStatus && (
              <label style={{ fontSize: 13 }}>
                {coreCfg.statusLabel || "Status"}
                <select
                  className="su-select"
                  value={status}
                  onChange={(e) => setStatus(e.target.value)}
                >
                  <option value="draft">Draft</option>
                  <option value="published">Published</option>
                  <option value="archived">Archived</option>
                </select>
              </label>
            )}
          </div>

          {/* Structured fields */}
          <div style={{ marginBottom: 16 }}>
            <div
              style={{
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
                marginBottom: 8,
              }}
            >
              <h3 style={{ margin: 0, fontSize: 14 }}>Fields</h3>
              <span style={{ fontSize: 11, opacity: 0.7 }}>
                Powered by QuickBuilder &amp; editor views.
              </span>
            </div>

            {!sections.length && (
              <p style={{ fontSize: 12, opacity: 0.7 }}>
                No fields defined for this content type yet. Create fields in QuickBuilder.
              </p>
            )}

            {sections.map((section) => (
              <div
                key={section.id}
                style={{
                  border: "1px solid var(--su-border)",
                  borderRadius: 10,
                  padding: 12,
                  marginBottom: 12,
                  background: "var(--su-surface)",
                }}
              >
                {section.title && (
                  <div style={{ marginBottom: 8, fontSize: 13, fontWeight: 600 }}>
                    {section.title}
                  </div>
                )}

                <div
                  style={{
                    display: "grid",
                    gap: 12,
                    gridTemplateColumns: `repeat(${section.columns || 1}, minmax(0, 1fr))`,
                  }}
                >
                  {section.rows.map(({ def, width }) => {
                    const key = def && def.key;
                    if (!key) return null;
                    const value = data ? data[key] : undefined;

                    return (
                      <div key={key} style={{ gridColumn: `span ${width || 1}` }}>
                        <div style={{ display: "grid", gap: 6 }}>
                          <label style={{ fontSize: 13, fontWeight: 600 }}>
                            {def.label || def.name || def.key}
                          </label>

                          <FieldInput
                            field={def}
                            value={value}
                            onChange={(val) => {
                              if (!key) return;
                              setData((prev) => ({ ...(prev || {}), [key]: val }));
                            }}
                            relatedCache={relatedCache}
                            choicesCache={choicesCache}
                            resolved={resolved}
                            entryContext={{ typeSlug, entryId }}
                          />

                          {(def.help || def.description) && (
                            <div style={{ fontSize: 12, opacity: 0.7 }}>
                              {def.help || def.description}
                            </div>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>

          {/* Actions */}
          <div style={{ display: "flex", gap: 8, marginTop: 12 }}>
            <button className="su-btn primary" type="submit" disabled={saving}>
              {saving ? "Saving…" : isNew ? "Create entry" : "Save entry"}
            </button>
            <button className="su-btn" type="button" onClick={() => navigate(-1)} disabled={saving}>
              Back
            </button>
            <button
              className="su-btn"
              type="button"
              onClick={handleDelete}
              disabled={saving}
              style={{
                borderColor: "#fecaca",
                background: "#fef2f2",
                color: "#b91c1c",
              }}
            >
              {isNew ? "Cancel" : "Delete"}
            </button>
          </div>
        </form>
      </div>

      {/* RIGHT: Preview card (can be hidden by view config) */}
      {!coreCfg.hidePreview && (
        <div className="su-card">
          <h2 style={{ marginTop: 0, marginBottom: 12 }}>Preview</h2>

          <div
            style={{
              borderRadius: 10,
              border: "1px solid var(--su-border)",
              padding: 12,
              marginBottom: 16,
            }}
          >
            <div style={{ marginBottom: 8 }}>
              <div style={{ fontSize: 16, fontWeight: 600 }}>
                {title || "(untitled entry)"}
              </div>
              <div style={{ fontSize: 12, opacity: 0.7 }}>
                /{slug || slugify(title || "my-entry")} ·{" "}
                <span style={{ textTransform: "uppercase" }}>{status}</span>
              </div>
            </div>

            <div style={{ borderTop: "1px solid var(--su-border)", paddingTop: 8 }}>
              {customFieldEntries.length === 0 && (
                <p style={{ fontSize: 12, opacity: 0.7 }}>No fields yet.</p>
              )}

              {customFieldEntries.map(([k, v]) => (
                <div
                  key={k}
                  style={{
                    display: "grid",
                    gridTemplateColumns: "120px minmax(0,1fr)",
                    gap: 8,
                    padding: "4px 0",
                    fontSize: 13,
                  }}
                >
                  <div style={{ opacity: 0.7 }}>{k}</div>
                  <div>{prettyValueForField(k, v)}</div>
                </div>
              ))}
            </div>
          </div>

          <h3 style={{ marginTop: 0, marginBottom: 8, fontSize: 14 }}>
            Raw JSON (<code>entries.data</code>)
          </h3>
          <pre
            style={{
              fontSize: 11,
              background: "#0b1120",
              color: "#d1fae5",
              borderRadius: 10,
              padding: 10,
              maxHeight: 480,
              overflow: "auto",
              fontFamily:
                'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace',
            }}
          >
            {JSON.stringify(previewData, null, 2)}
          </pre>
        </div>
      )}
    </div>
  );
}
