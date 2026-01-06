// admin/src/components/FieldInput.jsx
import React, { useState, useMemo, useEffect } from "react";
import RichTextEditor from "./RichTextEditor";
import { DateTime } from "luxon";
import {
  combineDateAndTimeToUTC,
  fmtDateISO,
  fmtDateTimeUTC,
  fmtTimeShortLower,
} from "../utils/datetime";
import { contrastRatio, normalizeHex } from "../utils/color";
import {
  uploadToSupabase,
  getSignedUrl,
  resolveBucketName,
} from "../lib/storage";
import { api } from "../lib/api";

/** ---------- Helpers ---------- */

function Modal({ open, title, onClose, children }) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e) => {
      if (e.key === "Escape") onClose?.();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div
      role="dialog"
      aria-modal="true"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose?.();
      }}
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 9999,
        background: "rgba(0,0,0,0.55)",
        display: "grid",
        placeItems: "center",
        padding: 16,
      }}
    >
      <div
        style={{
          width: "min(1100px, 96vw)",
          height: "min(80vh, 820px)",
          background: "var(--su-surface, #fff)",
          borderRadius: 14,
          boxShadow: "0 20px 50px rgba(0,0,0,0.25)",
          overflow: "hidden",
          display: "grid",
          gridTemplateRows: "auto 1fr",
        }}
      >
        <div
          style={{
            padding: "10px 12px",
            borderBottom: "1px solid var(--su-border, #e5e7eb)",
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            gap: 12,
          }}
        >
          <div style={{ fontWeight: 700, fontSize: 14, opacity: 0.9 }}>
            {title || "Preview"}
          </div>
          <button
            type="button"
            className="su-btn"
            onClick={onClose}
            style={{ padding: "6px 10px" }}
          >
            Close
          </button>
        </div>

        <div style={{ position: "relative" }}>{children}</div>
      </div>
    </div>
  );
}

// Normalize choices to array of { value, label }
function normalizeChoices(input) {
  if (!input) return [];
  if (Array.isArray(input) && input.every((x) => typeof x === "string")) {
    return input.map((s) => ({ value: String(s), label: String(s) }));
  }
  if (Array.isArray(input)) {
    return input
      .map((it) => {
        if (it == null) return null;
        if (
          typeof it === "string" ||
          typeof it === "number" ||
          typeof it === "boolean"
        ) {
          const s = String(it);
          return { value: s, label: s };
        }
        const value =
          it.value ??
          it.slug ??
          it.id ??
          it.key ??
          it.code ??
          it.name ??
          it.title ??
          it.label;
        const label =
          it.label ??
          it.title ??
          it.name ??
          it.value ??
          it.slug ??
          it.id ??
          it.code ??
          value;
        return value != null
          ? { value: String(value), label: String(label) }
          : null;
      })
      .filter(Boolean);
  }
  return [];
}

// Upload policy resolver (simple accept/max + optional rules[])
function resolveUploadPolicy(options) {
  const simpleAccept = options?.accept;
  const simpleMax = options?.maxSizeMB;
  const rules = Array.isArray(options?.rules) ? options.rules : null;
  if (!rules || rules.length === 0)
    return { accept: simpleAccept, maxSizeMB: simpleMax };
  const acceptAttr = rules.map((r) => r.accept).filter(Boolean).join(",");
  return { accept: acceptAttr || simpleAccept, maxSizeMB: simpleMax, rules };
}


function isLikelyMobile() {
  if (typeof window === "undefined") return false;
  // coarse pointer is a good proxy for touch devices
  return window.matchMedia?.("(pointer: coarse)").matches;
}

function validateFileAgainstAccept(file, acceptCombined) {
  if (!acceptCombined) return true;
  const accept = String(acceptCombined || "")
    .split(",")
    .map((p) => p.trim())
    .filter(Boolean);

  if (!accept.length) return true;

  return accept.some((p) => {
    if (p === "*/*") return true;
    if (p.endsWith("/*")) return file.type.startsWith(p.slice(0, -1));
    // allow common extension accept (e.g. ".pdf")
    if (p.startsWith(".")) return file.name.toLowerCase().endsWith(p.toLowerCase());
    return file.type === p;
  });
}

function DropzoneButton({
  disabled,
  accept,
  multiple,
  onFiles,
  label = "Click or drag files here",
}) {
  const mobile = isLikelyMobile();
  const [over, setOver] = useState(false);
  const inputId = useMemo(() => `su-drop-${Math.random().toString(36).slice(2)}`, []);

  if (mobile) {
    // Mobile: always show normal file picker
    return (
      <input
        id={inputId}
        type="file"
        accept={accept}
        multiple={!!multiple}
        disabled={disabled}
        onChange={(e) => onFiles(e.target.files)}
      />
    );
  }

  return (
    <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
      <input
        id={inputId}
        type="file"
        accept={accept}
        multiple={!!multiple}
        disabled={disabled}
        style={{ display: "none" }}
        onChange={(e) => onFiles(e.target.files)}
      />

      <label
        htmlFor={inputId}
        onDragEnter={(e) => {
          e.preventDefault();
          if (!disabled) setOver(true);
        }}
        onDragOver={(e) => {
          e.preventDefault();
          if (!disabled) setOver(true);
        }}
        onDragLeave={(e) => {
          e.preventDefault();
          setOver(false);
        }}
        onDrop={(e) => {
          e.preventDefault();
          setOver(false);
          if (disabled) return;
          const files = e.dataTransfer?.files;
          if (files && files.length) onFiles(files);
        }}
        style={{
          cursor: disabled ? "not-allowed" : "pointer",
          userSelect: "none",
          display: "inline-flex",
          alignItems: "center",
          justifyContent: "center",
          gap: 8,
          padding: "10px 12px",
          borderRadius: 12,
          border: "1px dashed var(--su-border, #e5e7eb)",
          background: over ? "rgba(59,130,246,0.10)" : "var(--su-surface, #fff)",
          opacity: disabled ? 0.6 : 1,
          minWidth: 260,
          fontSize: 13,
          fontWeight: 600,
        }}
        aria-disabled={disabled ? "true" : "false"}
      >
        {label}
      </label>

      <div style={{ fontSize: 11, opacity: 0.7 }}>
        {multiple ? "You can drop multiple files." : "Drop a file to upload."}
      </div>
    </div>
  );
}




/**
 * IMPORTANT:
 * Your platform now stores "field config" in field.config (DB-backed),
 * but some older UI code used field.options.
 * This normalizes so we can read both.
 */
function getFieldConfig(field) {
  const cfg =
    (field?.config && typeof field.config === "object" ? field.config : null) ||
    (field?.options && typeof field.options === "object" ? field.options : {}) ||
    {};
  return cfg;
}

function getFieldChoices(field) {
  const cfg = getFieldConfig(field);
  return cfg.choices ?? cfg.options ?? field?.choices ?? field?.options ?? [];
}

/** Subfield config helper */
function subCfg(field, key, fallbackLabel, defaultShow = true) {
  const cfg = getFieldConfig(field);
  const s =
    cfg.subfields && typeof cfg.subfields === "object"
      ? cfg.subfields[key] || {}
      : {};
  return {
    show: s.show !== undefined ? !!s.show : !!defaultShow,
    label:
      typeof s.label === "string" && s.label.length ? s.label : fallbackLabel,
  };
}

function safeStr(v) {
  return v == null ? "" : String(v);
}

function userLabel(user, display = "name_email") {
  if (!user) return "";
  const name = safeStr(user.name).trim();
  const email = safeStr(user.email).trim();
  if (display === "email") return email || name || "";
  if (display === "name") return name || email || "";
  return name && email ? `${name} — ${email}` : name || email || "";
}

function normalizeUserIds(value, multiple) {
  if (multiple) {
    if (Array.isArray(value)) return value.map(String).filter(Boolean);
    if (typeof value === "string" && value.trim()) return [value.trim()];
    return [];
  }
  if (typeof value === "string" && value.trim()) return value.trim();
  return "";
}

// ✅ NEW: determine preview behavior
function getPreviewTypeFromFile(meta) {
  const mime = (meta?.mime || "").toLowerCase();
  const name = (meta?.name || "").toLowerCase();
  const path = (meta?.path || "").toLowerCase();

  const looksPdf =
    mime.includes("pdf") || name.endsWith(".pdf") || path.endsWith(".pdf");
  if (looksPdf) return "pdf";

  const looksDocx =
    mime.includes("officedocument.wordprocessingml") ||
    name.endsWith(".docx") ||
    path.endsWith(".docx");
  if (looksDocx) return "docx";

  const looksDoc =
    mime.includes("msword") || name.endsWith(".doc") || path.endsWith(".doc");
  if (looksDoc) return "doc"; // will try office viewer

  return "other";
}

function getRelationshipTargetSlugFromField(field) {
  const cfg = getFieldConfig(field);

  // Try the most common shapes we’ve seen across installs
  const v =
    cfg?.relation?.slug ||
    cfg?.relation?.content_type_slug ||
    cfg?.relation?.contentType || // sometimes slug, sometimes id; we’ll still try it
    cfg?.relation?.content_type ||
    cfg?.relation?.target ||
    cfg?.relatedType ||
    cfg?.contentType ||
    cfg?.targetType ||
    cfg?.target ||
    field?.relatedType ||
    field?.contentType ||
    null;

  // Sometimes stored as an object like { slug, id, contentType }
  if (v && typeof v === "object") {
    return (
      v.slug ||
      v.contentType ||
      v.relatedType ||
      v.content_type_slug ||
      v.id ||
      null
    );
  }

  return v ? String(v) : null;
}

function normalizeRelKey(k) {
  if (!k) return "";
  return String(k)
    .trim()
    .toLowerCase()
    .replace(/_/g, "-"); // intended_parents -> intended-parents
}



