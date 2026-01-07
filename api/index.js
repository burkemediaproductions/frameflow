import express from 'express';
import dotenv from 'dotenv';
import pg from 'pg';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';

import usersRouter from './routes/users.js';
import taxonomiesRouter from './routes/taxonomies.js';
import rolesRouter from './routes/roles.js';
import permissionsRouter from './routes/permissions.js';
import settingsRouter from './routes/settings.js';
import dashboardRouter from './routes/dashboard.js';
import contentTypesRouter from './routes/contentTypes.js';
import entryViewsRouter from './routes/entryViews.js';
import listViewsRouter from './routes/listViews.js';

import gizmosRouter from './routes/gizmos.js';
import gadgetsRouter from './routes/gadgets.js';
import widgetsRouter from './routes/widgets.js';
import publicWidgetsRouter from './routes/publicWidgets.js';
import gizmoPacksRouter from './routes/gizmoPacks.js';
import publicSiteRouter from './routes/publicSite.js';

import mountExtraRoutes from './extra-routes.js';
import { mountGizmoPacks } from './gizmos-loader.js';

import {
  normalizeEmail,
  normalizePhoneE164,
  normalizeUrl,
  normalizeAddress,
} from './lib/fieldUtils.js';

dotenv.config();

const app = express();

/* ----------------------- CORS (credentialed) ----------------------- */
const ALLOW = (process.env.ALLOWED_ORIGINS || '')
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean);

if (ALLOW.length === 0) {
  ALLOW.push('http://localhost:5173', 'http://localhost:5174');
}

app.use((req, res, next) => {
  const origin = req.headers.origin;

  // In case any prior middleware set a wildcard, clear it first
  res.removeHeader('Access-Control-Allow-Origin');

  const allowed = origin && ALLOW.includes(origin);
  if (allowed) {
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Vary', 'Origin');
    res.setHeader('Access-Control-Allow-Credentials', 'true');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
    res.setHeader(
      'Access-Control-Allow-Methods',
      'GET,POST,PATCH,PUT,DELETE,OPTIONS'
    );
    res.setHeader('Access-Control-Expose-Headers', 'ETag');
  }

  if (process.env.NODE_ENV !== 'production') {
    console.log('[CORS]', {
      origin,
      allowed,
      sent: res.getHeader('Access-Control-Allow-Origin'),
    });
  }

  if (req.method === 'OPTIONS') return res.sendStatus(204);
  next();
});

// Who-am-I helper to confirm allowlist at runtime
app.get('/__whoami', (req, res) => {
  res.json({
    ok: true,
    allowEnv: process.env.ALLOWED_ORIGINS || '',
    allowList: ALLOW,
    sawOrigin: req.headers.origin || null,
    willAllow: !!(req.headers.origin && ALLOW.includes(req.headers.origin)),
  });
});

console.log('[BOOT] ServiceUp API starting…');
console.log('[ALLOWLIST]', ALLOW);

/* ----------------------- Crash surfacing --------------------------- */
process.on('unhandledRejection', (err) => {
  console.error('[unhandledRejection]', err);
});
process.on('uncaughtException', (err) => {
  console.error('[uncaughtException]', err);
});

/* ----------------------- Parsers & logging ------------------------- */
app.use(express.json({ limit: '2mb' }));

app.use((req, res, next) => {
  const start = Date.now();
  res.on('finish', () => {
    console.log(
      '[HTTP]',
      req.method,
      req.path,
      '->',
      res.statusCode,
      Date.now() - start + 'ms'
    );
  });
  next();
});

/* ----------------------- Postgres ---------------------------------- */
const pool = new pg.Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { require: true, rejectUnauthorized: false },
});

pool.on('error', (err) => {
  console.error('[pg.pool error]', err);
});

const JWT_SECRET = process.env.JWT_SECRET || 'changeme';

// ---------------------------------------------------------------------------
// Title template helpers (server-side)
// ---------------------------------------------------------------------------

