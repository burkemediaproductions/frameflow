import fs from "fs";
import path from "path";
import { pathToFileURL } from "url";

/**
 * Auto-mount any gizmo pack that exports a default object with register(app).
 *
 * Supported structures:
 *   api/src/gizmos/<slug>/server/index.js   ✅
 *   api/src/gizmos/<slug>/server.js
 *   api/gizmos/<slug>/server/index.js      (legacy)
 *   api/gizmos/<slug>/server.js
 */
export async function mountGizmoPacks(app) {
  const cwd = process.cwd();
  console.log("[GIZMOS] mountGizmoPacks() cwd =", cwd);

  // ✅ where we store public route prefixes discovered from packs
  if (!app.locals) app.locals = {};
  if (!Array.isArray(app.locals.gizmoPublicPrefixes)) {
    app.locals.gizmoPublicPrefixes = [];
  }

  // We include both “api/src/gizmos” and “src/gizmos” styles because
  // some installs run from repo root, and some run from /api as CWD.
  const baseDirs = [
    path.resolve(cwd, "api", "src", "gizmos"),
    path.resolve(cwd, "api", "gizmos"),
    path.resolve(cwd, "src", "gizmos"),
    path.resolve(cwd, "gizmos"),
  ];

  console.log("[GIZMOS] baseDirs =", baseDirs);

  const mounted = new Set();

  for (const baseDir of baseDirs) {
    if (!fs.existsSync(baseDir)) {
      console.log("[GIZMOS] No gizmos directory:", baseDir);
      continue;
    }

    const gizmoDirs = fs
      .readdirSync(baseDir, { withFileTypes: true })
      .filter((d) => d.isDirectory())
      .map((d) => d.name);

    if (gizmoDirs.length) {
      console.log("[GIZMOS] Found packs in", baseDir, ":", gizmoDirs);
    }

    for (const slug of gizmoDirs) {
      if (mounted.has(slug)) continue;

      const candidates = [
        path.join(baseDir, slug, "server", "index.js"),
        path.join(baseDir, slug, "server.js"),
      ];

      const entry = candidates.find((p) => fs.existsSync(p));
      if (!entry) {
        console.log(`[GIZMOS] ${slug}: no server entry (skipping)`);
        continue;
      }

      try {
        console.log(`[GIZMOS] ${slug}: importing ->`, entry);

        const raw = fs.readFileSync(entry, "utf8");
        const badAtStart = raw.slice(0, 50);
        if (badAtStart.includes("||")) {
          console.log(
            `[GIZMOS] ${slug}: WARNING suspicious '||' near file start:`,
            JSON.stringify(badAtStart)
          );
        }

        const mod = await import(pathToFileURL(entry).href);
        const pack = mod?.default;

        if (pack && typeof pack.register === "function") {
          // Mount the pack
          pack.register(app);
          mounted.add(slug);

          // ✅ Collect public prefixes (skip-auth) from the pack
          const declaredSlug = String(pack.slug || slug).trim();
          const auth = pack.auth && typeof pack.auth === "object" ? pack.auth : {};
          const publicPrefixes = Array.isArray(auth.publicPrefixes) ? auth.publicPrefixes : [];

          // Always allow the conventional public path:
          // /api/gizmos/<slug>/public/*
          const conventionalPublic = `/api/gizmos/${declaredSlug}/public`;

          const toAdd = [conventionalPublic, ...publicPrefixes]
            .filter(Boolean)
            .map((p) => String(p).trim())
            .filter((p) => p.startsWith("/"));

          for (const p of toAdd) {
            if (!app.locals.gizmoPublicPrefixes.includes(p)) {
              app.locals.gizmoPublicPrefixes.push(p);
            }
          }

          console.log(`[GIZMOS] Mounted: ${declaredSlug} (${entry})`);
          console.log(
            `[GIZMOS] Public prefixes for ${declaredSlug}:`,
            toAdd.length ? toAdd : "(none)"
          );
        } else {
          console.log(
            `[GIZMOS] ${slug}: missing default export register(app) (skipping)`
          );
        }
      } catch (e) {
        console.error(`[GIZMOS] Failed to mount ${slug}.`);
        console.error("[GIZMOS] Entry:", entry);
        console.error("[GIZMOS] Error name:", e?.name);
        console.error("[GIZMOS] Error message:", e?.message || e);
        if (e?.stack) {
          console.error("[GIZMOS] Stack:\n", e.stack);
        }
      }
    }
  }

  if (!mounted.size) {
    console.log("[GIZMOS] No packs mounted.");
  } else {
    console.log("[GIZMOS] Mounted packs:", Array.from(mounted));
  }

  console.log("[GIZMOS] All public prefixes:", app.locals.gizmoPublicPrefixes);
}