/** ------------------------------------------------------------------ */
/** USER RELATIONSHIP FIELD (relation_user)                             */
/** ------------------------------------------------------------------ */
function UserRelationField({ field, value, onChange, resolved }) {
  const cfg = getFieldConfig(field);
  const fieldKey = field?.key;

  const serverUserFields =
    resolved?.userFields && fieldKey ? resolved.userFields[fieldKey] : null;

  const multiple = !!(serverUserFields?.multiple ?? cfg?.multiple);
  const display = serverUserFields?.display || cfg?.display || "name_email";
  const roleFilter =
    (serverUserFields?.roleFilter || cfg?.roleFilter || "").toString().trim();
  const onlyActive =
    serverUserFields?.onlyActive ??
    (cfg?.onlyActive === undefined ? true : !!cfg.onlyActive);

  const usersById = resolved?.usersById || {};

  const normalized = useMemo(
    () => normalizeUserIds(value, multiple),
    [value, multiple]
  );

  const [q, setQ] = useState("");
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [results, setResults] = useState([]);
  const [err, setErr] = useState("");

  useEffect(() => {
    let alive = true;
    const handle = setTimeout(async () => {
      if (!open) return;
      setBusy(true);
      setErr("");
      try {
        const params = new URLSearchParams();
        params.set("q", q || "");
        if (roleFilter) params.set("role", roleFilter);
        params.set("onlyActive", onlyActive ? "true" : "false");
        params.set("limit", "50");

        const res = await api.get(`/api/users/picker?${params.toString()}`);
        const list = res?.users || res?.data?.users || [];
        if (!alive) return;
        setResults(Array.isArray(list) ? list : []);
      } catch (e) {
        if (!alive) return;
        setErr(e?.message || "Failed to load users");
        setResults([]);
      } finally {
        if (alive) setBusy(false);
      }
    }, 200);

    return () => {
      alive = false;
      clearTimeout(handle);
    };
  }, [q, open, roleFilter, onlyActive]);

  function isSelected(id) {
    if (!id) return false;
    if (multiple) return Array.isArray(normalized) && normalized.includes(id);
    return normalized === id;
  }

  function selectUser(id) {
    if (!id) return;
    if (multiple) {
      const current = Array.isArray(normalized) ? normalized : [];
      if (current.includes(id)) return;
      onChange([...current, id]);
      setQ("");
      setOpen(true);
      return;
    }
    onChange(id);
    setOpen(false);
    setQ("");
  }

  function removeUser(id) {
    if (!id) return;
    if (multiple) {
      const current = Array.isArray(normalized) ? normalized : [];
      onChange(current.filter((x) => x !== id));
    } else {
      if (normalized === id) onChange("");
    }
  }

  const selectedIds = multiple
    ? (Array.isArray(normalized) ? normalized : [])
    : normalized
    ? [normalized]
    : [];

  const selectedUsers = selectedIds.map((id) => ({
    id,
    user: usersById[id] || results.find((u) => u.id === id) || null,
  }));

  if (!multiple) {
    const selectedUser = normalized
      ? usersById[normalized] ||
        results.find((u) => u.id === normalized) ||
        null
      : null;

    return (
      <div style={{ display: "grid", gap: 8 }}>
        <input
          type="text"
          value={q}
          placeholder="Search users…"
          onChange={(e) => setQ(e.target.value)}
          onFocus={() => setOpen(true)}
          onBlur={() => setTimeout(() => setOpen(false), 150)}
        />

        <select
          className="su-select"
          value={normalized || ""}
          onFocus={() => setOpen(true)}
          onBlur={() => setTimeout(() => setOpen(false), 150)}
          onChange={(e) => {
            const next = e.target.value;
            if (next === "__clear__") return onChange("");
            if (!next) return onChange("");
            selectUser(next);
          }}
        >
          <option value="">— Select a user —</option>
          {normalized && <option value="__clear__">Clear selection</option>}

          {normalized &&
            selectedUser &&
            !results.some((u) => u.id === normalized) && (
              <option value={normalized}>
                {userLabel(selectedUser, display) ||
                  selectedUser.email ||
                  normalized}
              </option>
            )}

          {results.map((u) => (
            <option key={u.id} value={u.id}>
              {userLabel(u, display) || u.email || u.id}
            </option>
          ))}
        </select>

        <div style={{ fontSize: 11, opacity: 0.7 }}>
          Stores a user ID.
          {roleFilter ? ` Filter: ${roleFilter}.` : ""}{" "}
          {onlyActive ? "Active only." : "Includes inactive."}{" "}
          {busy ? "Searching…" : err ? err : ""}
        </div>
      </div>
    );
  }

  return (
    <div style={{ display: "grid", gap: 8 }}>
      {selectedIds.length > 0 && (
        <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
          {selectedUsers.map(({ id, user }) => (
            <span
              key={id}
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: 8,
                border: "1px solid var(--su-border, #e5e7eb)",
                borderRadius: 999,
                padding: "4px 10px",
                fontSize: 12,
                background: "var(--su-surface, #fff)",
              }}
              title={id}
            >
              <span style={{ opacity: 0.9 }}>
                {userLabel(user, display) || id}
              </span>
              <button
                type="button"
                onClick={() => removeUser(id)}
                style={{
                  border: "none",
                  background: "transparent",
                  cursor: "pointer",
                  fontSize: 14,
                  lineHeight: 1,
                  opacity: 0.7,
                }}
                aria-label="Remove"
              >
                ×
              </button>
            </span>
          ))}
        </div>
      )}

      <div style={{ position: "relative" }}>
        <input
          type="text"
          value={q}
          placeholder={"Search users… (add multiple)"}
          onChange={(e) => setQ(e.target.value)}
          onFocus={() => setOpen(true)}
          onBlur={() => setTimeout(() => setOpen(false), 150)}
        />

        {open && (
          <div
            style={{
              position: "absolute",
              top: "calc(100% + 6px)",
              left: 0,
              right: 0,
              zIndex: 20,
              border: "1px solid var(--su-border, #e5e7eb)",
              borderRadius: 10,
              background: "var(--su-surface, #fff)",
              boxShadow: "0 10px 25px rgba(0,0,0,0.08)",
              maxHeight: 260,
              overflow: "auto",
            }}
          >
            <div style={{ padding: 8, fontSize: 12, opacity: 0.75 }}>
              {busy
                ? "Searching…"
                : err
                ? err
                : results.length
                ? "Select a user"
                : "No matches"}
            </div>

            {!busy &&
              !err &&
              results.map((u) => {
                const label = userLabel(u, display) || u.email || u.id;
                const selected = isSelected(u.id);
                return (
                  <button
                    key={u.id}
                    type="button"
                    onMouseDown={(e) => e.preventDefault()}
                    onClick={() => selectUser(u.id)}
                    disabled={selected}
                    style={{
                      width: "100%",
                      textAlign: "left",
                      padding: "10px 10px",
                      border: "none",
                      borderTop: "1px solid rgba(0,0,0,0.06)",
                      background: selected
                        ? "rgba(59,130,246,0.08)"
                        : "transparent",
                      cursor: selected ? "not-allowed" : "pointer",
                      fontSize: 13,
                    }}
                  >
                    <div
                      style={{
                        fontWeight: 600,
                        opacity: selected ? 0.7 : 1,
                      }}
                    >
                      {label}
                    </div>
                    <div style={{ fontSize: 11, opacity: 0.65 }}>
                      {u.role ? `${u.role} · ` : ""}
                      {u.status || ""}
                    </div>
                  </button>
                );
              })}
          </div>
        )}
      </div>

      <div style={{ fontSize: 11, opacity: 0.7 }}>
        Stores an array of user IDs.
        {roleFilter ? ` Filter: ${roleFilter}.` : ""}{" "}
        {onlyActive ? "Active only." : "Includes inactive."}
      </div>
    </div>
  );
}

/** Simple NAME field with subfields */
function NameField({ field, value, onChange }) {
  const v = value && typeof value === "object" ? value : {};
  const set = (patch) => onChange({ ...v, ...patch });
  const titleCfg = subCfg(field, "title", "Title");
  const firstCfg = subCfg(field, "first", "First");
  const middleCfg = subCfg(field, "middle", "Middle");
  const lastCfg = subCfg(field, "last", "Last");
  const maidenCfg = subCfg(field, "maiden", "Maiden");
  const suffixCfg = subCfg(field, "suffix", "Suffix");
  const titles = ["", "Mr", "Ms", "Mrs", "Mx", "Dr", "Prof", "Rev"];

  return (
    <div style={{ display: "grid", gap: 8, maxWidth: 520 }}>
      {titleCfg.show && (
        <div>
          <label style={{ fontSize: 12, opacity: 0.8, display: "block" }}>
            {titleCfg.label}
          </label>
          <select
            value={v.title || ""}
            onChange={(e) => set({ title: e.target.value || undefined })}
          >
            {titles.map((t) => (
              <option key={t} value={t}>
                {t || "—"}
              </option>
            ))}
          </select>
        </div>
      )}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
        {firstCfg.show && (
          <div>
            <label style={{ fontSize: 12, opacity: 0.8, display: "block" }}>
              {firstCfg.label}
            </label>
            <input
              value={v.first || ""}
              onChange={(e) => set({ first: e.target.value })}
            />
          </div>
        )}
        {middleCfg.show && (
          <div>
            <label style={{ fontSize: 12, opacity: 0.8, display: "block" }}>
              {middleCfg.label}
            </label>
            <input
              value={v.middle || ""}
              onChange={(e) => set({ middle: e.target.value })}
            />
          </div>
        )}
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
        {lastCfg.show && (
          <div>
            <label style={{ fontSize: 12, opacity: 0.8, display: "block" }}>
              {lastCfg.label}
            </label>
            <input
              value={v.last || ""}
              onChange={(e) => set({ last: e.target.value })}
            />
          </div>
        )}
        {maidenCfg.show && (
          <div>
            <label style={{ fontSize: 12, opacity: 0.8, display: "block" }}>
              {maidenCfg.label}
            </label>
            <input
              value={v.maiden || ""}
              onChange={(e) => set({ maiden: e.target.value })}
            />
          </div>
        )}
      </div>
      {suffixCfg.show && (
        <div>
          <label style={{ fontSize: 12, opacity: 0.8, display: "block" }}>
            {suffixCfg.label}
          </label>
          <input
            value={v.suffix || ""}
            onChange={(e) => set({ suffix: e.target.value })}
          />
        </div>
      )}
    </div>
  );
}