function getByPath(obj, path) {
  if (!path) return undefined;
  const parts = String(path)
    .split('.')
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
  if (value == null) return '';
  if (
    typeof value === 'string' ||
    typeof value === 'number' ||
    typeof value === 'boolean'
  ) {
    return String(value);
  }

  if (Array.isArray(value)) {
    return value.map(asPrettyInline).filter(Boolean).join(', ');
  }

  if (typeof value === 'object') {
    // common name-field shapes
    const first = value.first || '';
    const last = value.last || '';
    const middle = value.middle || '';
    const title = value.title || '';
    const suffix = value.suffix || '';

    const looksLikeName =
      Object.prototype.hasOwnProperty.call(value, 'first') ||
      Object.prototype.hasOwnProperty.call(value, 'last') ||
      Object.prototype.hasOwnProperty.call(value, 'middle') ||
      Object.prototype.hasOwnProperty.call(value, 'title') ||
      Object.prototype.hasOwnProperty.call(value, 'suffix');

    if (looksLikeName) {
      const bits = [];
      if (title) bits.push(String(title));
      if (first) bits.push(String(first));
      if (middle) bits.push(String(middle));
      if (last) bits.push(String(last));
      let out = bits.join(' ').trim();
      if (suffix) out = `${out} ${suffix}`.trim();
      return out;
    }

    try {
      return JSON.stringify(value);
    } catch {
      return String(value);
    }
  }

  return String(value);
}

function deriveTitleFromTemplate(template, data) {
  const tpl = String(template || '');
  if (!tpl.trim()) return '';

  const out = tpl.replace(/\{([^}]+)\}/g, (_, tokenRaw) => {
    const token = String(tokenRaw || '').trim();
    if (!token) return '';
    const val = getByPath(data, token);
    return asPrettyInline(val);
  });

  return out.replace(/\s+/g, ' ').trim();
}

async function getEffectiveEditorCoreForType(contentTypeId, roleUpper) {
  const role = String(roleUpper || '').toUpperCase();
  try {
    const { rows } = await pool.query(
      `SELECT config
         FROM entry_editor_views
        WHERE content_type_id = $1
        ORDER BY
          CASE WHEN (config->'default_roles')::jsonb ? $2 THEN 1 ELSE 0 END DESC,
          CASE WHEN is_default THEN 1 ELSE 0 END DESC,
          updated_at DESC NULLS LAST,
          created_at DESC NULLS LAST,
          id ASC
        LIMIT 1`,
      [contentTypeId, role]
    );

    const cfg =
      rows?.[0]?.config && typeof rows[0].config === 'object'
        ? rows[0].config
        : {};
    const core = cfg?.core && typeof cfg.core === 'object' ? cfg.core : {};
    return core;
  } catch (e) {
    console.warn('[getEffectiveEditorCoreForType] failed:', e?.message || e);
    return {};
  }
}

/* ----------------------- Helpers ----------------------------------- */
function listRoutes(appRef) {
  const table = [];
  const stack = appRef._router?.stack || [];
  stack.forEach((layer) => {
    if (layer.route && layer.route.path) {
      const methods = Object.keys(layer.route.methods)
        .map((m) => m.toUpperCase())
        .join(',');
      table.push({ path: layer.route.path, methods });
    } else if (layer.name === 'router' && layer.handle?.stack) {
      layer.handle.stack.forEach((r) => {
        if (r.route) {
          const methods = Object.keys(r.route.methods)
            .map((m) => m.toUpperCase())
            .join(',');
          table.push({ path: r.route.path, methods });
        }
      });
    }
  });
  return table;
}

function isUuid(value) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
    String(value || '').trim()
  );
}

function normalizeEntryData(fieldDefs, dataIn) {
  try {
    const out = { ...(dataIn || {}) };

    for (const f of fieldDefs || []) {
      const snake = f.key;
      const camel = snake.replace(/_([a-z])/g, (_, c) => c.toUpperCase());
      if (out[camel] !== undefined && out[snake] === undefined) {
        out[snake] = out[camel];
        delete out[camel];
      }
    }

    for (const f of fieldDefs || []) {
      const k = f.key;
      const t = f.type;
      const v = out[k];
      switch (t) {
        case 'email':
          out[k] = normalizeEmail(v);
          break;
        case 'phone':
          out[k] = normalizePhoneE164(v, 'US');
          break;
        case 'url':
          out[k] = normalizeUrl(v);
          break;
        case 'address':
          out[k] = normalizeAddress(v);
          break;
        default:
          break;
      }
    }
    return out;
  } catch {
    return dataIn;
  }
}

