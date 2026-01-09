/* DCE Gallery – minimal Vite storefront (static) */

const API_BASE =
  (import.meta && import.meta.env && import.meta.env.VITE_API_BASE) ||
  window.__API_BASE__ ||
  "https://frameflow-i677.onrender.com";

// Logo (for now hard-coded; later we can fetch from /public/widgets or settings)
const DEFAULT_LOGO_URL =
  "https://nvvdqdomdbgcljlxbiwm.supabase.co/storage/v1/object/public/branding/logoUrl-1767918829592.png";
const LOGO_URL = DEFAULT_LOGO_URL;

const APP_NAME = "DCE Gallery";
const TAGLINE = "Curated pieces for collectors";

const fmtMoney = (cents, currency = "USD") => {
  if (typeof cents !== "number" || Number.isNaN(cents)) return null;
  try {
    return new Intl.NumberFormat(undefined, {
      style: "currency",
      currency,
      maximumFractionDigits: 0,
    }).format(cents / 100);
  } catch {
    return `$${(cents / 100).toFixed(2)}`;
  }
};

function textFromTiptap(doc) {
  try {
    if (!doc || typeof doc !== "object") return "";
    const chunks = [];
    const walk = (node) => {
      if (!node) return;
      if (node.type === "text" && typeof node.text === "string") chunks.push(node.text);
      if (Array.isArray(node.content)) node.content.forEach(walk);
    };
    walk(doc);
    return chunks.join("").replace(/\s+/g, " ").trim();
  } catch {
    return "";
  }
}