/** ADDRESS field with subfields */
function AddressField({ field, value, onChange }) {
  const base = {
    line1: "",
    line2: "",
    city: "",
    state: "",
    postal: "",
    country: "",
  };
  const a = { ...base, ...(typeof value === "object" && value ? value : {}) };
  const set = (patch) => onChange({ ...a, ...patch });

  const cfg = {
    line1: subCfg(field, "line1", "Address line 1", true),
    line2: subCfg(field, "line2", "Address line 2", true),
    city: subCfg(field, "city", "City", true),
    state: subCfg(field, "state", "State/Province", true),
    postal: subCfg(field, "postal", "ZIP/Postal", true),
    country: subCfg(field, "country", "Country", true),
  };

  return (
    <div
      className="field-address"
      style={{ display: "grid", gap: 8, maxWidth: 520 }}
    >
      {cfg.line1.show && (
        <div>
          <label style={{ fontSize: 12, opacity: 0.8, display: "block" }}>
            {cfg.line1.label}
          </label>
          <input
            value={a.line1}
            onChange={(e) => set({ line1: e.target.value })}
          />
        </div>
      )}
      {cfg.line2.show && (
        <div>
          <label style={{ fontSize: 12, opacity: 0.8, display: "block" }}>
            {cfg.line2.label}
          </label>
          <input
            value={a.line2}
            onChange={(e) => set({ line2: e.target.value })}
          />
        </div>
      )}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
        {cfg.city.show && (
          <div>
            <label style={{ fontSize: 12, opacity: 0.8, display: "block" }}>
              {cfg.city.label}
            </label>
            <input
              value={a.city}
              onChange={(e) => set({ city: e.target.value })}
            />
          </div>
        )}
        {cfg.state.show && (
          <div>
            <label style={{ fontSize: 12, opacity: 0.8, display: "block" }}>
              {cfg.state.label}
            </label>
            <input
              value={a.state}
              onChange={(e) => set({ state: e.target.value })}
            />
          </div>
        )}
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
        {cfg.postal.show && (
          <div>
            <label style={{ fontSize: 12, opacity: 0.8, display: "block" }}>
              {cfg.postal.label}
            </label>
            <input
              value={a.postal}
              onChange={(e) => set({ postal: e.target.value })}
            />
          </div>
        )}
        {cfg.country.show && (
          <div>
            <label style={{ fontSize: 12, opacity: 0.8, display: "block" }}>
              {cfg.country.label}
            </label>
            <input
              value={a.country}
              onChange={(e) => set({ country: e.target.value })}
            />
          </div>
        )}
      </div>
    </div>
  );
}

/**
 * Helpers for media fields
 */
function fieldVisibility(field) {
  const cfg = getFieldConfig(field);
  return cfg?.visibility === "private" ? "private" : "public";
}
function fieldFolder(field) {
  const cfg = getFieldConfig(field);
  return cfg?.folder || field.key || "uploads";
}

/**
 * Image upload UI (Supabase Storage)
 */
function ImageField({ field, value, onChange, entryContext }) {
  const [busy, setBusy] = useState(false);
  const cfg = getFieldConfig(field);

  const visibility = fieldVisibility(field);
  const bucket = resolveBucketName(visibility === "private" ? "private" : "public");
  const pathPrefix = `${fieldFolder(field)}/${entryContext?.typeSlug || "unknown"}/${entryContext?.entryId || "new"}`;

  const altCfg = subCfg(field, "alt", "Alt text");
  const titleCfg = subCfg(field, "title", "Title");
  const captionCfg = subCfg(field, "caption", "Caption");
  const creditCfg = subCfg(field, "credit", "Credit");

  const imageUrl = useMemo(() => {
    if (visibility === "public") return value?.publicUrl || null;
    return null;
  }, [value, visibility]);

  async function handleUpload(e) {
    const file = e.target.files?.[0];
    if (!file) return;

    const policy = resolveUploadPolicy(cfg || {});
    const accept = policy.accept || "image/*";
    const maxMB = Number(policy.maxSizeMB) || null;

    const typeOk =
      !accept ||
      accept.split(",").some((p) => {
        p = p.trim();
        if (!p) return true;
        if (p.endsWith("/*")) return file.type.startsWith(p.slice(0, -1));
        return file.type === p;
      });

    if (!typeOk) {
      alert(`Invalid file type: ${file.type}`);
      e.target.value = "";
      return;
    }
    if (maxMB && file.size > maxMB * 1024 * 1024) {
      alert(`File is too large. Max ${maxMB} MB.`);
      e.target.value = "";
      return;
    }

    setBusy(true);
    try {
      const meta = await uploadToSupabase(file, {
        bucket,
        pathPrefix,
        makePublic: visibility === "public",
      });
      onChange({
        ...(value || {}),
        ...meta,
        alt: value?.alt || "",
        title: value?.title || "",
        caption: value?.caption || "",
        credit: value?.credit || "",
        mime: file.type,
        size: file.size,
      });
    } catch (err) {
      alert(`Upload failed: ${err.message}`);
    } finally {
      setBusy(false);
      e.target.value = "";
    }
  }

  async function copySignedLink() {
    if (!value?.bucket || !value?.path) return;
    try {
      const url = await getSignedUrl(value.bucket, value.path, 3600);
      await navigator.clipboard.writeText(url);
      alert("Signed URL copied (valid 1h).");
    } catch {
      alert("Could not create signed URL.");
    }
  }

  const acceptAttr = resolveUploadPolicy(cfg || {}).accept || "image/*";

  return (
    <div style={{ display: "grid", gap: 6 }}>
      {imageUrl ? (
        <img src={imageUrl} alt={value?.alt || ""} style={{ maxWidth: 240 }} />
      ) : (
        <small>No image selected</small>
      )}
      <input placeholder="Image URL" value={imageUrl || ""} readOnly />
      {altCfg.show && (
        <input
          placeholder={altCfg.label}
          value={value?.alt || ""}
          onChange={(e) => onChange({ ...(value || {}), alt: e.target.value })}
        />
      )}
      {titleCfg.show && (
        <input
          placeholder={titleCfg.label}
          value={value?.title || ""}
          onChange={(e) => onChange({ ...(value || {}), title: e.target.value })}
        />
      )}
      {captionCfg.show && (
        <input
          placeholder={captionCfg.label}
          value={value?.caption || ""}
          onChange={(e) =>
            onChange({ ...(value || {}), caption: e.target.value })
          }
        />
      )}
      {creditCfg.show && (
        <input
          placeholder={creditCfg.label}
          value={value?.credit || ""}
          onChange={(e) =>
            onChange({ ...(value || {}), credit: e.target.value })
          }
        />
      )}
      <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
        <input
          type="file"
          accept={acceptAttr}
          onChange={handleUpload}
          disabled={busy}
        />
        {visibility === "private" && value?.path && (
          <button type="button" onClick={copySignedLink} disabled={busy}>
            Copy signed URL
          </button>
        )}
      </div>
    </div>
  );
}

/**
 * Generic file upload UI
 *  "Preview" modal for PDF/DOC/DOCX
 */