/**
 * Option B: auto-expand relation_user fields.
 */
async function attachResolvedUsersToEntries(typeId, entries) {
  const list = Array.isArray(entries) ? entries : [entries];
  if (!typeId || !list.length) return entries;

  const { rows: userFieldRows } = await pool.query(
    `
      SELECT field_key, type, config
      FROM content_fields
      WHERE content_type_id = $1
        AND type = 'relation_user'
    `,
    [typeId]
  );

  if (!userFieldRows.length) return entries;

  const userFields = {};
  for (const f of userFieldRows) {
    const cfg = f.config && typeof f.config === 'object' ? f.config : {};
    userFields[f.field_key] = {
      multiple: !!cfg.multiple,
      display: cfg.display || 'name_email',
      roleFilter: cfg.roleFilter || '',
      onlyActive: cfg.onlyActive === undefined ? true : !!cfg.onlyActive,
    };
  }

  const idsSet = new Set();
  for (const entry of list) {
    const data = entry?.data && typeof entry.data === 'object' ? entry.data : {};
    for (const fieldKey of Object.keys(userFields)) {
      const v = data[fieldKey];
      if (Array.isArray(v)) {
        for (const maybeId of v) {
          if (isUuid(maybeId)) idsSet.add(String(maybeId));
        }
      } else {
        if (isUuid(v)) idsSet.add(String(v));
      }
    }
  }

  const ids = Array.from(idsSet);
  if (!ids.length) {
    for (const entry of list) {
      entry._resolved = entry._resolved || {};
      entry._resolved.userFields = userFields;
      entry._resolved.usersById = entry._resolved.usersById || {};
    }
    return entries;
  }

  const { rows: users } = await pool.query(
    `
      SELECT id, email, name, role, status
      FROM public.users
      WHERE id = ANY($1::uuid[])
    `,
    [ids]
  );

  const usersById = {};
  for (const u of users) usersById[u.id] = u;

  for (const entry of list) {
    entry._resolved = entry._resolved || {};
    entry._resolved.userFields = userFields;
    entry._resolved.usersById = usersById;
  }

  return entries;
}

/* ----------------------- Debug endpoints --------------------------- */
app.get('/__ping', (_req, res) => res.json({ ok: true, build: Date.now() }));
app.get('/__routes', (_req, res) => res.json({ routes: listRoutes(app) }));

/* ----------------------- Auth -------------------------------------- */
app.post('/api/auth/login', async (req, res) => {
  const { email, password } = req.body || {};
  if (!email || !password) {
    return res.status(400).json({ error: 'Email and password required' });
  }
  try {
    const { rows } = await pool.query('SELECT * FROM users WHERE email = $1', [email]);
    if (!rows.length) return res.status(401).json({ error: 'Invalid credentials' });

    const user = rows[0];
    const match = await bcrypt.compare(password, user.password_hash);
    if (!match) return res.status(401).json({ error: 'Invalid credentials' });

    const token = jwt.sign(
      { id: user.id, email: user.email, role: user.role },
      JWT_SECRET,
      { expiresIn: '2d' }
    );

    res.json({ token, user: { id: user.id, email: user.email, role: user.role } });
  } catch (err) {
    console.error('[auth/login]', err);
    res.status(500).json({ error: 'Server error' });
  }
});

function authMiddleware(req, res, next) {
  const url = req.originalUrl || req.url || '';
  const path = req.path || '';

  // Global public paths
  if (path.startsWith('/public/')) return next();

  // ✅ Public gizmo pack endpoints
  // Allows: /api/gizmos/<packSlug>/public/*
  if (/\/api\/gizmos\/[^/]+\/public(\/|$)/.test(url)) return next();

  const authHeader = req.headers.authorization;
  if (!authHeader) return res.status(401).json({ error: 'No token provided' });

  const token = authHeader.split(' ')[1];
  if (!token) return res.status(401).json({ error: 'No token provided' });

  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    req.user = decoded;
    next();
  } catch {
    return res.status(401).json({ error: 'Invalid token' });
  }
}

