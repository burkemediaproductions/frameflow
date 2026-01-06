import React, { useEffect, useMemo, useState } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { api } from "../../lib/api";

/*
 * EntryViews (Widget Builder)
 *
 * Each editor view stores:
 *  - slug
 *  - label
 *  - config.roles
 *  - config.default_roles
 *  - config.core: { titleLabel, titleMode, titleTemplate, hideTitle, hideSlug, hideStatus, hidePreview, autoSlugFromTitleIfEmpty }
 *  - config.sections: array of widgets { id, title, description, layout, fields }
 *
 * NOTE:
 * Some older views store section fields as objects like:
 *   { field_key: "my_field" } or { field: "my_field" }
 * The builder MUST normalize those, otherwise it appears empty even though the editor renders fine.
 */

// Simple slugify helper for view slugs
function slugify(str) {
  return (str || "")
    .toString()
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

// Built-in fields (allowed in widgets too)
const BUILTIN_FIELDS = [
  { key: "title", label: "Title" },
  { key: "slug", label: "Slug" },
  { key: "status", label: "Status" },
  { key: "created_at", label: "Created" },
  { key: "updated_at", label: "Updated" },
];

const EMPTY_CORE = {
  titleLabel: "Title",
  slugLabel: "Slug",
  statusLabel: "Status",

  // manual | template
  titleMode: "manual",
  titleTemplate: "",

  // hide core fields/panels in THIS VIEW (role-based because views are role-based)
  hideTitle: false,
  hideSlug: false,
  hideStatus: false,
  hidePreview: false,

  // if true, and slug is empty, Editor can auto-fill slug from derived/manual title
  autoSlugFromTitleIfEmpty: true,
};

// ✅ Normalize "field key" from legacy shapes
function normalizeFieldKey(f) {
  if (!f) return "";
  if (typeof f === "string") return f;
  if (typeof f === "object") {
    return (
      f.key ||
      f.field_key ||
      f.field ||
      f.id || // last-resort, but usually not what you want
      ""
    );
  }
  return "";
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

function getRawSectionsFromView(view) {
  const cfg = normalizeConfig(view?.config);

  return (
    (Array.isArray(cfg?.sections) && cfg.sections) ||
    (Array.isArray(cfg?.widgets) && cfg.widgets) ||
    (Array.isArray(view?.sections) && view.sections) ||
    (Array.isArray(view?.widgets) && view.widgets) ||
    (Array.isArray(cfg?.layout?.sections) && cfg.layout.sections) ||
    []
  );
}

function normalizeSections(rawSections) {
  return (rawSections || []).map((s, idx) => ({
    id: s.id || `widget-${idx + 1}`,
    title: s.title || `Widget ${idx + 1}`,
    description: s.description || "",
    layout: s.layout || "one-column",
    fields: Array.isArray(s.fields)
      ? s.fields
          .map(normalizeFieldKey)
          .map((k) => String(k || "").trim())
          .filter(Boolean)
      : [],
  }));
}

function pickBestViewBySlug(views, slug) {
  const target = String(slug || "").toLowerCase();
  const matches = (views || []).filter(
    (v) => String(v?.slug || "").toLowerCase() === target
  );

  if (!matches.length) return null;

  // Prefer the one that actually contains sections
  const withSections =
    matches.find((v) => getRawSectionsFromView(v).length > 0) || matches[0];

  return withSections;
}


export default function EntryViews() {
  const params = useParams();
  const navigate = useNavigate();

  // stages: selecting content type, selecting a view, editing a view
  const [stage, setStage] = useState("types"); // 'types' | 'views' | 'edit'

  // All content types
  const [contentTypes, setContentTypes] = useState([]);
  // Selected content type key from URL (slug or id)
  const [selectedTypeId, setSelectedTypeId] = useState("");
  const [contentTypeDetail, setContentTypeDetail] = useState(null);

  // ✅ Store canonical UUID once loaded (fixes installs that require UUID for PUT/DELETE)
  const [selectedTypeUuid, setSelectedTypeUuid] = useState("");

  // All editor views for the selected type
  const [views, setViews] = useState([]);
  // Current view slug being edited
  const [activeViewSlug, setActiveViewSlug] = useState("");

  // Form state for editing/creating a view
  const [currentLabel, setCurrentLabel] = useState("");
  const [slugManuallyEdited, setSlugManuallyEdited] = useState(false);

  const [assignedRoles, setAssignedRoles] = useState([]);
  const [defaultRoles, setDefaultRoles] = useState([]);
  const [adminOnly, setAdminOnly] = useState(false);

  // Core config
  const [core, setCore] = useState(EMPTY_CORE);

  // widgets
  const [sections, setSections] = useState([]);
  const [selectedSectionIndex, setSelectedSectionIndex] = useState(0);

  // Available roles (loaded from /api/roles)
  const [allRoles, setAllRoles] = useState(["ADMIN"]);

  // Available fields for this content type (built-ins + custom)
  const [availableFields, setAvailableFields] = useState([]);

  // UI state
  const [loading, setLoading] = useState(false);
  const [loadingTypes, setLoadingTypes] = useState(true);
  const [error, setError] = useState("");
  const [saveMessage, setSaveMessage] = useState("");
  const [dirty, setDirty] = useState(false);

  // ---------------------------------------------------------------------------
  // Sync stage + selection from URL params
  // ---------------------------------------------------------------------------
  useEffect(() => {
    const typeSlug = params.typeSlug || params.typeId;
    const viewSlug = params.viewSlug || "";

    // No type selected: fully reset
    if (!typeSlug) {
      setStage("types");
      setSelectedTypeId("");
      setSelectedTypeUuid("");
      setActiveViewSlug("");
      setSlugManuallyEdited(false);
      setCurrentLabel("");
      setSections([]);
      setSelectedSectionIndex(0);
      setAssignedRoles([]);
      setDefaultRoles([]);
      setAdminOnly(false);
      setCore(EMPTY_CORE);
      setDirty(false);
      return;
    }

    setSelectedTypeId(typeSlug);

    // No specific view selected: we're on the "views list" stage
    if (!viewSlug) {
      setStage("views");
      setActiveViewSlug("");
      setSlugManuallyEdited(false);
      setDirty(false);
      setCurrentLabel("");
      setSections([]);
      setSelectedSectionIndex(0);
      setAssignedRoles([]);
      setDefaultRoles([]);
      setAdminOnly(false);
      setCore(EMPTY_CORE);

      return;
    }

  
    // View selected: editing
    setStage("edit");
    setActiveViewSlug(viewSlug);
    // (optional) keep slugManuallyEdited as-is here; loadViewForEdit sets it true anyway
  }, [params.typeId, params.typeSlug, params.viewSlug]);


  // ---------------------------------------------------------------------------
  // Load content types + roles on mount
  // ---------------------------------------------------------------------------
  useEffect(() => {
    let cancelled = false;

    (async () => {
      try {
        setLoadingTypes(true);

        // Load all roles (optional)
        try {
          const rolesRes = await api.get("/api/roles");
          const raw = rolesRes?.data || rolesRes || [];
          if (Array.isArray(raw) && raw.length) {
            const roleList = raw
              .map((r) => (r.slug || r.name || r.role || "").toUpperCase())
              .filter(Boolean);
            if (roleList.length) setAllRoles(roleList);
          }
        } catch {
          // ignore roles error; ADMIN fallback is fine
        }

        const res = await api.get("/api/content-types");
        const list = Array.isArray(res) ? res : res?.data || [];

        list.sort((a, b) => {
          const an = (a.name || a.slug || "").toLowerCase();
          const bn = (b.name || b.slug || "").toLowerCase();
          return an.localeCompare(bn);
        });

        if (!cancelled) setContentTypes(list);
      } catch (err) {
        if (!cancelled) setError("Failed to load content types");
      } finally {
        if (!cancelled) setLoadingTypes(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  // ---------------------------------------------------------------------------
  // Helpers
  // ---------------------------------------------------------------------------
  const computeAvailableFields = (ct) => {
    const custom = (ct && Array.isArray(ct.fields) ? ct.fields : [])
      .map((f) => {
        const key = f.field_key || f.key;
        return key
          ? {
              key,
              label: f.label || f.name || key,
            }
          : null;
      })
      .filter(Boolean);

    const merged = [...BUILTIN_FIELDS];
    for (const f of custom) {
      if (!merged.some((b) => b.key === f.key)) merged.push(f);
    }
    return merged;
  };

  const typeKeyForRead = useMemo(() => {
    // For reads, your API appears to accept the slug (as you showed).
    // But once we have a UUID, prefer it for consistency.
    return selectedTypeUuid || selectedTypeId;
  }, [selectedTypeUuid, selectedTypeId]);

  const typeKeyForMutations = useMemo(() => {
    // For PUT/DELETE, prefer UUID if available (fixes installs requiring UUID).
    return contentTypeDetail?.id || selectedTypeUuid || selectedTypeId;
  }, [contentTypeDetail?.id, selectedTypeUuid, selectedTypeId]);

  // ---------------------------------------------------------------------------
  // Load content type detail + editor views whenever selectedTypeId or active view changes
  // ---------------------------------------------------------------------------
  useEffect(() => {
  if (!selectedTypeId) return;

  let cancelled = false;
  const viewSlugFromRoute = params.viewSlug || "";

  (async () => {
    try {
      setLoading(true);
      setError("");
      setSaveMessage("");
      setDirty(false);

      // ✅ load CT detail with all=true so fields exist reliably
      const ctRes = await api.get(`/api/content-types/${selectedTypeId}?all=true`);
      const ct = ctRes?.data || ctRes || null;
      if (cancelled) return;

      setContentTypeDetail(ct);
      setSelectedTypeUuid(ct?.id || "");
      setAvailableFields(computeAvailableFields(ct));

      // ✅ use UUID if we have it
      const readKey = ct?.id || selectedTypeId;

      const viewsRes = await api.get(
        `/api/content-types/${readKey}/editor-views?all=true&_=${Date.now()}`
      );

      const rawViews = viewsRes?.data || viewsRes || [];
      const loadedViews = Array.isArray(rawViews) ? rawViews : rawViews?.views || [];

      if (cancelled) return;

      const normalizedViews = loadedViews.map((v) => ({
        ...v,
        config: normalizeConfig(v?.config),
      }));

      setViews(normalizedViews);

      if (viewSlugFromRoute) {
        const found = pickBestViewBySlug(normalizedViews, viewSlugFromRoute);
        if (found) {
          loadViewForEdit(found);
        } else {
          // slug in URL doesn't exist anymore, go back to views list
          navigate(`/admin/settings/entry-views/${selectedTypeId}`, { replace: true });
        }
      } else {
        setCurrentLabel("");
        setAssignedRoles(["ADMIN"]);
        setDefaultRoles([]);
        setAdminOnly(false);
        setCore(EMPTY_CORE);
        setSections([]);
        setSelectedSectionIndex(0);
        setDirty(false);
      }
    } catch (err) {
      console.error(err);
      if (!cancelled) setError("Failed to load editor views");
    } finally {
      if (!cancelled) setLoading(false);
    }
  })();

  return () => {
    cancelled = true;
  };
  // eslint-disable-next-line react-hooks/exhaustive-deps
}, [selectedTypeId, params.viewSlug]);

  // ---------------------------------------------------------------------------
  // Load a view into form state for editing
  // ---------------------------------------------------------------------------
const loadViewForEdit = (view) => {
  if (!view) return;

  setCurrentLabel(view.label || view.slug);
  setActiveViewSlug(view.slug || "");
  setSlugManuallyEdited(true);

  const cfg = normalizeConfig(view?.config);

  // Roles
  const cfgRoles = Array.isArray(cfg?.roles)
    ? cfg.roles.map((r) => String(r || "").toUpperCase())
    : view.role
    ? [String(view.role || "").toUpperCase()]
    : [];

  const rolesSet = new Set(cfgRoles);
  rolesSet.add("ADMIN");
  const rolesArray = Array.from(rolesSet);

  setAssignedRoles(rolesArray);

  const nonAdmin = rolesArray.filter((r) => r !== "ADMIN");
  setAdminOnly(nonAdmin.length === 0);

  const cfgDefaults = Array.isArray(cfg?.default_roles)
    ? cfg.default_roles.map((r) => String(r || "").toUpperCase())
    : [];
  setDefaultRoles(cfgDefaults);

  // Core
  const loadedCore =
    cfg?.core && typeof cfg.core === "object"
      ? { ...EMPTY_CORE, ...cfg.core }
      : EMPTY_CORE;
  setCore(loadedCore);

  // Sections/widgets
  const rawSections = getRawSectionsFromView(view);
  const secs = normalizeSections(rawSections);

  setSections(secs);
  setSelectedSectionIndex(0);
  setDirty(false);

  // 🔎 Debug that actually helps
  console.log("[EntryViews] view.slug", view?.slug);
  console.log("[EntryViews] rawSections length", rawSections.length);
  console.log("[EntryViews] cfg keys", Object.keys(cfg || {}));
  console.log("[EntryViews] cfg.sections?", !!cfg?.sections);
  console.log("[EntryViews] cfg.widgets?", !!cfg?.widgets);
  console.log("[EntryViews] cfg.layout.sections?", !!cfg?.layout?.sections);
  console.log("[EntryViews] view.sections?", !!view?.sections);
  console.log("[EntryViews] view.widgets?", !!view?.widgets);
};



  // Derived: fields that are not yet assigned to any section
  const unassignedFields = useMemo(() => {
    const assignedKeys = new Set();
    for (const sec of sections) {
      for (const fk of sec.fields) assignedKeys.add(fk);
    }
    return availableFields.filter((f) => !assignedKeys.has(f.key));
  }, [availableFields, sections]);

  // ---------------------------------------------------------------------------
  // Role toggles
  // ---------------------------------------------------------------------------
  const toggleAssignedRole = (roleValue) => {
    const upper = roleValue.toUpperCase();

    if (adminOnly) setAdminOnly(false);

    setAssignedRoles((prev) => {
      const exists = prev.includes(upper);
      if (exists) {
        setDefaultRoles((defPrev) => defPrev.filter((r) => r !== upper));
        return prev.filter((r) => r !== upper);
      }
      return [...prev, upper];
    });

    setDirty(true);
  };

  const toggleAdminOnly = () => {
    if (!adminOnly) {
      setAdminOnly(true);
      setAssignedRoles([]);
      setDefaultRoles([]);
    } else {
      setAdminOnly(false);
    }
    setDirty(true);
  };

  const toggleDefaultRole = (roleValue) => {
    const upper = roleValue.toUpperCase();
    setDefaultRoles((prev) =>
      prev.includes(upper) ? prev.filter((r) => r !== upper) : [...prev, upper]
    );
    setDirty(true);
  };

  // ---------------------------------------------------------------------------
  // Section (widget) helpers
  // ---------------------------------------------------------------------------
  const addSection = () => {
    setSections((prev) => {
      const index = prev.length + 1;
      return [
        ...prev,
        {
          id: `widget-${index}`,
          title: `Widget ${index}`,
          description: "",
          layout: "one-column",
          fields: [],
        },
      ];
    });
    setSelectedSectionIndex((prev) => prev + 1);
    setDirty(true);
  };

  const removeSection = (idx) => {
    setSections((prev) => {
      if (prev.length <= 1) return prev;
      return prev.filter((_, i) => i !== idx);
    });
    setSelectedSectionIndex((prev) => (prev > 0 ? prev - 1 : 0));
    setDirty(true);
  };

  const moveSection = (idx, direction) => {
    setSections((prev) => {
      const target = direction === "up" ? idx - 1 : idx + 1;
      if (target < 0 || target >= prev.length) return prev;
      const next = [...prev];
      [next[idx], next[target]] = [next[target], next[idx]];
      return next;
    });

    setSelectedSectionIndex((prev) =>
      direction === "up" ? Math.max(0, prev - 1) : prev + 1
    );

    setDirty(true);
  };

  const updateSection = (idx, field, value) => {
    setSections((prev) => {
      const next = [...prev];
      next[idx] = { ...next[idx], [field]: value };
      return next;
    });
    setDirty(true);
  };

  const addFieldToSection = (fieldKey, sectionIdx) => {
    if (!fieldKey) return;
    setSections((prev) => {
      const next = [...prev];
      if (!next[sectionIdx].fields.includes(fieldKey)) {
        next[sectionIdx].fields = [...next[sectionIdx].fields, fieldKey];
      }
      return next;
    });
    setDirty(true);
  };

  const removeFieldFromSection = (fieldKey, sectionIdx) => {
    setSections((prev) => {
      const next = [...prev];
      next[sectionIdx].fields = next[sectionIdx].fields.filter((f) => f !== fieldKey);
      return next;
    });
    setDirty(true);
  };

  const moveFieldWithinSection = (fieldKey, sectionIdx, direction) => {
    setSections((prev) => {
      const next = [...prev];
      const list = [...(next[sectionIdx].fields || [])];
      const idx = list.indexOf(fieldKey);
      if (idx === -1) return prev;
      const target = direction === "up" ? idx - 1 : idx + 1;
      if (target < 0 || target >= list.length) return prev;
      [list[idx], list[target]] = [list[target], list[idx]];
      next[sectionIdx].fields = list;
      return next;
    });
    setDirty(true);
  };

  // ---------------------------------------------------------------------------
  // Handlers for selecting type and view
  // ---------------------------------------------------------------------------
  const handleSelectType = (val) => {
    if (!val) return;
    navigate(`/admin/settings/entry-views/${val}`);
  };

  const handleSelectView = (slug) => {
    if (!slug) return;
    navigate(`/admin/settings/entry-views/${selectedTypeId}/${slug}`);
  };

  const handleNewView = () => {
    if (!selectedTypeId) return;

    const baseLabel = "New editor";
    let label = baseLabel;
    let suffix = 1;
    const existing = views.map((v) => (v.label || v.slug || "").toLowerCase());
    while (existing.includes(label.toLowerCase())) {
      suffix += 1;
      label = `${baseLabel} ${suffix}`;
    }
    const slug = slugify(label);

    setCurrentLabel(label);
    setAssignedRoles(["ADMIN"]);
    setDefaultRoles(["ADMIN"]);
    setAdminOnly(false);
    setCore(EMPTY_CORE);
    setSections([
      {
        id: "widget-1",
        title: "Widget 1",
        description: "",
        layout: "one-column",
        fields: [],
      },
    ]);
    setSelectedSectionIndex(0);
    setActiveViewSlug(slug);
    setSlugManuallyEdited(false);

    setStage("edit");
    setDirty(true);
    navigate(`/admin/settings/entry-views/${selectedTypeId}/${slug}`);
  };

  // ---------------------------------------------------------------------------
  // Save / Delete
  // ---------------------------------------------------------------------------
  const handleSave = async () => {
    if (!currentLabel.trim()) {
      setError("Label is required");
      return;
    }

    const slug = slugify(activeViewSlug || currentLabel);

    const dup = views.find((v) => {
      if (!v.slug) return false;
      const vSlug = v.slug.toLowerCase();
      const next = slug.toLowerCase();
      const current = (activeViewSlug || "").toLowerCase();
      return vSlug === next && vSlug !== current;
    });

    if (dup) {
      setError(`A view with the slug "${slug}" already exists.`);
      return;
    }


    const rolesSet = new Set(assignedRoles.map((r) => r.toUpperCase()));
    rolesSet.add("ADMIN");
    const rolesArray = Array.from(rolesSet);

    const defaults = defaultRoles.map((r) => r.toUpperCase());

    const payloadSections = (sections || [])
      .map((sec) => {
        const cleanedFields = (sec.fields || [])
          .map((k) => String(k || "").trim())
          .filter(Boolean);
        return {
          id: sec.id,
          title: sec.title,
          description: sec.description,
          layout: sec.layout,
          fields: cleanedFields,
        };
      })
      .filter((s) => s.fields && s.fields.length);

    if (payloadSections.length === 0) {
      setError("Please add at least one widget with a field");
      return;
    }

    const payload = {
      slug,
      label: currentLabel,
      config: {
        roles: rolesArray,
        default_roles: defaults,
        core: core || EMPTY_CORE,
        sections: payloadSections,
      },
    };

    try {
      setLoading(true);
      setError("");
      setSaveMessage("");

      await api.put(`/api/content-types/${typeKeyForMutations}/editor-view`, payload);

      const res = await api.get(
        `/api/content-types/${typeKeyForRead}/editor-views?all=true&_=${Date.now()}`
      );
      const raw = res?.data || res || [];
      const newViews = Array.isArray(raw) ? raw : raw.views || [];

      const normalizedNewViews = newViews.map((v) => ({
        ...v,
        config: normalizeConfig(v?.config),
      }));

setViews(normalizedNewViews);

const newly = pickBestViewBySlug(normalizedNewViews, slug);
if (newly) loadViewForEdit(newly);


      setDirty(false);
      setSaveMessage("View saved.");
    } catch (err) {
      console.error(err);
      setError(err?.response?.data?.error || err.message || "Failed to save view");
    } finally {
      setLoading(false);
    }
  };

  const handleDelete = async () => {
    if (!activeViewSlug) return;
    if (!window.confirm("Delete this entry editor view?")) return;

    try {
      setLoading(true);

      await api.delete(
        `/api/content-types/${typeKeyForMutations}/editor-view/${activeViewSlug}`
      );

      const remaining = views
        .filter((v) => v.slug !== activeViewSlug)
        .map((v) => ({ ...v, config: normalizeConfig(v?.config) }));

  setViews(remaining);

      setActiveViewSlug("");
      setCurrentLabel("");
      setAssignedRoles(["ADMIN"]);
      setDefaultRoles([]);
      setAdminOnly(false);
      setCore(EMPTY_CORE);
      setSections([]);
      setSelectedSectionIndex(0);
      setDirty(false);
      setSaveMessage("");

      navigate(`/admin/settings/entry-views/${selectedTypeId}`);
    } catch (err) {
      console.error(err);
      setError(err?.response?.data?.error || err.message || "Failed to delete view");
    } finally {
      setLoading(false);
    }
  };

  // ---------------------------------------------------------------------------
  // Render stages
  // ---------------------------------------------------------------------------
  const renderTypeStage = () => (
    <div className="su-card">
      <div className="su-card-body su-flex su-flex-wrap su-gap-sm">
        {contentTypes.map((ct) => {
          const typeKey = ct.slug || ct.id;
          const isActive = typeKey === selectedTypeId;
          return (
            <button
              key={typeKey}
              className={"su-chip" + (isActive ? " su-chip--active" : "")}
              onClick={() => handleSelectType(typeKey)}
            >
              {ct.name || ct.label || ct.slug}
            </button>
          );
        })}
        {!contentTypes.length && (
          <p className="su-text-sm su-text-muted">
            No content types found. Create one in Quick Builder first.
          </p>
        )}
      </div>
    </div>
  );

  const renderViewsStage = () => (
    <>
      <div className="su-card su-mb-md">
        <div className="su-card-body su-flex su-flex-wrap su-gap-sm su-items-center">
          <span className="su-text-sm su-text-muted">Views:</span>
          {views.map((v) => {
            const cfg = v.config || {};
            const dRoles = Array.isArray(cfg.default_roles)
              ? cfg.default_roles.map((r) => String(r || "").toUpperCase())
              : [];
            const isDef = dRoles.includes("ADMIN") || !!v.is_default;

            return (
              <button
                key={v.slug}
                className={"su-chip" + (v.slug === activeViewSlug ? " su-chip--active" : "")}
                onClick={() => handleSelectView(v.slug)}
              >
                {v.label || v.slug}
                {isDef && <span className="su-chip-badge">default</span>}
              </button>
            );
          })}
          <button className="su-chip" onClick={handleNewView}>
            + New editor view
          </button>
        </div>
      </div>

      <div className="su-card">
        <div className="su-card-body">
          <p className="su-text-sm su-text-muted">
            Choose an existing view or create a new one to configure which
            fields appear in the entry editor.
          </p>
        </div>
      </div>
    </>
  );

  const renderEditStage = () => {
    const renderSectionList = () => (
      <div className="su-space-y-sm">
        {sections.map((sec, idx) => (
          <div
            key={sec.id}
            className={"su-card" + (idx === selectedSectionIndex ? " su-card--active" : "")}
            style={{ padding: "0.5rem" }}
          >
            <div className="su-flex su-justify-between su-items-center">
              <div
                className="su-flex su-flex-col"
                style={{ flex: 1, cursor: "pointer" }}
                onClick={() => setSelectedSectionIndex(idx)}
              >
                <strong>{sec.title || `Widget ${idx + 1}`}</strong>
                <small className="su-text-xs su-text-muted">
                  {sec.fields.length} field{sec.fields.length !== 1 ? "s" : ""}
                </small>
              </div>

              <div className="su-flex su-gap-xs">
                <button
                  className="su-icon-btn"
                  onClick={() => moveSection(idx, "up")}
                  disabled={idx === 0}
                  title="Move up"
                  type="button"
                >
                  ↑
                </button>
                <button
                  className="su-icon-btn"
                  onClick={() => moveSection(idx, "down")}
                  disabled={idx === sections.length - 1}
                  title="Move down"
                  type="button"
                >
                  ↓
                </button>
                <button
                  className="su-icon-btn"
                  onClick={() => removeSection(idx)}
                  disabled={sections.length <= 1}
                  title="Delete widget"
                  type="button"
                >
                  ✕
                </button>
              </div>
            </div>
          </div>
        ))}

        <button className="su-btn su-btn-secondary su-w-full" onClick={addSection} type="button">
          + Add widget
        </button>
      </div>
    );

    const renderSelectedSection = () => {
      const sec = sections[selectedSectionIndex];
      if (!sec) return null;

      return (
        <div className="su-space-y-md">
          <div>
            <label className="su-form-label">Widget title</label>
            <input
              className="su-input"
              value={sec.title || ""}
              onChange={(e) => updateSection(selectedSectionIndex, "title", e.target.value)}
            />
          </div>

          <div>
            <label className="su-form-label">Description (optional)</label>
            <textarea
              className="su-input"
              value={sec.description || ""}
              onChange={(e) => updateSection(selectedSectionIndex, "description", e.target.value)}
            />
          </div>

          <div>
            <label className="su-form-label">Layout</label>
            <select
              className="su-input"
              value={sec.layout || "one-column"}
              onChange={(e) => updateSection(selectedSectionIndex, "layout", e.target.value)}
            >
              <option value="one-column">One column</option>
              <option value="two-column">Two columns</option>
            </select>
          </div>

          <div>
            <h4 className="su-text-sm su-font-semibold">Fields in this widget</h4>
            {sec.fields.length === 0 && (
              <p className="su-text-xs su-text-muted">No fields assigned.</p>
            )}

            <div className="su-space-y-xs">
              {sec.fields.map((fk, idx) => {
                const fieldDef = availableFields.find((f) => f.key === fk);
                const label = fieldDef ? fieldDef.label || fk : fk;
                return (
                  <div key={fk} className="su-chip su-w-full su-justify-between">
                    <span>{label}</span>
                    <span className="su-flex su-gap-xs">
                      <button
                        className="su-icon-btn"
                        onClick={() => moveFieldWithinSection(fk, selectedSectionIndex, "up")}
                        disabled={idx === 0}
                        title="Move up"
                        type="button"
                      >
                        ↑
                      </button>
                      <button
                        className="su-icon-btn"
                        onClick={() => moveFieldWithinSection(fk, selectedSectionIndex, "down")}
                        disabled={idx === sec.fields.length - 1}
                        title="Move down"
                        type="button"
                      >
                        ↓
                      </button>
                      <button
                        className="su-icon-btn"
                        onClick={() => removeFieldFromSection(fk, selectedSectionIndex)}
                        title="Remove field"
                        type="button"
                      >
                        ✕
                      </button>
                    </span>
                  </div>
                );
              })}
            </div>
          </div>

          <div>
            <h4 className="su-text-sm su-font-semibold">Unassigned fields</h4>
            {unassignedFields.length === 0 && (
              <p className="su-text-xs su-text-muted">All fields assigned.</p>
            )}
            <div className="su-space-y-xs">
              {unassignedFields.map((f) => (
                <button
                  key={f.key}
                  className="su-chip su-w-full su-justify-between"
                  onClick={() => addFieldToSection(f.key, selectedSectionIndex)}
                  type="button"
                >
                  {f.label || f.key}
                  <span className="su-chip-badge">Add</span>
                </button>
              ))}
            </div>
          </div>
        </div>
      );
    };

    return (
      <>
        <div className="su-card su-mb-md">
          <div className="su-card-body">
            <button
              type="button"
              className="su-chip"
              onClick={() => navigate(`/admin/settings/entry-views/${selectedTypeId}`)}
            >
              ← Back
            </button>
          </div>
        </div>

        <div className="su-grid md:grid-cols-2 gap-md">
          {/* Left column: view metadata */}
          <div className="su-card">
            <div className="su-card-body su-space-y-md">
              <div>
              <label className="su-form-label">Label</label>
              <input
                className="su-input"
                value={currentLabel}
           onChange={(e) => {
             const nextLabel = e.target.value;
             setCurrentLabel(nextLabel);
             setDirty(true);

             // ✅ auto-generate slug ONLY if slug is empty and user hasn't manually edited it
             if (!slugManuallyEdited && !activeViewSlug.trim()) {
               setActiveViewSlug(slugify(nextLabel));
             }
           }}

              />
          </div>


              <div>
                <label className="su-form-label">Slug</label>
                <input
                  className="su-input"
                  value={activeViewSlug}
                  onChange={(e) => {
                  const nextSlug = slugify(e.target.value);

                  setActiveViewSlug(nextSlug);
                  setDirty(true);

                  // ✅ if user types anything, treat as manually edited
                  // ✅ if they clear it, allow auto-sync again
                  setSlugManuallyEdited(!!nextSlug);
                }}

                  onBlur={(e) => {
                   const nextSlug = slugify(e.target.value);
                    if (!nextSlug) {
                     navigate(`/admin/settings/entry-views/${selectedTypeId}`, { replace: true });
                     return;
                   }

                  
                   setActiveViewSlug(nextSlug);

                   if (!selectedTypeId) return;
                   navigate(`/admin/settings/entry-views/${selectedTypeId}/${nextSlug}`, {
                     replace: true,
                   });
                 }}

                />
              </div>


              {/* Core behavior */}
              <div className="su-card" style={{ background: "var(--su-surface)" }}>
                <div className="su-card-body su-space-y-sm">
                  <div className="su-text-sm su-font-semibold">
                    Core fields &amp; behavior
                  </div>

                  <div className="su-grid md:grid-cols-2 gap-sm">
                    <div>
                      <label className="su-form-label">Title label</label>
                      <input
                        className="su-input"
                        value={core.titleLabel || "Title"}
                        onChange={(e) => {
                          setCore((prev) => ({ ...prev, titleLabel: e.target.value }));
                          setDirty(true);
                        }}
                      />
                    </div>

                    <div>
                      <label className="su-form-label">Title mode</label>
                      <select
                        className="su-input"
                        value={core.titleMode || "manual"}
                        onChange={(e) => {
                          setCore((prev) => ({ ...prev, titleMode: e.target.value }));
                          setDirty(true);
                        }}
                      >
                        <option value="manual">Manual</option>
                        <option value="template">Derived (template)</option>
                      </select>
                      <div className="su-text-xs su-text-muted">
                        Use “Derived” for surrogates/intended parents.
                      </div>
                    </div>

                    <div className="md:col-span-2">
                      <label className="su-form-label">Title template</label>
                      <input
                        className="su-input"
                        placeholder='Example: {name.first} {name.last}'
                        value={core.titleTemplate || ""}
                        onChange={(e) => {
                          setCore((prev) => ({ ...prev, titleTemplate: e.target.value }));
                          setDirty(true);
                        }}
                        disabled={(core.titleMode || "manual") !== "template"}
                      />
                      <div className="su-text-xs su-text-muted">
                        Tokens support nested paths: <code>{"{name.first}"}</code>,{" "}
                        <code>{"{parent_one.first}"}</code>, etc.
                      </div>
                    </div>

                    <label className="su-chip su-items-center su-gap-xs">
                      <input
                        type="checkbox"
                        checked={!!core.hideTitle}
                        onChange={(e) => {
                          setCore((prev) => ({ ...prev, hideTitle: e.target.checked }));
                          setDirty(true);
                        }}
                      />
                      Hide Title field
                    </label>

                    <label className="su-chip su-items-center su-gap-xs">
                      <input
                        type="checkbox"
                        checked={!!core.hideSlug}
                        onChange={(e) => {
                          setCore((prev) => ({ ...prev, hideSlug: e.target.checked }));
                          setDirty(true);
                        }}
                      />
                      Hide Slug field
                    </label>

                    <label className="su-chip su-items-center su-gap-xs">
                      <input
                        type="checkbox"
                        checked={!!core.hideStatus}
                        onChange={(e) => {
                          setCore((prev) => ({ ...prev, hideStatus: e.target.checked }));
                          setDirty(true);
                        }}
                      />
                      Hide Status field
                    </label>

                    <label className="su-chip su-items-center su-gap-xs">
                      <input
                        type="checkbox"
                        checked={!!core.hidePreview}
                        onChange={(e) => {
                          setCore((prev) => ({ ...prev, hidePreview: e.target.checked }));
                          setDirty(true);
                        }}
                      />
                      Hide Preview panel
                    </label>

                    <label className="su-chip su-items-center su-gap-xs md:col-span-2">
                      <input
                        type="checkbox"
                        checked={core.autoSlugFromTitleIfEmpty !== false}
                        onChange={(e) => {
                          setCore((prev) => ({
                            ...prev,
                            autoSlugFromTitleIfEmpty: e.target.checked,
                          }));
                          setDirty(true);
                        }}
                      />
                      Auto-slug from title when slug is empty
                    </label>
                  </div>
                </div>
              </div>

              <div>
                <label className="su-form-label">Assigned roles</label>
                <div className="su-flex su-flex-wrap su-gap-sm">
                  {allRoles.map((r) => (
                    <label key={r} className="su-chip su-items-center su-gap-xs">
                      <input
                        type="checkbox"
                        checked={assignedRoles.includes(r)}
                        onChange={() => toggleAssignedRole(r)}
                      />
                      {r}
                    </label>
                  ))}
                  <label className="su-chip su-items-center su-gap-xs">
                    <input type="checkbox" checked={adminOnly} onChange={toggleAdminOnly} />
                    Admin only
                  </label>
                </div>
              </div>

              <div>
                <label className="su-form-label">Default roles</label>
                <div className="su-flex su-flex-wrap su-gap-sm">
                  {assignedRoles
                    .filter((r) => !adminOnly || r === "ADMIN")
                    .map((r) => (
                      <label key={r} className="su-chip su-items-center su-gap-xs">
                        <input
                          type="checkbox"
                          checked={defaultRoles.includes(r)}
                          onChange={() => toggleDefaultRole(r)}
                        />
                        {r}
                      </label>
                    ))}
                </div>
              </div>

              <div className="su-flex su-gap-sm">
                <button
                  className="su-btn su-btn-primary"
                  type="button"
                  onClick={handleSave}
                  disabled={!dirty || loading}
                >
                  {loading ? "Saving…" : "Save"}
                </button>

                {activeViewSlug && (
                  <button
                    className="su-btn su-btn-error"
                    type="button"
                    onClick={handleDelete}
                    disabled={loading}
                  >
                    Delete
                  </button>
                )}

                {saveMessage && (
                  <span className="su-text-xs su-text-success">{saveMessage}</span>
                )}
              </div>

              {error && <div className="su-alert su-alert-danger su-mt-sm">{error}</div>}
            </div>
          </div>

          {/* Right column: widget builder */}
          <div className="su-grid md:grid-cols-2 gap-md">
            <div>
              <h3 className="su-card-title su-mb-sm">Widgets</h3>
              {renderSectionList()}
            </div>
            <div>
              <h3 className="su-card-title su-mb-sm">
                {sections[selectedSectionIndex]?.title || `Widget ${selectedSectionIndex + 1}`}
              </h3>
              {renderSelectedSection()}
            </div>
          </div>
        </div>
      </>
    );
  };

  // ---------------------------------------------------------------------------
  // Render root
  // ---------------------------------------------------------------------------
  return (
    <div className="su-page">
      <div className="su-page-header su-flex su-justify-between su-items-center su-mb-md">
        <div>
          <h1 className="su-page-title">Entry Editor Views</h1>
          <p className="su-page-subtitle">Configure the entry editor for your content types.</p>
        </div>
      </div>

      {loadingTypes ? (
        <p>Loading…</p>
      ) : stage === "types" ? (
        renderTypeStage()
      ) : stage === "views" ? (
        renderViewsStage()
      ) : (
        renderEditStage()
      )}
    </div>
  );
}