function FileField({ field, value, onChange, entryContext, accept }) {
  const [busy, setBusy] = useState(false);
  const [previewOpen, setPreviewOpen] = useState(false);
  const [previewBusy, setPreviewBusy] = useState(false);
  const [previewUrl, setPreviewUrl] = useState("");
  const [previewErr, setPreviewErr] = useState("");

  const cfg = getFieldConfig(field);

  // ✅ New knobs
  const dragDropDesktop = cfg?.dragDropDesktop !== false; // default ON
  const multipleUploads = !!(cfg?.multipleUploads); // ONLY for files/videos/images (we’ll set in QuickBuilder)

  const visibility = fieldVisibility(field);
  const bucket = resolveBucketName(visibility === "private" ? "private" : "public");
  const pathPrefix = `${fieldFolder(field)}/${entryContext?.typeSlug || "unknown"}/${entryContext?.entryId || "new"}`;

  const titleCfg = subCfg(field, "title", "Title");
  const captionCfg = subCfg(field, "caption", "Caption");
  const creditCfg = subCfg(field, "credit", "Credit");

  const policy = resolveUploadPolicy(cfg || {});
  const acceptCombined = policy.accept || accept;
  const maxMB = Number(policy.maxSizeMB) || null;

  async function uploadOne(file) {
    if (!validateFileAgainstAccept(file, acceptCombined)) {
      alert(`Invalid file type: ${file.type || file.name}`);
      return null;
    }
    if (maxMB && file.size > maxMB * 1024 * 1024) {
      alert(`File is too large. Max ${maxMB} MB.`);
      return null;
    }

    const meta = await uploadToSupabase(file, {
      bucket,
      pathPrefix,
      makePublic: visibility === "public",
    });

    // For multipleUploads: keep it simple (no title/caption/credit)
    if (multipleUploads) {
      return {
        ...meta,
        name: file.name,
        mime: file.type,
        size: file.size,
      };
    }

    // Single: preserve your subfields
    return {
      ...meta,
      name: file.name,
      mime: file.type,
      size: file.size,
      title: value?.title || "",
      caption: value?.caption || "",
      credit: value?.credit || "",
    };
  }

  async function handleFiles(fileList) {
    const files = Array.from(fileList || []);
    if (!files.length) return;

    setBusy(true);
    try {
      if (!multipleUploads) {
        const first = files[0];
        const uploaded = await uploadOne(first);
        if (uploaded) onChange(uploaded);
        return;
      }

      // multipleUploads = true
      const current = Array.isArray(value) ? value : [];
      const uploadedAll = [];

      // sequential keeps it safe for rate limits; switch to Promise.all if you want
      for (const f of files) {
        const up = await uploadOne(f);
        if (up) uploadedAll.push(up);
      }

      if (uploadedAll.length) onChange([...(current || []), ...uploadedAll]);
    } catch (err) {
      alert(`Upload failed: ${err.message}`);
    } finally {
      setBusy(false);
    }
  }

  async function copySignedLink(v) {
    if (!v?.bucket || !v?.path) return;
    try {
      const url = await getSignedUrl(v.bucket, v.path, 3600);
      await navigator.clipboard.writeText(url);
      alert("Signed URL copied (1h).");
    } catch {
      alert("Could not create signed URL.");
    }
  }

  async function openPreview(v) {
    setPreviewErr("");
    setPreviewOpen(true);

    const kind = getPreviewTypeFromFile(v);
    if (!v?.bucket || !v?.path) {
      setPreviewErr("No file found to preview.");
      return;
    }

    setPreviewBusy(true);
    try {
      let url = v.publicUrl;
      if (!url) url = await getSignedUrl(v.bucket, v.path, 60 * 60);

      if (!url) throw new Error("Could not generate a preview URL.");

      if (kind === "pdf") {
        setPreviewUrl(url);
      } else if (kind === "docx" || kind === "doc") {
        const office = `https://view.officeapps.live.com/op/embed.aspx?src=${encodeURIComponent(url)}`;
        setPreviewUrl(office);
      } else {
        setPreviewErr("Preview not available for this file type.");
        setPreviewUrl("");
      }
    } catch (e) {
      setPreviewErr(e?.message || "Failed to open preview");
      setPreviewUrl("");
    } finally {
      setPreviewBusy(false);
    }
  }

  const renderSingle = () => {
    const canPreview = (() => {
      if (!value?.bucket || !value?.path) return false;
      const kind = getPreviewTypeFromFile(value);
      return kind === "pdf" || kind === "docx" || kind === "doc";
    })();

    return (
      <div style={{ display: "grid", gap: 6 }}>
        <input placeholder="File name" value={value?.name || ""} readOnly />

        {dragDropDesktop ? (
          <DropzoneButton
            disabled={busy}
            accept={acceptCombined}
            multiple={false}
            onFiles={handleFiles}
            label="Click or drag a file here"
          />
        ) : (
          <input
            type="file"
            accept={acceptCombined}
            onChange={(e) => handleFiles(e.target.files)}
            disabled={busy}
          />
        )}

        <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
          {canPreview && (
            <button type="button" className="su-btn primary" onClick={() => openPreview(value)}>
              Preview
            </button>
          )}

          {visibility === "private" && value?.path && (
            <button type="button" onClick={() => copySignedLink(value)} disabled={busy}>
              Copy signed URL
            </button>
          )}

          {visibility === "public" && value?.publicUrl && (
            <a
              className="su-btn"
              href={value.publicUrl}
              target="_blank"
              rel="noreferrer"
              style={{ textDecoration: "none" }}
            >
              Open in new tab
            </a>
          )}
        </div>

        {titleCfg.show && (
          <input
            placeholder={titleCfg.label}
            value={value?.title || ""}
            onChange={(e) => onChange({ ...(value || {}), title: e.target.value })}
          />
        )}
        {captionCfg.show && (
          <input
            placeholder={captionCfg.label}
            value={value?.caption || ""}
            onChange={(e) => onChange({ ...(value || {}), caption: e.target.value })}
          />
        )}
        {creditCfg.show && (
          <input
            placeholder={creditCfg.label}
            value={value?.credit || ""}
            onChange={(e) => onChange({ ...(value || {}), credit: e.target.value })}
          />
        )}

        {visibility === "public" && value?.publicUrl && <small>Public URL: {value.publicUrl}</small>}

        <Modal
          open={previewOpen}
          onClose={() => {
            setPreviewOpen(false);
            setPreviewUrl("");
            setPreviewErr("");
          }}
          title={value?.name ? `Preview: ${value.name}` : "Preview"}
        >
          {previewBusy ? (
            <div style={{ padding: 16, fontSize: 13, opacity: 0.75 }}>Loading preview…</div>
          ) : previewErr ? (
            <div style={{ padding: 16, fontSize: 13, color: "#b91c1c" }}>{previewErr}</div>
          ) : previewUrl ? (
            <iframe title="Document preview" src={previewUrl} style={{ width: "100%", height: "100%", border: "none" }} />
          ) : (
            <div style={{ padding: 16, fontSize: 13, opacity: 0.75 }}>No preview available.</div>
          )}
        </Modal>
      </div>
    );
  };

  const renderMultiple = () => {
    const list = Array.isArray(value) ? value : [];

    return (
      <div style={{ display: "grid", gap: 10 }}>
        {dragDropDesktop ? (
          <DropzoneButton
            disabled={busy}
            accept={acceptCombined}
            multiple={true}
            onFiles={handleFiles}
            label="Click or drag files here"
          />
        ) : (
          <input
            type="file"
            accept={acceptCombined}
            multiple
            onChange={(e) => handleFiles(e.target.files)}
            disabled={busy}
          />
        )}

        {list.length ? (
          <div style={{ display: "grid", gap: 8 }}>
            {list.map((f, idx) => {
              const canPreview = (() => {
                if (!f?.bucket || !f?.path) return false;
                const kind = getPreviewTypeFromFile(f);
                return kind === "pdf" || kind === "docx" || kind === "doc";
              })();

              return (
                <div
                  key={`${f?.path || f?.name || "file"}-${idx}`}
                  style={{
                    border: "1px solid var(--su-border, #e5e7eb)",
                    borderRadius: 12,
                    padding: 10,
                    background: "var(--su-surface, #fff)",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "space-between",
                    gap: 10,
                  }}
                >
                  <div style={{ minWidth: 0 }}>
                    <div style={{ fontSize: 13, fontWeight: 700, overflow: "hidden", textOverflow: "ellipsis" }}>
                      {f?.name || f?.path || "(file)"}
                    </div>
                    <div style={{ fontSize: 11, opacity: 0.7 }}>
                      {f?.mime ? f.mime : ""} {f?.size ? `· ${(f.size / 1024 / 1024).toFixed(2)} MB` : ""}
                    </div>
                  </div>

                  <div style={{ display: "flex", gap: 8, flexWrap: "wrap", justifyContent: "flex-end" }}>
                    {canPreview && (
                      <button type="button" className="su-btn" onClick={() => openPreview(f)}>
                        Preview
                      </button>
                    )}
                    {visibility === "private" && f?.path && (
                      <button type="button" className="su-btn" onClick={() => copySignedLink(f)} disabled={busy}>
                        Copy link
                      </button>
                    )}
                    {visibility === "public" && f?.publicUrl && (
                      <a className="su-btn" href={f.publicUrl} target="_blank" rel="noreferrer" style={{ textDecoration: "none" }}>
                        Open
                      </a>
                    )}
                    <button
                      type="button"
                      className="su-btn"
                      onClick={() => {
                        const next = list.filter((_, i) => i !== idx);
                        onChange(next);
                      }}
                      disabled={busy}
                      style={{ borderColor: "#fecaca", background: "#fef2f2", color: "#b91c1c" }}
                    >
                      Remove
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        ) : (
          <div style={{ fontSize: 12, opacity: 0.7 }}>No files uploaded yet.</div>
        )}

        <Modal
          open={previewOpen}
          onClose={() => {
            setPreviewOpen(false);
            setPreviewUrl("");
            setPreviewErr("");
          }}
          title="Preview"
        >
          {previewBusy ? (
            <div style={{ padding: 16, fontSize: 13, opacity: 0.75 }}>Loading preview…</div>
          ) : previewErr ? (
            <div style={{ padding: 16, fontSize: 13, color: "#b91c1c" }}>{previewErr}</div>
          ) : previewUrl ? (
            <iframe title="Document preview" src={previewUrl} style={{ width: "100%", height: "100%", border: "none" }} />
          ) : (
            <div style={{ padding: 16, fontSize: 13, opacity: 0.75 }}>No preview available.</div>
          )}
        </Modal>
      </div>
    );
  };

  return multipleUploads ? renderMultiple() : renderSingle();
}

function coerceArray(v) {
  return Array.isArray(v) ? v : [];
}

function isEmptyValue(v) {
  if (v == null) return true;
  if (typeof v === "string") return v.trim() === "";
  if (Array.isArray(v)) return v.length === 0;
  if (typeof v === "object") return Object.keys(v).length === 0;
  return false;
}

function cmp(a, b) {
  const sa = a == null ? "" : String(a);
  const sb = b == null ? "" : String(b);
  return { sa, sb };
}

function evalRule({ row, rule }) {
  const ifKey = String(rule?.ifKey || "").trim();
  const op = String(rule?.op || "equals").trim();
  const val = rule?.value;

  const actual = ifKey ? row?.[ifKey] : undefined;

  if (op === "truthy") return !isEmptyValue(actual);
  if (op === "falsy") return isEmptyValue(actual);

  const { sa, sb } = cmp(actual, val);

  // numeric compare if both parse
  const na = Number(actual);
  const nb = Number(val);
  const bothNum = !Number.isNaN(na) && !Number.isNaN(nb);

  switch (op) {
    case "equals":
      return sa === sb;
    case "not_equals":
      return sa !== sb;
    case "contains":
      return sa.toLowerCase().includes(sb.toLowerCase());
    case "not_contains":
      return !sa.toLowerCase().includes(sb.toLowerCase());
    case "gt":
      return bothNum ? na > nb : sa > sb;
    case "gte":
      return bothNum ? na >= nb : sa >= sb;
    case "lt":
      return bothNum ? na < nb : sa < sb;
    case "lte":
      return bothNum ? na <= nb : sa <= sb;
    default:
      return sa === sb;
  }
}

function computeSubfieldVisibility({ subfields, rules, row }) {
  // default: all visible
  const vis = {};
  for (const sf of subfields) {
    const k = String(sf?.field_key || sf?.key || "").trim();
    if (k) vis[k] = true;
  }

  const list = Array.isArray(rules) ? rules : [];
  for (const r of list) {
    const ok = evalRule({ row, rule: r });
    if (!ok) continue;

    const targets = Array.isArray(r?.targets) ? r.targets : [];
    const action = String(r?.action || "show");
    for (const t of targets) {
      const k = String(t || "").trim();
      if (!k) continue;
      if (action === "hide") vis[k] = false;
      else vis[k] = true;
    }
  }

  return vis;
}

function applyRowLabelTemplate(tpl, row, index) {
  const s = String(tpl || "").trim();
  if (!s) return `Row ${index + 1}`;
  return s
    .replace(/\{#\}/g, String(index + 1))
    .replace(/\{([^}]+)\}/g, (_, k) => {
      const key = String(k || "").trim();
      if (!key) return "";
      const v = row?.[key];
      return v == null ? "" : String(v);
    });
}

function RepeaterField({
  field,
  value,
  onChange,
  entryContext,
  resolved,
  relatedCache,
  choicesCache,
  depth = 1,
}) {
  const cfg = getFieldConfig(field);
  const subfields = Array.isArray(cfg.subfields) ? cfg.subfields : [];

  const rows = coerceArray(value).map((r) => (r && typeof r === "object" ? r : {}));

  const minRows = Number.isFinite(cfg.minRows) ? Number(cfg.minRows) : null;
  const maxRows = Number.isFinite(cfg.maxRows) ? Number(cfg.maxRows) : null;

  const addLabel = cfg.addLabel || "Add row";
  const layout = cfg.layout || "cards"; // cards | table
  const maxDepth = Number.isFinite(cfg.maxDepth) ? Number(cfg.maxDepth) : 2;
  const rowLabelTemplate = cfg.rowLabelTemplate || "";

  const rules = Array.isArray(cfg.rules) ? cfg.rules : [];

  function setRows(next) {
    onChange(next);
  }

  function setRow(i, patch) {
    const next = [...rows];
    const base = next[i] && typeof next[i] === "object" ? next[i] : {};
    next[i] = { ...base, ...patch };
    setRows(next);
  }

  function addRow() {
    if (maxRows != null && rows.length >= maxRows) return;
    setRows([...(rows || []), {}]);
  }

  function removeRow(i) {
    if (minRows != null && rows.length <= minRows) return;
    setRows(rows.filter((_, idx) => idx !== i));
  }

  function duplicateRow(i) {
    if (maxRows != null && rows.length >= maxRows) return;
    const next = [...rows];
    const clone = JSON.parse(JSON.stringify(next[i] || {}));
    next.splice(i + 1, 0, clone);
    setRows(next);
  }

  // controlled nesting: if a subfield is repeater but depth >= maxDepth, we show a warning
  function canNestMore() {
    return depth < maxDepth;
  }

  function renderSubfieldCell({ sf, rowIndex, row, hideLabel }) {
    const key = String(sf?.field_key || sf?.key || "").trim();
    if (!key) return null;

    const visibility = computeSubfieldVisibility({ subfields, rules, row });
    if (visibility[key] === false) return null;

    const def = { ...sf, key };

    // enforce nesting depth
    const sfType = String(def.type || "text").toLowerCase();
    if (sfType === "repeater" && !canNestMore()) {
      return (
        <div
          key={key}
          style={{
            border: "1px solid rgba(0,0,0,0.08)",
            borderRadius: 12,
            padding: 10,
            background: "rgba(0,0,0,0.02)",
            fontSize: 12,
            opacity: 0.8,
          }}
        >
          Nested repeater disabled at depth {depth}. Increase “Max nesting depth”
          on the parent repeater config.
        </div>
      );
    }

    const val = row?.[key];

    return (
      <div key={key} style={{ display: "grid", gap: 6 }}>
        {!hideLabel && (
          <label style={{ fontSize: 13, fontWeight: 600 }}>
            {def.label || key}
          </label>
        )}

        <FieldInput
          field={def}
          value={val}
          onChange={(nextVal) => setRow(rowIndex, { [key]: nextVal })}
          entryContext={entryContext}
          resolved={resolved}
          relatedCache={relatedCache}
          choicesCache={choicesCache}
          // ✅ pass depth to nested repeater via config (we read it in FieldInput when type===repeater)
          _repeaterDepth={depth + 1}
        />

        {!hideLabel && def.help_text ? (
          <div style={{ fontSize: 12, opacity: 0.7 }}>{def.help_text}</div>
        ) : null}
      </div>
    );
  }

  // Cards layout
  if (layout !== "table") {
    return (
      <div style={{ display: "grid", gap: 10 }}>
        {rows.map((row, rowIndex) => {
          const label = applyRowLabelTemplate(rowLabelTemplate, row, rowIndex);

          return (
            <div
              key={rowIndex}
              style={{
                border: "1px solid var(--su-border, #e5e7eb)",
                borderRadius: 12,
                padding: 10,
                background: "var(--su-surface, #fff)",
              }}
            >
              <div
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  gap: 8,
                }}
              >
                <div style={{ fontSize: 12, fontWeight: 700, opacity: 0.85 }}>
                  {label}
                </div>

                <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                  <button
                    type="button"
                    className="su-btn"
                    onClick={() => duplicateRow(rowIndex)}
                    disabled={maxRows != null && rows.length >= maxRows}
                    style={{ padding: "6px 10px" }}
                  >
                    Duplicate
                  </button>
                  <button
                    type="button"
                    className="su-btn"
                    onClick={() => removeRow(rowIndex)}
                    disabled={minRows != null && rows.length <= minRows}
                    style={{ padding: "6px 10px" }}
                  >
                    Remove
                  </button>
                </div>
              </div>

              <div style={{ display: "grid", gap: 10, marginTop: 10 }}>
                {subfields.map((sf) =>
                  renderSubfieldCell({
                    sf,
                    rowIndex,
                    row,
                    hideLabel: false,
                  })
                )}
              </div>
            </div>
          );
        })}

        <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
          <button
            type="button"
            className="su-btn primary"
            onClick={addRow}
            disabled={maxRows != null && rows.length >= maxRows}
          >
            {addLabel}
          </button>
          <div style={{ fontSize: 11, opacity: 0.7 }}>
            {minRows != null ? `Min ${minRows}. ` : ""}
            {maxRows != null ? `Max ${maxRows}. ` : ""}
            {rows.length} row{rows.length === 1 ? "" : "s"}.
          </div>
        </div>
      </div>
    );
  }

  // Table layout
  return (
    <div style={{ display: "grid", gap: 10 }}>
      <div style={{ overflowX: "auto" }}>
        <table className="min-w-full text-sm">
          <thead>
            <tr className="border-b border-gray-200 text-left">
              <th className="py-2 pr-2" style={{ minWidth: 140 }}>
                Row
              </th>
              {subfields
                .map((sf) => ({
                  key: String(sf?.field_key || sf?.key || "").trim(),
                  label: sf?.label,
                }))
                .filter((x) => x.key)
                .map((col) => (
                  <th key={col.key} className="py-2 pr-2" style={{ minWidth: 180 }}>
                    {col.label || col.key}
                  </th>
                ))}
              <th className="py-2 pr-2 text-right" style={{ minWidth: 160 }}>
                Actions
              </th>
            </tr>
          </thead>

          <tbody>
            {rows.map((row, rowIndex) => {
              const label = applyRowLabelTemplate(rowLabelTemplate, row, rowIndex);

              return (
                <tr key={rowIndex} className="border-b border-gray-100 align-top">
                  <td
                    className="py-2 pr-2"
                    style={{ fontSize: 12, fontWeight: 700, opacity: 0.85 }}
                  >
                    {label}
                  </td>

                  {subfields
                    .map((sf) => ({
                      sf,
                      key: String(sf?.field_key || sf?.key || "").trim(),
                    }))
                    .filter((x) => x.key)
                    .map(({ sf, key }) => (
                      <td key={key} className="py-2 pr-2">
                        {renderSubfieldCell({
                          sf,
                          rowIndex,
                          row,
                          hideLabel: true,
                        })}
                      </td>
                    ))}

                  <td className="py-2 pr-2 text-right">
                    <div style={{ display: "flex", justifyContent: "flex-end", gap: 8 }}>
                      <button
                        type="button"
                        className="su-btn"
                        onClick={() => duplicateRow(rowIndex)}
                        disabled={maxRows != null && rows.length >= maxRows}
                        style={{ padding: "6px 10px" }}
                      >
                        Duplicate
                      </button>
                      <button
                        type="button"
                        className="su-btn"
                        onClick={() => removeRow(rowIndex)}
                        disabled={minRows != null && rows.length <= minRows}
                        style={{ padding: "6px 10px" }}
                      >
                        Remove
                      </button>
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
        <button
          type="button"
          className="su-btn primary"
          onClick={addRow}
          disabled={maxRows != null && rows.length >= maxRows}
        >
          {addLabel}
        </button>
        <div style={{ fontSize: 11, opacity: 0.7 }}>
          {minRows != null ? `Min ${minRows}. ` : ""}
          {maxRows != null ? `Max ${maxRows}. ` : ""}
          {rows.length} row{rows.length === 1 ? "" : "s"}.
        </div>
      </div>
    </div>
  );
}

/** ------------------------------------------------------------------ */
/** LIST / WIDGET DISPLAY HELPER                                        */
/** ------------------------------------------------------------------ */
/**
 * Used by list views + widgets to display a field value as text.
 * Handles repeaters (including nested repeaters) safely.
 *
 * Usage:
 *   import { formatFieldValueForList } from "../components/FieldInput";
 *   const display = formatFieldValueForList(fieldDef, entry.data?.[fieldKey]);
 */
export function formatFieldValueForList(fieldDef, rawValue, opts = {}) {
  const type = (fieldDef?.type || "text").toString().trim().toLowerCase();
  const labelLimit = Number.isFinite(opts.labelLimit) ? opts.labelLimit : 3; // repeater rows shown
  const depth = Number.isFinite(opts.depth) ? opts.depth : 1;
  const maxDepth = Number.isFinite(opts.maxDepth) ? opts.maxDepth : 2;

  const cfg = getFieldConfig(fieldDef);

  const empty = (v) =>
    v == null ||
    (typeof v === "string" && v.trim() === "") ||
    (Array.isArray(v) && v.length === 0) ||
    (typeof v === "object" && !Array.isArray(v) && Object.keys(v).length === 0);

  if (empty(rawValue)) return "";

  // --- Repeaters ---
  if (type === "repeater") {
    const subfields = Array.isArray(cfg.subfields) ? cfg.subfields : [];
    const rows = Array.isArray(rawValue) ? rawValue : [];

    if (!rows.length) return "";

    // Prevent infinite recursion if someone nests repeaters deeper than intended
    if (depth > maxDepth) return `(${rows.length} rows)`;

    const pickKeys = subfields
      .map((sf) => String(sf?.field_key || sf?.key || "").trim())
      .filter(Boolean);

    const summarizeRow = (row, idx) => {
      const r = row && typeof row === "object" ? row : {};
      if (!pickKeys.length) return `Row ${idx + 1}`;

      // Grab first few meaningful values in the row
      const parts = [];
      for (const k of pickKeys) {
        const sf = subfields.find(
          (x) => String(x?.field_key || x?.key || "").trim() === k
        );
        const v = r?.[k];
        if (empty(v)) continue;

        const piece = formatFieldValueForList({ ...(sf || {}), key: k }, v, {
          labelLimit: 2,
          depth: depth + 1,
          maxDepth,
        });

        if (piece) parts.push(piece);
        if (parts.length >= 2) break; // keep rows compact
      }

      return parts.length ? parts.join(" · ") : `Row ${idx + 1}`;
    };

    const shown = rows.slice(0, labelLimit).map(summarizeRow);
    const more = rows.length - shown.length;

    return more > 0 ? `${shown.join(" | ")} | +${more} more` : shown.join(" | ");
  }

  // --- Choices / multi-choices ---
  if (["checkbox", "multiselect"].includes(type)) {
    const arr = Array.isArray(rawValue)
      ? rawValue
      : typeof rawValue === "string"
      ? rawValue
          .split(",")
          .map((s) => s.trim())
          .filter(Boolean)
      : [];
    return arr.join(", ");
  }

  if (["dropdown", "select", "radio"].includes(type)) {
    return rawValue == null ? "" : String(rawValue);
  }

  // --- Relation types ---
  if (type === "relation_user") {
    // Stored as user ID or array of IDs
    if (Array.isArray(rawValue)) return rawValue.map(String).join(", ");
    return String(rawValue);
  }

  if (type === "relation" || type === "relationship") {
    if (Array.isArray(rawValue)) return rawValue.map(String).join(", ");
    return String(rawValue);
  }

  // --- Date / Time / Datetime (pretty display) ---
  if (type === "date") {
    const style = cfg?.dateStyle || "long";
    const locale = cfg?.locale || "en-US";
    return rawValue ? fmtDateISO(String(rawValue), locale, style) : "";
  }

  if (type === "datetime") {
    const tz = cfg?.defaultTZ || "America/Los_Angeles";
    const locale = cfg?.locale || "en-US";

    const utc =
      rawValue && typeof rawValue === "object"
        ? rawValue.utc
        : rawValue
        ? String(rawValue)
        : "";

    return utc ? fmtDateTimeUTC(utc, tz, locale) : "";
  }

  if (type === "time") {
    const locale = cfg?.locale || "en-US";

    // rawValue can be "HH:mm" or an object { time, tz }
    const t =
      rawValue && typeof rawValue === "object"
        ? rawValue.time
        : typeof rawValue === "string"
        ? rawValue
        : "";

    if (!t) return "";

    // Dummy date so Intl can format; fmtTimeShortLower lowercases AM/PM
    const d = new Date(`1970-01-01T${t}:00Z`);
    return fmtTimeShortLower(d, locale);
  }

  // --- Common objects ---
  if (type === "name" && rawValue && typeof rawValue === "object") {
    const v = rawValue || {};
    const parts = [v.title, v.first, v.middle, v.last, v.suffix]
      .map((x) => (x == null ? "" : String(x).trim()))
      .filter(Boolean);
    return parts.join(" ");
  }

  if (type === "address" && rawValue && typeof rawValue === "object") {
    const v = rawValue || {};
    const parts = [v.line1, v.line2, v.city, v.state, v.postal, v.country]
      .map((x) => (x == null ? "" : String(x).trim()))
      .filter(Boolean);
    return parts.join(", ");
  }

  if (["file", "document", "image", "video"].includes(type)) {
    if (rawValue && typeof rawValue === "object") {
      return rawValue.name || rawValue.title || rawValue.path || "";
    }
    return "";
  }

  if (type === "color" && rawValue && typeof rawValue === "object") {
    return rawValue.hex || "";
  }

  if (type === "json") {
    try {
      return typeof rawValue === "string" ? rawValue : JSON.stringify(rawValue);
    } catch {
      return "[json]";
    }
  }

  if (typeof rawValue === "boolean") return rawValue ? "Yes" : "No";

  // --- Default ---
  return String(rawValue);
}

/** ------------------------------------------------------------------ */
/** ✅ ServiceUp FEATURE: Inline Edit Related Entry (modal)              */
/** ------------------------------------------------------------------ */

async function fetchContentTypeBySlug(slug) {
  const res = await api.get("/api/content-types");
  const list = Array.isArray(res) ? res : res?.data || [];
  const ct =
    list.find(
      (t) =>
        String(t.slug || "").toLowerCase() === String(slug || "").toLowerCase()
    ) || null;

  if (!ct?.id) return null;

  try {
    const full = await api.get(`/api/content-types/${ct.id}?all=true`);
    return full?.data || full || ct;
  } catch {
    return ct;
  }
}

function pickEditableFieldsFromInlineConfig({ allFields, inlineCfg }) {
  const allow = Array.isArray(inlineCfg?.fields)
    ? inlineCfg.fields.map(String)
    : null;

  const defs = (Array.isArray(allFields) ? allFields : [])
    .map((f) => {
      if (!f) return null;
      const key = f.field_key || f.key;
      return key ? { ...f, key } : null;
    })
    .filter(Boolean);

  if (!allow || !allow.length) return defs;

  const allowSet = new Set(allow);
  return defs.filter((d) => allowSet.has(d.key));
}

function InlineRelatedEditorModal({
  open,
  onClose,
  relSlug,
  relId,
  inlineCfg,
  relatedCache,
  choicesCache,
  renderMode = "modal", // "modal" | "inline"
}) {
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [ct, setCt] = useState(null);
  const [entry, setEntry] = useState(null);

  const [title, setTitle] = useState("");
  const [slug, setSlug] = useState("");
  const [status, setStatus] = useState("draft");
  const [data, setData] = useState({});

  const effectiveOpen = renderMode === "inline" ? true : open;

  useEffect(() => {
    let alive = true;

    async function load() {
      if (!effectiveOpen || !relSlug || !relId) return;

      setBusy(true);
      setErr("");

      try {
               // ✅ Load content type by slug (robust: uses /api/content-types list + id fetch)
        const ctRes = await fetchContentTypeBySlug(relSlug);
        if (!alive) return;

        if (!ctRes) {
          throw new Error(`Content type not found for slug: ${relSlug}`);
        }

        setCt(ctRes);

        // Load entry
        const eRes = await api.get(`/api/content/${encodeURIComponent(relSlug)}/${relId}`);

        if (!alive) return;

        setEntry(eRes);

        setTitle(eRes?.title || "");
        setSlug(eRes?.slug || "");
        setStatus(eRes?.status || "draft");
        setData(eRes?.data || {});
      } catch (e) {
        console.error(e);
        if (!alive) return;
        setErr(e?.message || "Failed to load related entry");
      } finally {
        if (alive) setBusy(false);
      }
    }

    load();
    return () => {
      alive = false;
    };
  }, [effectiveOpen, relSlug, relId]);

  if (!effectiveOpen) return null;
  if (!relSlug || !relId) return null;

  const allowed = Array.isArray(inlineCfg?.fields) ? inlineCfg.fields : [];
  const showCore = inlineCfg?.showCore === true;

  const fields = Array.isArray(ct?.fields) ? ct.fields : [];
    const allowedFields = allowed.length
    ? fields.filter((f) => allowed.includes(f.field_key || f.key))
    : fields;


  async function save() {
    if (!ct || !entry) return;
    setBusy(true);
    setErr("");

    try {
      await api.put(`/api/content/${encodeURIComponent(relSlug)}/${relId}`, {
        title,
        slug,
        status,
        data,
      });

      // (Optional) update any caches
      if (relatedCache && typeof relatedCache === "object") {
        // no-op here unless you want to mutate cache
      }

      if (renderMode === "modal") {
        onClose?.();
      }
    } catch (e) {
      console.error(e);
      setErr(e?.message || "Failed to save related entry");
    } finally {
      setBusy(false);
    }
  }

  const body = (
    <div style={{ display: "grid", gap: 10 }}>
      {renderMode === "inline" ? (
        <div style={{ fontSize: 12, fontWeight: 600, opacity: 0.9 }}>
          {inlineCfg?.title || "Edit related"}
        </div>
      ) : null}

      {err ? (
        <div style={{ color: "#b91c1c", fontSize: 12 }}>{err}</div>
      ) : null}

      {busy && !entry ? (
        <div style={{ fontSize: 12, opacity: 0.75 }}>Loading…</div>
      ) : null}

      {entry ? (
        <>
          {showCore ? (
            <div style={{ display: "grid", gap: 10 }}>
              <label style={{ display: "grid", gap: 4 }}>
                <span style={{ fontSize: 12, opacity: 0.8 }}>Title</span>
                <input
                  className="su-input"
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                />
              </label>

              <label style={{ display: "grid", gap: 4 }}>
                <span style={{ fontSize: 12, opacity: 0.8 }}>Slug</span>
                <input
                  className="su-input"
                  value={slug}
                  onChange={(e) => setSlug(e.target.value)}
                />
              </label>

              <label style={{ display: "grid", gap: 4 }}>
                <span style={{ fontSize: 12, opacity: 0.8 }}>Status</span>
                <select
                  className="su-input"
                  value={status}
                  onChange={(e) => setStatus(e.target.value)}
                >
                  <option value="draft">Draft</option>
                  <option value="published">Published</option>
                </select>
              </label>
            </div>
          ) : null}

          <div style={{ display: "grid", gap: 12 }}>
            {allowedFields.map((f) => {
              const k = f.field_key;
              return (
                <div key={k} style={{ display: "grid", gap: 6 }}>
                  <div style={{ fontSize: 12, fontWeight: 600 }}>
                    {f.label || k}
                  </div>

                  <FieldInput
                    field={f}
                    value={data?.[k]}
                    onChange={(val) =>
                      setData((prev) => ({ ...(prev || {}), [k]: val }))
                    }
                    relatedCache={relatedCache}
                    choicesCache={choicesCache}
                  />
                </div>
              );
            })}
          </div>

          <div style={{ display: "flex", justifyContent: "flex-end", gap: 8 }}>
            {renderMode === "modal" ? (
              <button
                type="button"
                className="su-btn su-btn-ghost"
                onClick={onClose}
                disabled={busy}
              >
                Close
              </button>
            ) : null}

            <button
              type="button"
              className="su-btn"
              onClick={save}
              disabled={busy}
            >
              {busy ? "Saving…" : "Save changes"}
            </button>
          </div>
        </>
      ) : null}
    </div>
  );

  if (renderMode === "inline") {
    return (
      <div
        style={{
          marginTop: 10,
          padding: 12,
          border: "1px solid rgba(0,0,0,.12)",
          borderRadius: 10,
          background: "rgba(0,0,0,.02)",
        }}
      >
        {body}
      </div>
    );
  }

  return (
    <Modal open={open} title={inlineCfg?.title || "Edit related"} onClose={onClose}>
      {body}
    </Modal>
  );
}


/** ------------------------------------------------------------------ */
/** ✅ UPDATED RelationEntryField: adds inline edit modal support         */
/** ------------------------------------------------------------------ */
function RelationEntryField({
  field,
  value,
  onChange,
  relatedCache,
  choicesCache,
}) {
  const cfg = getFieldConfig(field);

  // Pull target slug from multiple possible config shapes
  const relRaw =
    cfg?.relation?.contentType ??
    cfg?.relation?.slug ??
    cfg?.relatedType ??
    cfg?.contentType ??
    cfg?.targetType ??
    cfg?.target ??
    cfg?.sourceType ?? // <- important if your builder used "sourceType"
    null;

  const relSlug =
    relRaw && typeof relRaw === "object"
      ? relRaw.slug || relRaw.contentType || relRaw.relatedType || relRaw.id
      : relRaw;

  const allowMultiple = cfg?.relation?.kind === "many" || !!cfg?.multiple;

  // ✅ Inline edit config (new feature)
  const inlineCfg =
    cfg?.inlineEdit && typeof cfg.inlineEdit === "object" ? cfg.inlineEdit : {};
  const inlineEnabled = inlineCfg?.enabled === true;

  const selectedId = !allowMultiple && value ? String(value) : "";

  const [inlineOpen, setInlineOpen] = useState(false);

  // try cache first
  const cached =
    (relSlug && relatedCache?.[String(relSlug)]) ||
    (cfg?.relation?.id && relatedCache?.[String(cfg.relation.id)]) ||
    [];

  const [items, setItems] = React.useState(Array.isArray(cached) ? cached : []);
  const [loading, setLoading] = React.useState(false);
  const [err, setErr] = React.useState("");

  const REL_DEBUG =
    typeof window !== "undefined" &&
    (window.__suDebugRelations === true ||
      sessionStorage.getItem("__suDebugRelations") === "1");

  // If cache is empty, fetch directly (this fixes slug/id mismatches)
  React.useEffect(() => {
    let alive = true;

    async function load() {
      if (!relSlug) return;
      // If cache already has data, use it
      if (Array.isArray(cached) && cached.length) {
        setItems(cached);
        return;
      }

      setLoading(true);
      setErr("");
      try {
        const res = await api.get(
          `/api/content/${encodeURIComponent(relSlug)}?limit=200`
        );
        const data = res?.data ?? res;

        let list = [];

        if (Array.isArray(data)) {
          list = data;
        } else if (Array.isArray(data?.entries)) {
          list = data.entries;
        } else if (Array.isArray(data?.items)) {
          list = data.items;
        } else {
          list = [];
        }

        if (!alive) return;
        setItems(Array.isArray(list) ? list : []);
      } catch (e) {
        if (!alive) return;
        setErr(e?.message || "Failed to load related entries");
        setItems([]);
      } finally {
        if (alive) setLoading(false);
      }
    }

    load();
    return () => {
      alive = false;
    };
    // IMPORTANT: cached is derived; don’t include it in deps or you can loop
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [relSlug]);

  if (REL_DEBUG) {
    console.log("[RelationEntryField]", field?.field_key || field?.key, {
      relRaw,
      relSlug,
      cacheKeys: Object.keys(relatedCache || {}),
      cachedCount: Array.isArray(cached) ? cached.length : 0,
      itemsCount: Array.isArray(items) ? items.length : 0,
      loading,
      err,
    });
  }

  function labelFor(ent) {
    return (
      ent?.data?.title ||
      ent?.title ||
      ent?.data?.name ||
      ent?.name ||
      ent?.id
    );
  }

  if (!relSlug) {
    return (
      <div style={{ fontSize: 12, opacity: 0.7 }}>
        Relationship misconfigured (missing target content type).
      </div>
    );
  }

  if (!allowMultiple) {
    return (
      <div style={{ display: "grid", gap: 6 }}>
        <select value={value ?? ""} onChange={(e) => onChange(e.target.value)}>
          <option value="">— Select related —</option>
          {items.map((ent) => (
            <option key={ent.id} value={String(ent.id)}>
              {labelFor(ent)}
            </option>
          ))}
        </select>

                <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
          {(() => {
            const mode = inlineCfg?.mode || "modal"; // "inline" | "modal" | "both"
            const showButton =
              inlineEnabled && selectedId && (mode === "modal" || mode === "both");

            return showButton ? (
              <button
                type="button"
                className="su-btn"
                onClick={() => setInlineOpen(true)}
                style={{ padding: "6px 10px" }}
              >
                Edit selected
              </button>
            ) : null;
          })()}

          <div style={{ fontSize: 11, opacity: 0.7 }}>
            Source: {relSlug} {loading ? "· loading…" : ""}{" "}
            {err ? `· ${err}` : ""}
          </div>
        </div>

        {/* ✅ Inline edit (rendered under the relationship field) */}
        {(() => {
          const mode = inlineCfg?.mode || "modal"; // "inline" | "modal" | "both"
          const showInline =
            inlineEnabled && selectedId && (mode === "inline" || mode === "both");

          return showInline ? (
            <InlineRelatedEditorModal
              renderMode="inline"
              open={true}
              onClose={() => {}}
              relSlug={String(relSlug)}
              relId={selectedId}
              inlineCfg={inlineCfg}
              relatedCache={relatedCache}
              choicesCache={choicesCache}
            />
          ) : null;
        })()}

        {/* ✅ Inline edit modal (existing behavior) */}
        <InlineRelatedEditorModal
          open={inlineOpen}
          onClose={() => setInlineOpen(false)}
          relSlug={String(relSlug)}
          relId={selectedId}
          inlineCfg={inlineCfg}
          relatedCache={relatedCache}
          choicesCache={choicesCache}
        />
      </div>
    );
  }

  const current = Array.isArray(value)
    ? value.map(String)
    : value
    ? [String(value)]
    : [];
  const size = Math.min(8, Math.max(3, items.length || 3));

  return (
    <div style={{ display: "grid", gap: 6 }}>
      <select
        multiple
        size={size}
        value={current}
        onChange={(e) => {
          const selected = Array.from(e.target.selectedOptions).map(
            (o) => o.value
          );
          onChange(selected);
        }}
        style={{ minWidth: 260 }}
      >
        {items.map((ent) => (
          <option key={ent.id} value={String(ent.id)}>
            {labelFor(ent)}
          </option>
        ))}
      </select>
      <div style={{ fontSize: 11, opacity: 0.7 }}>
        Source: {relSlug} {loading ? "· loading…" : ""} {err ? `· ${err}` : ""}
      </div>
    </div>
  );
}

/**
 * FieldInput
 */
export default function FieldInput({
  field,
  value,
  onChange,
  relatedCache,
  choicesCache,
  entryContext,
  resolved,
  _repeaterDepth,
}) {
  const fieldType = (field?.type || "text").toString().trim().toLowerCase();
  const cfg = getFieldConfig(field);

  if (fieldType === "relation_user") {
    return (
      <UserRelationField
        field={field}
        value={value}
        onChange={onChange}
        resolved={resolved}
      />
    );
  }

  // Repeater
  if (fieldType === "repeater") {
    const depth = typeof _repeaterDepth === "number" ? _repeaterDepth : 1;
    return (
      <RepeaterField
        field={field}
        value={value}
        onChange={onChange}
        entryContext={entryContext}
        resolved={resolved}
        relatedCache={relatedCache}
        choicesCache={choicesCache}
        depth={depth}
      />
    );
  }

  // ---- Dynamic choice helpers ----
  const isChoice = ["radio", "dropdown", "checkbox", "select", "multiselect"].includes(fieldType);
  const isDynamic =
    isChoice && cfg && typeof cfg === "object" && (cfg.sourceType || cfg.optionsSource === "dynamic");

  let dynamicChoices = [];
  if (isDynamic) {
    const sourceType = cfg.sourceType;
    const sourceField = cfg.sourceField || "title";
    const list = choicesCache?.[sourceType] || [];
    dynamicChoices = list.map((ent) => {
      const v =
        (ent.data && (ent.data[sourceField] ?? ent.data.title)) ??
        ent.id;
      return { value: String(v), label: String(v) };
    });
  }

  // ---- Basic types ----
  if (fieldType === "text") {
    return <input type="text" value={value ?? ""} onChange={(e) => onChange(e.target.value)} />;
  }

  if (fieldType === "email") {
    return (
      <input
        type="email"
        value={value ?? ""}
        placeholder="email@example.com"
        onChange={(e) => onChange(e.target.value)}
      />
    );
  }

  if (fieldType === "phone") {
    return (
      <input
        type="tel"
        value={value ?? ""}
        placeholder="+1 760 660 1289"
        onChange={(e) => onChange(e.target.value)}
      />
    );
  }

  if (fieldType === "url") {
    return (
      <input
        type="url"
        value={value ?? ""}
        placeholder="https://example.com"
        onChange={(e) => onChange(e.target.value)}
      />
    );
  }

  if (fieldType === "textarea") {
    return <textarea value={value ?? ""} onChange={(e) => onChange(e.target.value)} />;
  }

  if (fieldType === "number") {
    return (
      <input
        type="number"
        inputMode="decimal"
        value={value ?? ""}
        min={cfg.min ?? undefined}
        max={cfg.max ?? undefined}
        step={cfg.step ?? (cfg.decimals ? "0.01" : "1")}
        onChange={(e) => {
          const v = e.target.value;
          if (v === "") return onChange(null);
          const n = Number(v);
          if (!Number.isNaN(n)) onChange(n);
        }}
      />
    );
  }

  // ---- Radio / Dropdown / Multiselect / Checkbox ----
  if (fieldType === "radio") {
    const baseChoices = isDynamic ? dynamicChoices : getFieldChoices(field);
    const choices = normalizeChoices(baseChoices);
    const current = value ?? "";
    return (
      <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
        {choices.map((opt) => (
          <label key={opt.value} style={{ display: "inline-flex", gap: 6, alignItems: "center" }}>
            <input
              type="radio"
              name={field.key}
              value={opt.value}
              checked={String(current) === String(opt.value)}
              onChange={(e) => onChange(e.target.value)}
            />
            {opt.label}
          </label>
        ))}
      </div>
    );
  }

  if (fieldType === "dropdown" || fieldType === "select") {
    const baseChoices = isDynamic ? dynamicChoices : getFieldChoices(field);
    const choices = normalizeChoices(baseChoices);
    return (
      <select value={value ?? ""} onChange={(e) => onChange(e.target.value)}>
        <option value="" disabled>
          Select…
        </option>
        {choices.map((opt) => (
          <option key={opt.value} value={opt.value}>
            {opt.label}
          </option>
        ))}
      </select>
    );
  }

  if (fieldType === "multiselect") {
    const baseChoices = isDynamic ? dynamicChoices : getFieldChoices(field);
    const choices = normalizeChoices(baseChoices);
    const selected = Array.isArray(value)
      ? value.map(String)
      : value
      ? String(value)
          .split(",")
          .map((v) => v.trim())
          .filter(Boolean)
      : [];

    return (
      <select
        multiple
        value={selected}
        onChange={(e) => {
          const vals = Array.from(e.target.selectedOptions || []).map((o) => o.value);
          onChange(vals);
        }}
      >
        {choices.map((opt) => (
          <option key={opt.value} value={opt.value}>
            {opt.label}
          </option>
        ))}
      </select>
    );
  }

  if (fieldType === "checkbox") {
    const baseChoices = isDynamic ? dynamicChoices : getFieldChoices(field);
    const choices = normalizeChoices(baseChoices);
    const current = Array.isArray(value) ? value.map(String) : [];
    return (
      <div>
        {choices.map((opt) => {
          const checked = current.includes(String(opt.value));
          return (
            <label key={opt.value} style={{ display: "block" }}>
              <input
                type="checkbox"
                checked={checked}
                onChange={() => {
                  const next = checked
                    ? current.filter((v) => v !== String(opt.value))
                    : [...current, String(opt.value)];
                  onChange(next);
                }}
              />
              {opt.label}
            </label>
          );
        })}
      </div>
    );
  }

  if (fieldType === "boolean") {
    return (
      <label>
        <input type="checkbox" checked={!!value} onChange={(e) => onChange(!!e.target.checked)} />{" "}
        {field.label}
      </label>
    );
  }

  // -- Relation ----
  if (fieldType === "relation" || fieldType === "relationship") {
    return (
      <RelationEntryField
        field={field}
        value={value}
        onChange={onChange}
        relatedCache={relatedCache}
        choicesCache={choicesCache}
      />
    );
  }

  // ---- Advanced ----
  if (fieldType === "rich_text") {
    return <RichTextEditor value={value} onChange={onChange} options={{ headings: [1, 2, 3, 4] }} />;
  }

  if (fieldType === "time") {
    const t =
      value && typeof value === "object"
        ? value.time || ""
        : typeof value === "string"
        ? value
        : "";
    const tz =
      value && typeof value === "object" && value.tz
        ? value.tz
        : Intl.DateTimeFormat().resolvedOptions().timeZone;

    return (
      <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
        <input type="time" value={t} onChange={(e) => onChange({ time: e.target.value, tz })} step="60" />
        <span style={{ fontSize: 12, opacity: 0.7 }}>{tz}</span>
      </div>
    );
  }

  if (fieldType === "date") {
    const iso = typeof value === "string" ? value : "";
    const style = cfg?.dateStyle || "long"; // long | medium | short
    const locale = cfg?.locale || "en-US";

    return (
      <div style={{ display: "grid", gap: 6 }}>
        <input
          type="date"
          value={iso || ""}
          onChange={(e) => onChange(e.target.value || "")}
        />
        {iso ? (
          <small style={{ opacity: 0.75 }}>
            {fmtDateISO(iso, locale, style)}
          </small>
        ) : null}
      </div>
    );
  }

  if (fieldType === "datetime") {
    const tz = cfg?.defaultTZ || "America/Los_Angeles";
    const locale = cfg?.locale || "en-US";

    // Stored shape: { utc: "...", sourceTZ: "..." }
    const v =
      value && typeof value === "object"
        ? value
        : value
        ? { utc: String(value), sourceTZ: tz }
        : { utc: "", sourceTZ: tz };

    const [date, setDate] = useState("");
    const [time, setTime] = useState("");

    // Prefill local date/time from saved UTC
    useEffect(() => {
      if (!v?.utc) {
        setDate("");
        setTime("");
        return;
      }
      try {
        const dt = DateTime.fromISO(v.utc, { zone: "utc" }).setZone(tz);
        setDate(dt.toFormat("yyyy-LL-dd"));
        setTime(dt.toFormat("HH:mm"));
      } catch {
        // ignore
      }
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [v?.utc, tz]);

    const canSave = !!date && !!time;

    function save() {
      if (!canSave) return;
      onChange({
        utc: combineDateAndTimeToUTC(date, time, tz),
        sourceTZ: tz,
      });
    }

    return (
      <div style={{ display: "grid", gap: 6 }}>
        <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
          <input
            type="date"
            value={date}
            onChange={(e) => {
              const next = e.target.value;
              setDate(next);
              // auto-save if time already chosen
              if (next && time) {
                onChange({ utc: combineDateAndTimeToUTC(next, time, tz), sourceTZ: tz });
              }
            }}
          />
          <input
            type="time"
            value={time}
            onChange={(e) => {
              const next = e.target.value;
              setTime(next);
              // auto-save if date already chosen
              if (date && next) {
                onChange({ utc: combineDateAndTimeToUTC(date, next, tz), sourceTZ: tz });
              }
            }}
            step="60"
          />
          <button type="button" onClick={save} disabled={!canSave}>
            Set
          </button>
          <small style={{ opacity: 0.7 }}>TZ: {tz}</small>
        </div>

        {v?.utc ? (
          <small style={{ opacity: 0.8 }}>
            {fmtDateTimeUTC(v.utc, tz, locale)}
          </small>
        ) : null}
      </div>
    );
  }

  if (fieldType === "daterange") {
    const tz = cfg?.defaultTZ || Intl.DateTimeFormat().resolvedOptions().timeZone;
    const v = value || { start: "", end: "", allDay: true, tz };
    const allDay = v.allDay !== false;

    return (
      <div style={{ display: "grid", gap: 6 }}>
        <label style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
          <input
            type="checkbox"
            checked={allDay}
            onChange={(e) => onChange({ ...v, allDay: !!e.target.checked })}
          />{" "}
          All day
        </label>
        <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
          <input type="date" value={v.start || ""} onChange={(e) => onChange({ ...v, start: e.target.value })} />
          {!allDay && (
            <input
              type="time"
              value={v.startTime || ""}
              onChange={(e) => onChange({ ...v, startTime: e.target.value })}
              step="60"
            />
          )}
          <span>–</span>
          <input type="date" value={v.end || ""} onChange={(e) => onChange({ ...v, end: e.target.value })} />
          {!allDay && (
            <input
              type="time"
              value={v.endTime || ""}
              onChange={(e) => onChange({ ...v, endTime: e.target.value })}
              step="60"
            />
          )}
        </div>
        <small>Timezone: {tz}</small>
      </div>
    );
  }

  if (fieldType === "color") {
    const v = value || { hex: "#000000" };
    const against = cfg?.requireContrastAgainst || "#ffffff";
    let ratio = null;
    try {
      ratio = contrastRatio(v.hex || "#000000", against);
    } catch {
      ratio = null;
    }

    return (
      <div style={{ display: "grid", gap: 8 }}>
        <input type="color" value={v.hex || "#000000"} onChange={(e) => onChange({ ...v, hex: e.target.value })} />
        <input
          placeholder="#rrggbb"
          value={v.hex || ""}
          onChange={(e) => {
            try {
              onChange({ ...v, hex: normalizeHex(e.target.value) });
            } catch {
              onChange({ ...v, hex: e.target.value });
            }
          }}
        />
        {ratio ? <small>Contrast vs {against}: {ratio}:1</small> : null}
      </div>
    );
  }

  // ---- Media ----
  if (fieldType === "image") {
    return <ImageField field={field} value={value} onChange={onChange} entryContext={entryContext} />;
  }
  if (fieldType === "file" || fieldType === "document") {
    const accept = cfg?.accept;
    return <FileField field={field} value={value} onChange={onChange} entryContext={entryContext} accept={accept} />;
  }
  if (fieldType === "video") {
    const accept = cfg?.accept || "video/*";
    return <FileField field={field} value={value} onChange={onChange} entryContext={entryContext} accept={accept} />;
  }

  // ---- Structured ----
  if (fieldType === "json") {
    const [text, setText] = useState(() => {
      try {
        return value ? JSON.stringify(value, null, 2) : "";
      } catch {
        return "";
      }
    });
    const [valid, setValid] = useState(true);

    function handleChange(t) {
      setText(t);
      if (t.trim() === "") {
        onChange(null);
        setValid(true);
        return;
      }
      try {
        onChange(JSON.parse(t));
        setValid(true);
      } catch {
        setValid(false);
      }
    }

    return (
      <div style={{ display: "grid", gap: 6 }}>
        <textarea rows={8} value={text} onChange={(e) => handleChange(e.target.value)} placeholder='{"key":"value"}' />
        <small style={{ color: valid ? "#0a0" : "#a00" }}>{valid ? "Valid JSON" : "Invalid JSON"}</small>
      </div>
    );
  }

  if (fieldType === "tags") {
    const chips = Array.isArray(value)
      ? value
      : typeof value === "string"
      ? value.split(",").map((s) => s.trim()).filter(Boolean)
      : [];
    return (
      <input
        placeholder="tag1, tag2, tag three"
        value={chips.join(", ")}
        onChange={(e) => onChange(e.target.value.split(",").map((s) => s.trim()).filter(Boolean))}
      />
    );
  }

  if (fieldType === "name") return <NameField field={field} value={value} onChange={onChange} />;
  if (fieldType === "address") return <AddressField field={field} value={value} onChange={onChange} />;

  return <input type="text" value={value ?? ""} onChange={(e) => onChange(e.target.value)} />;
}
