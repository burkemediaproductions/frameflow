console.log("Frame+Flow storefront loaded");

const API_BASE = import.meta.env.VITE_API_BASE;

const app = document.querySelector("#app");

app.innerHTML = `
  <main style="max-width: 1100px; margin: 40px auto; padding: 0 16px; font-family: system-ui;">
    <h1 style="margin: 0 0 8px;">Frame + Flow</h1>
    <p style="margin: 0 0 24px; opacity: 0.8;">Available artwork</p>
    <div id="status" style="margin-bottom: 16px; opacity: 0.8;"></div>
    <div id="grid" style="display: grid; grid-template-columns: repeat(auto-fill, minmax(220px, 1fr)); gap: 16px;"></div>
  </main>
`;

const statusEl = document.querySelector("#status");
const grid = document.querySelector("#grid");

// TODO: Update these keys once you finalize your Artwork fields in ServiceUp.
const pickImageUrl = (item) =>
  item.image_url ||
  item.primary_image_url ||
  item.featured_image_url ||
  (Array.isArray(item.images) ? item.images?.[0] : "") ||
  "";

async function loadArt() {
  if (!API_BASE) {
    statusEl.textContent = "Missing VITE_API_BASE environment variable.";
    return;
  }

  statusEl.textContent = "Loading…";

  try {
    const res = await fetch(`${API_BASE}/api/artworks`);
    if (!res.ok) throw new Error(`API error: ${res.status}`);
    const items = await res.json();

    statusEl.textContent = `${items.length} item(s) found`;

    grid.innerHTML = items
      .map((item) => {
        const title = item.title ?? "Untitled";
        const price = item.price != null && item.price !== ""
          ? `$${Number(item.price).toLocaleString()}`
          : "";
        const img = pickImageUrl(item);

        return `
          <article style="border: 1px solid rgba(0,0,0,.12); border-radius: 12px; overflow: hidden;">
            <div style="aspect-ratio: 4/3; background: rgba(0,0,0,.04); display:flex; align-items:center; justify-content:center;">
              ${img ? `<img src="${img}" alt="${title}" style="width:100%; height:100%; object-fit:cover;">` : `<div style="opacity:.6;">No image</div>`}
            </div>
            <div style="padding: 12px 12px 14px;">
              <div style="font-weight: 700;">${title}</div>
              <div style="opacity: .8; margin-top: 4px;">${price}</div>
            </div>
          </article>
        `;
      })
      .join("");
  } catch (err) {
    console.error(err);
    statusEl.textContent = `Failed to load artwork. Check API + CORS. (${err.message})`;
  }
}

loadArt();