/* ----------------------- Entries ----------------------------------- */

// List entries for a content type
app.get('/api/content/:slug', async (req, res) => {
  const { slug } = req.params;

  try {
    const { rows: typeRows } = await pool.query(
      'SELECT id FROM content_types WHERE slug = $1 LIMIT 1',
      [slug]
    );

    if (!typeRows.length) {
      return res.status(404).json({ error: 'Content type not found' });
    }

    const typeId = typeRows[0].id;
    const { rows: entries } = await pool.query(
      'SELECT * FROM entries WHERE content_type_id = $1 ORDER BY created_at DESC',
      [typeId]
    );

    await attachResolvedUsersToEntries(typeId, entries);
    res.json(entries);
  } catch (err) {
    console.error('[GET /api/content/:slug] error', err);
    res.status(500).json({ error: 'Server error listing entries', detail: err.message });
  }
});

// Create entry
app.post('/api/content/:slug', authMiddleware, async (req, res) => {
  const typeSlug = req.params.slug;
  let { title, slug: entrySlug, status, data } = req.body || {};

  function slugify(str) {
    return (str || '')
      .toString()
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '');
  }

  try {
    const { rows: ctRows } = await pool.query(
      'SELECT id FROM content_types WHERE slug = $1 LIMIT 1',
      [typeSlug]
    );
    if (!ctRows.length) return res.status(404).json({ error: 'Content type not found' });

    const typeId = ctRows[0].id;

    const roleUpper = String(req.user?.role || 'ADMIN').toUpperCase();
    const core = await getEffectiveEditorCoreForType(typeId, roleUpper);

    if (core && String(core.titleMode || '').toLowerCase() === 'template') {
      const derived = deriveTitleFromTemplate(core.titleTemplate || '', data || {});
      if (derived) title = derived;
    }

    const safeTitle = typeof title === 'string' && title.trim() ? title.trim() : null;
    if (!safeTitle) return res.status(400).json({ error: 'Title is required' });

    if ((!entrySlug || !String(entrySlug).trim()) && core?.autoSlugFromTitleIfEmpty !== false) {
      entrySlug = slugify(safeTitle);
    }

    const finalSlug =
      typeof entrySlug === 'string' && entrySlug.trim() ? entrySlug.trim() : slugify(safeTitle);

    const finalStatus = typeof status === 'string' && status.trim() ? status.trim() : 'draft';

    const { rows: fieldsRows } = await pool.query(
      'SELECT field_key AS key, type FROM content_fields WHERE content_type_id = $1',
      [typeId]
    );

    const normalizedData = normalizeEntryData(fieldsRows, data || {});

    const { rows } = await pool.query(
      `INSERT INTO entries (content_type_id, title, slug, status, data)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING *`,
      [typeId, safeTitle, finalSlug, finalStatus, normalizedData]
    );

    await attachResolvedUsersToEntries(typeId, rows[0]);
    res.status(201).json(rows[0]);
  } catch (err) {
    console.error('[POST /api/content/:slug] error', err);
    if (err.code === '23505') {
      return res.status(409).json({
        error: 'Slug already exists for this content type',
        code: err.code,
        detail: err.detail || err.message,
      });
    }
    res.status(500).json({
      error: 'Failed to create entry',
      code: err.code || null,
      detail: err.message,
    });
  }
});

// Get single entry (accepts ID or slug)
app.get('/api/content/:slug/:id', authMiddleware, async (req, res) => {
  const { slug: typeSlug, id } = req.params;

  try {
    const { rows: ctRows } = await pool.query(
      'SELECT id FROM content_types WHERE slug = $1 LIMIT 1',
      [typeSlug]
    );
    if (!ctRows.length) return res.status(404).json({ error: 'Content type not found' });

    const typeId = ctRows[0].id;

    const entryQuery = isUuid(id)
      ? `SELECT * FROM entries WHERE id = $1 AND content_type_id = $2 LIMIT 1`
      : `SELECT * FROM entries WHERE slug = $1 AND content_type_id = $2 LIMIT 1`;
    const entryParams = isUuid(id) ? [id, typeId] : [id, typeId];

    const { rows } = await pool.query(entryQuery, entryParams);
    if (!rows.length) return res.status(404).json({ error: 'Entry not found' });

    await attachResolvedUsersToEntries(typeId, rows[0]);
    res.json(rows[0]);
  } catch (err) {
    console.error('[GET /api/content/:slug/:id] error', err);
    res.status(500).json({ error: 'Failed to fetch entry' });
  }
});