function slugify(str) {
  return String(str || "")
    .toLowerCase()
    .trim()
    .replace(/["'“”‘’]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

async function fetchJSON(url) {
  const res = await fetch(url, { headers: { Accept: "application/json" } });
  if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
  return res.json();
}

function setMeta({ title, description, canonical, ogImage } = {}) {
  const t = title || APP_NAME;
  const d = description || `${APP_NAME} — curated artwork for collectors.`;
  document.title = t;

  const metaDesc = document.querySelector("#meta-description");
  if (metaDesc) metaDesc.setAttribute("content", d);

  const canon = document.querySelector("#canonical");
  if (canon && canonical) canon.setAttribute("href", canonical);

  const ogTitle = document.querySelector("#og-title");
  const ogDesc = document.querySelector("#og-description");
  const ogUrl = document.querySelector("#og-url");
  const ogImg = document.querySelector("#og-image");
  if (ogTitle) ogTitle.setAttribute("content", t);
  if (ogDesc) ogDesc.setAttribute("content", d);
  if (ogUrl && canonical) ogUrl.setAttribute("content", canonical);
  if (ogImg && ogImage) ogImg.setAttribute("content", ogImage);

  const twTitle = document.querySelector("#tw-title");
  const twDesc = document.querySelector("#tw-description");
  const twImg = document.querySelector("#tw-image");
  if (twTitle) twTitle.setAttribute("content", t);
  if (twDesc) twDesc.setAttribute("content", d);
  if (twImg && ogImage) twImg.setAttribute("content", ogImage);

  // Basic JSON-LD (CollectionPage or Product on detail)
  const jsonld = document.querySelector("#jsonld");
  if (jsonld) {
    jsonld.textContent = JSON.stringify(
      {
        "@context": "https://schema.org",
        "@type": "WebSite",
        name: APP_NAME,
        url: canonical || "/",
      },
      null,
      0
    );
  }
}

function showToast(msg) {
  const el = document.getElementById("toast");
  if (!el) return;
  el.textContent = msg;
  el.classList.add("show");
  window.clearTimeout(showToast._t);
  showToast._t = window.setTimeout(() => el.classList.remove("show"), 2200);
}

function getRoute() {
  const h = window.location.hash || "#/";
  // #/piece/:slug
  const parts = h.replace(/^#\/?/, "").split("/").filter(Boolean);
  return parts;
}

function setRoute(hash) {
  window.location.hash = hash;
}

function renderShell() {
  const app = document.getElementById("app");
  if (!app) return;

  app.innerHTML = `
    <div class="film-grain" aria-hidden="true"></div>

    <header class="topbar" role="banner">
      <div class="container nav">
        <a class="brand" href="#/" aria-label="${APP_NAME} home">
          <span class="sr-only">${APP_NAME}</span>
          ${
            LOGO_URL
              ? `<img class="brand-logo" src="${LOGO_URL}" alt="${APP_NAME} logo" />`
              : ""
          }
        </a>

        <div class="tools" role="search" aria-label="Search and filters">
          <label class="sr-only" for="search">Search</label>
          <input id="search" class="search" type="search" placeholder="Search titles…" autocomplete="off" />

          <label class="sr-only" for="filter">Availability</label>
          <select id="filter" class="filter">
            <option value="available">Available</option>
            <option value="all">All</option>
          </select>
        </div>
      </div>
    </header>

    <main class="container">
      <section class="hero" aria-label="Intro">
        <h1>Artwork for collectors.</h1>
        <p>${TAGLINE}</p>
      </section>

      <section class="panel" aria-label="Content">
        <div id="status" class="status" aria-live="polite"></div>
        <div id="view" class="view"></div>
      </section>
    </main>

    <footer class="footer">
      <div class="container">
        <div class="footer-row">
          <span>© ${new Date().getFullYear()} ${APP_NAME}</span>
        </div>
      </div>
    </footer>

    <div id="toast" class="toast" role="status" aria-live="polite"></div>
  `;
}

function cardHTML(item) {
  const title = item?.title || item?._title || "Untitled";
  const slug = item?.slug || item?._slug || slugify(title);
  const artist = item?.artist_name || "";
  const year = item?.year || "";
  const img = item?.primary_image?.publicUrl || "";
  const desc = textFromTiptap(item?.description);
  const price =
    typeof item?.price_cents === "number"
      ? fmtMoney(item.price_cents, item.currency || "USD")
      : null;

  const subtitle = [artist, year].filter(Boolean).join(" • ");
  const snippet = desc ? desc.slice(0, 140) + (desc.length > 140 ? "…" : "") : "";

  return `
    <article class="card">
      <a class="card-link" href="#/piece/${encodeURIComponent(slug)}" aria-label="View ${title}">
        <div class="card-media">
          ${
            img
              ? `<img src="${img}" alt="${title}" loading="lazy" decoding="async" />`
              : `<div class="img-fallback" aria-hidden="true"></div>`
          }
        </div>

        <div class="card-body">
          <h2 class="card-title">${title}</h2>
          ${subtitle ? `<div class="card-subtitle">${subtitle}</div>` : ""}
          ${snippet ? `<p class="card-snippet">${snippet}</p>` : ""}
          <div class="card-meta">
            <span class="price">${price || "Price on request"}</span>
            <span class="pill">Online</span>
          </div>
        </div>
      </a>
    </article>
  `;
}

function detailHTML(item) {
  const title = item?.title || item?._title || "Untitled";
  const slug = item?.slug || item?._slug || slugify(title);
  const artist = item?.artist_name || "";
  const year = item?.year || "";
  const medium = item?.medium || "";
  const framed = typeof item?.framed === "boolean" ? (item.framed ? "Framed" : "Unframed") : "";
  const dims = [item?.width_in, item?.height_in, item?.depth_in].filter((v) => typeof v === "number");
  const dimsText = dims.length ? `${dims[0]} × ${dims[1]}${dims[2] ? ` × ${dims[2]}` : ""} in` : "";
  const provenance = item?.provenance || "";
  const img = item?.primary_image?.publicUrl || "";
  const desc = textFromTiptap(item?.description);
  const price =
    typeof item?.price_cents === "number"
      ? fmtMoney(item.price_cents, item.currency || "USD")
      : null;

  // SEO meta
  setMeta({
    title: `${title} — ${APP_NAME}`,
    description: desc ? desc.slice(0, 160) : `${title} available at ${APP_NAME}.`,
    canonical: `#/piece/${encodeURIComponent(slug)}`,
    ogImage: img || "",
  });

  const facts = [
    artist ? ["Artist", artist] : null,
    year ? ["Year", year] : null,
    medium ? ["Medium", medium] : null,
    framed ? ["Framing", framed] : null,
    dimsText ? ["Size", dimsText] : null,
    provenance ? ["Provenance", provenance] : null,
    item?.sku ? ["SKU", item.sku] : null,
  ].filter(Boolean);

  return `
    <div class="detail">
      <a class="back" href="#/">← Back to all artwork</a>

      <div class="detail-grid">
        <div class="detail-media">
          ${
            img
              ? `<img src="${img}" alt="${title}" loading="eager" decoding="async" />`
              : `<div class="img-fallback" aria-hidden="true"></div>`
          }
        </div>

        <div class="detail-body">
          <h1 class="detail-title">${title}</h1>
          ${artist || year ? `<div class="detail-subtitle">${[artist, year].filter(Boolean).join(" • ")}</div>` : ""}

          <div class="detail-price">${price || "Price on request"}</div>

          ${
            facts.length
              ? `<dl class="facts">
                  ${facts
                    .map(
                      ([k, v]) => `<div class="fact"><dt>${k}</dt><dd>${v}</dd></div>`
                    )
                    .join("")}
                </dl>`
              : ""
          }

          ${desc ? `<div class="detail-desc"><p>${desc}</p></div>` : ""}

          <div class="detail-actions">
            <button class="btn" type="button" id="buyBtn" disabled title="Stripe checkout will be enabled next">
              Buy (coming soon)
            </button>
          </div>
        </div>
      </div>
    </div>
  `;
}

async function loadList() {
  const status = document.getElementById("status");
  const view = document.getElementById("view");
  if (!status || !view) return;

  status.textContent = "Loading artwork…";

  const data = await fetchJSON(`${API_BASE}/api/content/art`);
  // ServiceUp returns array or {items:[]}
  const items = Array.isArray(data) ? data : Array.isArray(data?.items) ? data.items : [];
  status.textContent = items.length ? `${items.length} piece(s)` : "No artwork yet.";
  return items;
}

async function renderList(items) {
  const view = document.getElementById("view");
  if (!view) return;

  const searchEl = document.getElementById("search");
  const filterEl = document.getElementById("filter");

  const apply = () => {
    const q = (searchEl?.value || "").toLowerCase().trim();
    const mode = filterEl?.value || "available";

    const filtered = (items || []).filter((it) => {
      const title = (it?.title || it?._title || "").toLowerCase();
      const slug = (it?.slug || it?._slug || "").toLowerCase();
      const artist = (it?.artist_name || "").toLowerCase();
      const matchQ = !q || title.includes(q) || slug.includes(q) || artist.includes(q);

      // availability: if you later add a real field, swap this logic
      const isPublished = (it?.status || it?._status || "published") === "published";
      const matchAvail = mode === "all" ? true : isPublished;

      return matchQ && matchAvail;
    });

    view.innerHTML = `
      <div class="grid">
        ${filtered.map(cardHTML).join("")}
      </div>
    `;
  };

  searchEl?.addEventListener("input", apply);
  filterEl?.addEventListener("change", apply);
  apply();
}

async function renderDetailBySlug(items, slug) {
  const view = document.getElementById("view");
  if (!view) return;

  const decoded = decodeURIComponent(slug || "");
  const found =
    (items || []).find((it) => (it?.slug || it?._slug) === decoded) ||
    (items || []).find((it) => slugify(it?.title || it?._title) === decoded);

  if (!found) {
    view.innerHTML = `<div class="empty"><a class="back" href="#/">← Back</a><p>That artwork wasn’t found.</p></div>`;
    return;
  }

  view.innerHTML = detailHTML(found);

  const buyBtn = document.getElementById("buyBtn");
  buyBtn?.addEventListener("click", () => showToast("Checkout will be enabled next."));
}

async function boot() {
  renderShell();

  // list load (cache for routing)
  let items = [];
  try {
    items = (await loadList()) || [];
  } catch (e) {
    const status = document.getElementById("status");
    if (status) status.textContent = "Could not load artwork.";
    showToast(`Error loading content: ${e?.message || e}`);
  }

  const route = () => {
    const parts = getRoute();
    // Reset list meta by default
    setMeta({ title: APP_NAME, description: `${APP_NAME} — curated artwork for collectors.`, canonical: "#/" });

    if (parts[0] === "piece" && parts[1]) {
      renderDetailBySlug(items, parts[1]);
      return;
    }
    renderList(items);
  };

  window.addEventListener("hashchange", route);
  route();
}

boot();
