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

        // If someone accidentally pasted "||||" into the file, this helps you spot it fast.
        // (Do NOT leave super-verbose dumps forever; it’s just for bring-up.)
        const raw = fs.readFileSync(entry, "utf8");
        const badAtStart = raw.slice(0, 50);
        if (badAtStart.includes("||")) {
          console.log(`[GIZMOS] ${slug}: WARNING suspicious '||' near file start:`, JSON.stringify(badAtStart));
        }

        const mod = await import(pathToFileURL(entry).href);
        const pack = mod?.default;

        if (pack && typeof pack.register === "function") {
          pack.register(app);
          mounted.add(slug);
          console.log(`[GIZMOS] Mounted: ${slug} (${entry})`);
        } else {
          console.log(`[GIZMOS] ${slug}: missing default export register(app) (skipping)`);
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
}