// Update entry (accepts ID or slug)
app.put('/api/content/:slug/:id', authMiddleware, async (req, res) => {
  const { slug: typeSlug, id } = req.params;
  let { title, slug: entrySlug, status, data } = req.body || {};

  function slugify(str) {
    return (str || '')
      .toString()
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '');
  }

  try {
    const { rows: ctRows } = await pool.query(
      'SELECT id FROM content_types WHERE slug = $1 LIMIT 1',
      [typeSlug]
    );
    if (!ctRows.length) return res.status(404).json({ error: 'Content type not found' });

    const typeId = ctRows[0].id;

    const roleUpper = String(req.user?.role || 'ADMIN').toUpperCase();
    const core = await getEffectiveEditorCoreForType(typeId, roleUpper);

    if (core && String(core.titleMode || '').toLowerCase() === 'template') {
      const derived = deriveTitleFromTemplate(core.titleTemplate || '', data || {});
      if (derived) title = derived;
    }

    const safeTitle = typeof title === 'string' && title.trim() ? title.trim() : null;
    if (!safeTitle) return res.status(400).json({ error: 'Title is required' });

    if ((!entrySlug || !String(entrySlug).trim()) && core?.autoSlugFromTitleIfEmpty !== false) {
      entrySlug = slugify(safeTitle);
    }

    const finalSlug =
      typeof entrySlug === 'string' && entrySlug.trim() ? entrySlug.trim() : slugify(safeTitle);

    const finalStatus = typeof status === 'string' && status.trim() ? status.trim() : 'draft';

    const { rows: fieldsRows } = await pool.query(
      'SELECT field_key AS key, type FROM content_fields WHERE content_type_id = $1',
      [typeId]
    );

    const normalizedData = normalizeEntryData(fieldsRows, data || {});

    const updated = isUuid(id)
      ? await pool.query(
          `UPDATE entries
           SET title = $1, slug = $2, status = $3, data = $4, updated_at = now()
           WHERE id = $5 AND content_type_id = $6
           RETURNING *`,
          [safeTitle, finalSlug, finalStatus, normalizedData, id, typeId]
        )
      : await pool.query(
          `UPDATE entries
           SET title = $1, slug = $2, status = $3, data = $4, updated_at = now()
           WHERE slug = $5 AND content_type_id = $6
           RETURNING *`,
          [safeTitle, finalSlug, finalStatus, normalizedData, id, typeId]
        );

    if (!updated.rows.length) return res.status(404).json({ error: 'Entry not found' });

    await attachResolvedUsersToEntries(typeId, updated.rows[0]);
    res.json(updated.rows[0]);
  } catch (err) {
    console.error('[PUT /api/content/:slug/:id] error', err);
    if (err.code === '23505') {
      return res.status(409).json({
        error: 'Slug already exists for this content type',
        code: err.code,
        detail: err.detail || err.message,
      });
    }
    res.status(500).json({
      error: 'Failed to update entry',
      code: err.code || null,
      detail: err.message,
    });
  }
});

/* ----------------------- Deletes ----------------------------------- */

