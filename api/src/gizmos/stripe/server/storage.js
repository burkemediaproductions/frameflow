async function fetchJSON(url) {
  const r = await fetch(url, {
    headers: { Accept: "application/json" },
  });
  if (!r.ok) {
    const t = await r.text().catch(() => "");
    throw new Error(`Fetch failed ${r.status} ${r.statusText}: ${t.slice(0, 200)}`);
  }
  return r.json();
}

/**
 * Load an art record by id or slug using your content endpoint.
 *
 * Assumes your API supports:
 *   GET /api/content/art?status=published
 * and (optionally):
 *   GET /api/content/art/:id
 */
export async function getArtByIdOrSlug({ id, slug }) {
  // On Render, using localhost is fastest and avoids CORS.
  const apiBase = process.env.RENDER
    ? "http://127.0.0.1:3000"
    : (process.env.API_PUBLIC_BASE || "http://localhost:3000");

  if (id) {
    try {
      const one = await fetchJSON(`${apiBase}/api/content/art/${encodeURIComponent(id)}`);
      return one?.data || one;
    } catch (e) {
      // fall back to list+find
    }
  }

  const list = await fetchJSON(`${apiBase}/api/content/art?status=published`);
  const items = Array.isArray(list)
    ? list
    : Array.isArray(list?.items)
      ? list.items
      : Array.isArray(list?.data)
        ? list.data
        : [];

  const targetSlug = String(slug || "").trim();
  if (!targetSlug) return null;

  const match = items.find((x) => String(x.slug || x._slug || "") === targetSlug);
  return match || null;
}