app.delete('/api/content/:slug/:id', authMiddleware, async (req, res) => {
  const { slug, id } = req.params;
  try {
    const typeRes = await pool.query(
      'SELECT id FROM content_types WHERE slug = $1 LIMIT 1',
      [slug]
    );
    if (!typeRes.rows.length) return res.status(404).json({ error: 'Not found' });
    const typeId = typeRes.rows[0].id;

    if (isUuid(id)) {
      await pool.query('DELETE FROM entry_versions WHERE entry_id = $1', [id]);
      const del = await pool.query(
        'DELETE FROM entries WHERE id = $1 AND content_type_id = $2 RETURNING id',
        [id, typeId]
      );
      if (!del.rows.length) return res.status(404).json({ error: 'Not found' });
    } else {
      const { rows: entryRows } = await pool.query(
        'SELECT id FROM entries WHERE slug = $1 AND content_type_id = $2 LIMIT 1',
        [id, typeId]
      );
      if (!entryRows.length) return res.status(404).json({ error: 'Not found' });
      const entryId = entryRows[0].id;

      await pool.query('DELETE FROM entry_versions WHERE entry_id = $1', [entryId]);

      const del = await pool.query(
        'DELETE FROM entries WHERE id = $1 AND content_type_id = $2 RETURNING id',
        [entryId, typeId]
      );
      if (!del.rows.length) return res.status(404).json({ error: 'Not found' });
    }

    res.json({ ok: true });
  } catch (err) {
    console.error('[DELETE /api/content/:slug/:id]', err);
    res.status(500).json({ error: 'Server error' });
  }
});

app.delete('/api/content/:id', authMiddleware, async (req, res) => {
  const { id } = req.params;
  try {
    await pool.query('DELETE FROM entry_versions WHERE entry_id = $1', [id]);
    const del = await pool.query('DELETE FROM entries WHERE id = $1 RETURNING id', [id]);
    if (!del.rows.length) return res.status(404).json({ error: 'Not found' });
    res.json({ ok: true });
  } catch (err) {
    console.error('[DELETE /api/content/:id]', err);
    res.status(500).json({ error: 'Server error' });
  }
});

/* ----------------------- Extra routes & settings ------------------- */
mountExtraRoutes(app);

app.get('/api/health', (_req, res) => {
  res.json({ ok: true });
});

/* ----------------------- Routers ----------------------------------- */

// PUBLIC routes first
app.use('/api', publicSiteRouter);
app.use('/api', publicWidgetsRouter);

// Admin/CRUD routers
app.use('/api/content-types', authMiddleware, contentTypesRouter);
app.use('/api/users', authMiddleware, usersRouter);
app.use('/api/taxonomies', taxonomiesRouter);
app.use('/api/roles', authMiddleware, rolesRouter);
app.use('/api/permissions', authMiddleware, permissionsRouter);
app.use('/api/settings', settingsRouter);
app.use('/api/dashboard', authMiddleware, dashboardRouter);
app.use('/api', entryViewsRouter);
app.use('/api', listViewsRouter);

// Gizmos/Gadgets/Widgets admin routes (not gizmo packs)
app.use('/api', authMiddleware, gizmosRouter);
app.use('/api', authMiddleware, gadgetsRouter);
app.use('/api', authMiddleware, widgetsRouter);

// Gizmo Packs admin endpoints
app.use('/api/gizmo-packs', gizmoPacksRouter);

// redirects
app.get('/content-types', (_req, res) => res.redirect(301, '/api/content-types'));
app.get('/content/:slug', (req, res) => res.redirect(301, `/api/content/${req.params.slug}`));

/* ----------------------- Last-chance error handler ----------------- */
app.use((err, req, res, _next) => {
  console.error('[FATAL]', err);
  const origin = req.headers.origin;
  if (origin && ALLOW.includes(origin)) {
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Vary', 'Origin');
    res.setHeader('Access-Control-Allow-Credentials', 'true');
  }
  res.status(500).json({ error: 'Server error' });
});

/* ----------------------- Listen ------------------------------------ */
async function start() {
  // Mount gizmo packs BEFORE listening
  await mountGizmoPacks(app);

  // Optional: show only base mount points (Express won’t show nested routes reliably)
  console.log('[BOOT] Gizmo packs mounted (see [GIZMOS] logs above).');

  const PORT = process.env.PORT || 4000;
  app.listen(PORT, '0.0.0.0', () => {
    console.log('[BOOT] ServiceUp API listening on', PORT);
  });
}

start().catch((err) => {
  console.error('[BOOT] Failed to start:', err);
  process.exit(1);
});
