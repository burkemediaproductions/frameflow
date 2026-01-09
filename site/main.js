const API_BASE = import.meta.env.VITE_API_BASE;
const LOGO_URL = import.meta.env.VITE_LOGO_URL || "";

// ---------- helpers ----------
const safe = (s) =>
  String(s ?? "").replace(/[&<>"']/g, (m) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;",
  }[m]));

const tiptapToText = (node) => {
  if (!node) return "";
  if (node.type === "text") return node.text || "";
  if (!node.content) return "";
  return node.content.map(tiptapToText).join("");
};

const excerpt = (item, maxLen = 160) => {
  const text = tiptapToText(item?.description).replace(/\s+/g, " ").trim();
  if (!text) return "";
  return text.length > maxLen ? text.slice(0, maxLen) + "…" : text;
};

// Basic TipTap JSON → HTML (paragraphs + bold/italic)
const tiptapToHtml = (node) => {
  if (!node) return "";
  if (node.type === "doc" && Array.isArray(node.content)) {
    return node.content.map(tiptapToHtml).join("");
  }
  if (node.type === "paragraph") {
    const inner = (node.content || []).map(tiptapToHtml).join("");
    return `<p>${inner || ""}</p>`;
  }
  if (node.type === "text") {
    let t = safe(node.text || "");
    const marks = node.marks || [];
    for (const mk of marks) {
      if (mk.type === "bold") t = `<strong>${t}</strong>`;
      if (mk.type === "italic") t = `<em>${t}</em>`;
    }
    return t;
  }
  // fallback: render children
  if (Array.isArray(node.content)) return node.content.map(tiptapToHtml).join("");
  return "";
};

const formatMoney = (cents, currency = "USD") => {
  try {
    return new Intl.NumberFormat("en-US", { style: "currency", currency }).format(cents / 100);
  } catch {
    return `$${(cents / 100).toFixed(2)}`;
  }
};

const parsePriceStringToCents = (raw) => {
  const s = String(raw ?? "").trim();
  if (!s) return null;
  const numeric = Number(s.replace(/[^0-9.]/g, ""));
  if (!Number.isFinite(numeric) || numeric <= 0) return null;
  return Math.round(numeric * 100);
};

const normalizeItem = (item) => item?.fields || item?.values || item?.data || item || {};
const getStatus = (n) => String(n?._status ?? n?.status ?? "").toLowerCase();
const isPublished = (n) => getStatus(n) === "published";
const isSold = (n) => getStatus(n) === "sold";
const getChannels = (n) => (Array.isArray(n?.channel) ? n.channel : []);
const wantsWebsite = (n) => getChannels(n).includes("Website");

const pickImageUrl = (n) =>
  n?.primary_image?.publicUrl ||
  n?.primary_image?.public_url ||
  n?.primary_image?.url ||
  n?.primary_image_url ||
  n?.image_url ||
  "";

const getPriceCents = (n) => {
  if (typeof n?.price_cents === "number" && Number.isFinite(n.price_cents) && n.price_cents > 0) {
    return n.price_cents;
  }
  return parsePriceStringToCents(n?.price);
};

const normalizeListResponse = async (res) => {
  const json = await res.json();
  if (Array.isArray(json)) return json;
  if (Array.isArray(json.items)) return json.items;
  if (Array.isArray(json.data)) return json.data;
  if (Array.isArray(json.rows)) return json.rows;
  if (Array.isArray(json?.data?.items)) return json.data.items;
  return [];
};

// ---------- SEO helpers ----------
function upsertMeta(selectorOrName, attrs) {
  let el;
  if (selectorOrName.startsWith("meta[")) {
    el = document.querySelector(selectorOrName);
  } else {
    // treat as name=
    el = document.querySelector(`meta[name="${selectorOrName}"]`) || document.querySelector(`meta[property="${selectorOrName}"]`);
  }
  if (!el) {
    el = document.createElement("meta");
    document.head.appendChild(el);
  }
  for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, v);
}

function upsertLink(rel, href) {
  let el = document.querySelector(`link[rel="${rel}"]`);
  if (!el) {
    el = document.createElement("link");
    el.setAttribute("rel", rel);
    document.head.appendChild(el);
  }
  el.setAttribute("href", href);
}

function upsertJsonLd(obj) {
  let el = document.querySelector('script[type="application/ld+json"]#jsonld');
  if (!el) {
    el = document.createElement("script");
    el.type = "application/ld+json";
    el.id = "jsonld";
    document.head.appendChild(el);
  }
  el.textContent = JSON.stringify(obj);
}

function currentSiteOrigin() {
  return window.location.origin;
}

function detailUrlForSlug(slug) {
  // hash routing (no Netlify redirect needed)
  return `#/art/${encodeURIComponent(slug)}`;
}

function setDefaultSeo() {
  const origin = currentSiteOrigin();
  document.title = "DCE Gallery";
  upsertMeta("description", { name: "description", content: "DCE Gallery — curated artwork for collectors." });
  upsertLink("canonical", origin + "/");

  upsertMeta("og:title", { property: "og:title", content: "DCE Gallery" });
  upsertMeta("og:description", { property: "og:description", content: "Curated artwork for collectors." });
  upsertMeta("og:type", { property: "og:type", content: "website" });
  upsertMeta("og:url", { property: "og:url", content: origin + "/" });
  upsertMeta("og:image", { property: "og:image", content: "" });

  upsertMeta("twitter:card", { name: "twitter:card", content: "summary_large_image" });
  upsertMeta("twitter:title", { name: "twitter:title", content: "DCE Gallery" });
  upsertMeta("twitter:description", { name: "twitter:description", content: "Curated artwork for collectors." });
  upsertMeta("twitter:image", { name: "twitter:image", content: "" });

  upsertJsonLd({
    "@context": "https://schema.org",
    "@type": "ArtGallery",
    name: "DCE Gallery",
    url: origin + "/",
  });
}

// ---------- base UI shell ----------
const app = document.querySelector("#app");

app.innerHTML = `
  <header class="topbar">
    <div class="nav">
      <div class="brand">
        <a class="brandLink" href="#/" aria-label="DCE Gallery home">
          <div class="logo" aria-label="DCE Gallery logo">
            ${
              LOGO_URL
                ? `<img src="${safe(LOGO_URL)}" alt="DCE Gallery">`
                : `<span style="font-weight:900; letter-spacing:-0.2px;">DCE</span>`
            }
          </div>
          <div>
            <h1>DCE Gallery</h1>
            <p>Curated pieces for collectors</p>
          </div>
        </a>
      </div>

      <div class="actions" id="actions"></div>
    </div>
  </header>

  <main id="main" class="container">
    <div id="view"></div>

    <footer class="footer">
      <div>© ${new Date().getFullYear()} DCE Gallery</div>
      <div class="small">Secure checkout powered by Stripe (coming online).</div>
    </footer>
  </main>

  <div id="toast" class="toast" role="status" aria-live="polite"></div>
`;

const viewEl = document.querySelector("#view");
const actionsEl = document.querySelector("#actions");
const toastEl = document.querySelector("#toast");

const toast = (msg) => {
  toastEl.textContent = msg;
  toastEl.classList.add("show");
  window.clearTimeout(toastEl._t);
  toastEl._t = window.setTimeout(() => toastEl.classList.remove("show"), 4200);
};

let ALL = [];
let LOADED = false;

async function loadArtIfNeeded() {
  if (LOADED) return;
  if (!API_BASE) throw new Error("Missing VITE_API_BASE");
  const res = await fetch(`${API_BASE}/api/content/art`);
  if (!res.ok) throw new Error(`API error: ${res.status}`);
  const items = await normalizeListResponse(res);
  ALL = Array.isArray(items) ? items : [];
  LOADED = true;
}

// ---------- list view ----------
function renderListShell() {
  actionsEl.innerHTML = `
    <input id="search" class="pill search" type="search" placeholder="Search titles…" />
    <select id="filter" class="pill" aria-label="Filter">
      <option value="available">Available</option>
      <option value="all">All</option>
    </select>
  `;

  viewEl.innerHTML = `
    <section class="hero">
      <div class="heroTop">
        <div>
          <h2>Artwork for collectors.</h2>
          <p class="sub">A small, curated selection. New pieces added regularly.</p>
        </div>
      </div>

      <div class="heroCard">
        <div>
          <div id="status" style="font-weight:700;">Loading…</div>
          <div id="status2" class="small"></div>
        </div>
        <div class="small">API: <span id="apiBase"></span></div>
      </div>
    </section>

    <section>
      <div id="grid" class="grid"></div>
    </section>
  `;

  viewEl.querySelector("#apiBase").textContent = API_BASE || "(missing VITE_API_BASE)";
}

function applyFiltersAndRender() {
  const searchEl = document.querySelector("#search");
  const filterEl = document.querySelector("#filter");
  const statusEl = document.querySelector("#status");
  const status2El = document.querySelector("#status2");
  const grid = document.querySelector("#grid");

  const q = (searchEl.value || "").trim().toLowerCase();
  const mode = filterEl.value;

  let items = [...ALL];

  if (mode === "available") {
    items = items.filter((x) => {
      const n = normalizeItem(x);
      const priceCents = getPriceCents(n);
      return isPublished(n) && !isSold(n) && wantsWebsite(n) && !!priceCents;
    });
  }

  if (q) {
    items = items.filter((x) => {
      const n = normalizeItem(x);
      const hay = [n?.title, n?._title, n?.slug, n?._slug, n?.artist_name].join(" ").toLowerCase();
      return hay.includes(q);
    });
  }

  statusEl.textContent = `${items.length} piece(s)`;
  status2El.textContent =
    filterEl.value === "available"
      ? "Showing available pieces only."
      : "Showing all items returned by the API.";

  grid.innerHTML = items
    .map((raw) => {
      const n = normalizeItem(raw);

      const title = n?.title || n?._title || "Untitled";
      const slug = n?.slug || n?._slug || "";
      const img = pickImageUrl(n);

      const currency = n?.currency || "USD";
      const priceCents = getPriceCents(n);
      const priceText = priceCents ? formatMoney(priceCents, currency) : "";

      const ex = excerpt(n);

      const badgeSold = isSold(n) ? `<span class="badge sold">Sold</span>` : "";
      const note = n?.availability_note ? `<span class="badge note">${safe(n.availability_note)}</span>` : "";

      const canBuy = isPublished(n) && !isSold(n) && wantsWebsite(n) && !!priceCents;

      const href = slug ? detailUrlForSlug(slug) : "#/";

      return `
        <article class="card">
          <a class="cardLink" href="${href}" aria-label="View ${safe(title)}">
            <div class="media">
              <div class="badges">
                ${badgeSold}
                ${note}
              </div>
              ${
                img
                  ? `<img src="${safe(img)}" alt="${safe(title)}" loading="lazy" decoding="async" />`
                  : `<div class="small" style="padding:12px;">No image yet</div>`
              }
            </div>

            <div class="content">
              <div class="title">${safe(title)}</div>

              ${n?.artist_name || n?.year ? `<div class="meta">${safe(n?.artist_name || "")}${n?.year ? ` • ${safe(n.year)}` : ""}</div>` : ``}
              ${ex ? `<div class="meta">${safe(ex)}</div>` : ``}

              <div class="priceRow">
                <div class="price">${priceText || `<span class="small">Price on request</span>`}</div>
                <div class="small">${wantsWebsite(n) ? "Online" : ""}</div>
              </div>
            </div>
          </a>

          <div class="content" style="padding-top:0;">
            <div class="btnRow">
              <button class="btn primary" data-buy="${safe(slug)}" ${canBuy ? "" : "disabled"}>
                ${canBuy ? "Buy" : (isSold(n) ? "Sold" : "Unavailable")}
              </button>
            </div>
          </div>
        </article>
      `;
    })
    .join("");

  grid.querySelectorAll("button[data-buy]").forEach((btn) => {
    btn.addEventListener("click", async (e) => {
      e.preventDefault();
      e.stopPropagation();

      const slug = btn.getAttribute("data-buy");
      if (!slug) return;

      if (!API_BASE) {
        toast("Missing VITE_API_BASE on the storefront Netlify site.");
        return;
      }

      btn.disabled = true;
      const oldText = btn.textContent;
      btn.textContent = "Starting checkout…";

      try {
        const res = await fetch(`${API_BASE}/api/gizmos/stripe/public/create-checkout-session`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ slug }),
        });

        const data = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(data?.error || `Checkout error (${res.status})`);

        if (data?.url) {
          window.location.href = data.url;
        } else {
          throw new Error("No checkout URL returned yet (Stripe gizmo not fully configured).");
        }
      } catch (err) {
        console.error(err);
        toast(err.message || "Checkout failed. (Stripe not configured yet.)");
        btn.disabled = false;
        btn.textContent = oldText;
      }
    });
  });
}

async function showList() {
  setDefaultSeo();
  renderListShell();

  const statusEl = document.querySelector("#status");
  const status2El = document.querySelector("#status2");

  try {
    statusEl.textContent = "Loading…";
    status2El.textContent = "";
    await loadArtIfNeeded();

    const searchEl = document.querySelector("#search");
    const filterEl = document.querySelector("#filter");
    searchEl.addEventListener("input", applyFiltersAndRender);
    filterEl.addEventListener("change", applyFiltersAndRender);

    applyFiltersAndRender();
  } catch (e) {
    statusEl.textContent = "Failed to load art.";
    status2El.textContent = e.message || "Check API + CORS + VITE_API_BASE.";
  }
}

// ---------- detail view ----------
function setArtSeo(n) {
  const origin = currentSiteOrigin();
  const title = n?.title || n?._title || "Artwork";
  const slug = n?.slug || n?._slug || "";
  const img = pickImageUrl(n);
  const desc = excerpt(n, 180) || "Artwork listing from DCE Gallery.";
  const url = origin + "/" + detailUrlForSlug(slug);

  document.title = `${title} | DCE Gallery`;

  upsertMeta("description", { name: "description", content: desc });
  upsertLink("canonical", origin + "/");

  upsertMeta("og:title", { property: "og:title", content: title });
  upsertMeta("og:description", { property: "og:description", content: desc });
  upsertMeta("og:type", { property: "og:type", content: "product" });
  upsertMeta("og:url", { property: "og:url", content: url });
  upsertMeta("og:image", { property: "og:image", content: img || "" });

  upsertMeta("twitter:card", { name: "twitter:card", content: "summary_large_image" });
  upsertMeta("twitter:title", { name: "twitter:title", content: title });
  upsertMeta("twitter:description", { name: "twitter:description", content: desc });
  upsertMeta("twitter:image", { name: "twitter:image", content: img || "" });

  const currency = n?.currency || "USD";
  const priceCents = getPriceCents(n);
  const availability = isSold(n) ? "https://schema.org/SoldOut" : "https://schema.org/InStock";

  upsertJsonLd({
    "@context": "https://schema.org",
    "@type": "Product",
    name: title,
    image: img ? [img] : undefined,
    description: desc,
    sku: n?.sku || undefined,
    brand: { "@type": "Brand", name: "DCE Gallery" },
    offers: priceCents
      ? {
          "@type": "Offer",
          priceCurrency: currency,
          price: (priceCents / 100).toFixed(2),
          availability,
          url,
        }
      : undefined,
  });
}

function dims(n) {
  const w = n?.width_in;
  const h = n?.height_in;
  const d = n?.depth_in;
  const parts = [];
  if (Number.isFinite(w)) parts.push(`${w}″ W`);
  if (Number.isFinite(h)) parts.push(`${h}″ H`);
  if (Number.isFinite(d) && d) parts.push(`${d}″ D`);
  return parts.join(" • ");
}

async function showDetail(slug) {
  actionsEl.innerHTML = `
    <a class="pill" href="#/">← Back</a>
  `;

  viewEl.innerHTML = `
    <div class="heroCard">
      <div>
        <div style="font-weight:700;">Loading artwork…</div>
        <div class="small">Preparing details</div>
      </div>
    </div>
  `;

  try {
    await loadArtIfNeeded();

    const raw = ALL.find((x) => {
      const n = normalizeItem(x);
      return (n?.slug || n?._slug || "") === slug;
    });

    if (!raw) {
      viewEl.innerHTML = `
        <div class="heroCard">
          <div>
            <div style="font-weight:800;">Not found</div>
            <div class="small">We couldn’t find that piece. <a href="#/">Go back</a>.</div>
          </div>
        </div>
      `;
      setDefaultSeo();
      return;
    }

    const n = normalizeItem(raw);
    setArtSeo(n);

    const title = n?.title || n?._title || "Untitled";
    const img = pickImageUrl(n);
    const currency = n?.currency || "USD";
    const priceCents = getPriceCents(n);
    const priceText = priceCents ? formatMoney(priceCents, currency) : "Price on request";
    const canBuy = isPublished(n) && !isSold(n) && wantsWebsite(n) && !!priceCents;

    const metaLine = [
      n?.artist_name ? safe(n.artist_name) : "",
      n?.year ? safe(n.year) : "",
      n?.medium ? safe(n.medium) : "",
    ].filter(Boolean).join(" • ");

    const dimLine = dims(n);
    const rich = tiptapToHtml(n?.description);

    viewEl.innerHTML = `
      <div class="detailTop">
        <div class="breadcrumb">
          <a href="#/">Home</a>
          <span>›</span>
          <span>${safe(title)}</span>
        </div>
        <div class="small">SKU: ${safe(n?.sku || "—")}</div>
      </div>

      <div class="detailWrap">
        <section class="detailMain">
          <div class="detailImage">
            ${
              img
                ? `<img src="${safe(img)}" alt="${safe(title)}" loading="eager" decoding="async" />`
                : `<div class="small">No image yet</div>`
            }
          </div>
          <div class="detailBody">
            <h2 class="h1">${safe(title)}</h2>
            <p class="kicker">${metaLine || ""}</p>
            ${dimLine ? `<p class="kicker">${safe(dimLine)}</p>` : ``}

            ${rich ? `<div class="rich">${rich}</div>` : `<p class="small">No description yet.</p>`}
          </div>
        </section>

        <aside class="detailSide">
          <div class="sidePad">
            <div class="price" style="font-size:18px;">${priceText}</div>
            <div class="small" style="margin-top:6px;">
              ${isSold(n) ? "Sold" : (wantsWebsite(n) ? "Available online" : "Not listed for website")}
              ${n?.framed ? " • Framed" : ""}
            </div>

            <div style="height:12px;"></div>

            <button class="btn primary" id="buyBtn" ${canBuy ? "" : "disabled"}>
              ${canBuy ? "Buy now" : (isSold(n) ? "Sold" : "Unavailable")}
            </button>

            ${n?.availability_note ? `<div class="small" style="margin-top:10px;">${safe(n.availability_note)}</div>` : ""}

            <hr style="border:0;border-top:1px solid rgba(14,15,19,0.10); margin:16px 0;" />

            <div class="small">
              ${n?.provenance ? `<div><strong>Provenance:</strong> ${safe(n.provenance)}</div>` : ``}
              ${n?.condition ? `<div><strong>Condition:</strong> ${safe(n.condition)}</div>` : ``}
              ${n?.shipping_class ? `<div><strong>Shipping class:</strong> ${safe(n.shipping_class)}</div>` : ``}
              ${n?.shipping_note ? `<div><strong>Shipping note:</strong> ${safe(n.shipping_note)}</div>` : ``}
            </div>
          </div>
        </aside>
      </div>
    `;

    const buyBtn = document.querySelector("#buyBtn");
    buyBtn?.addEventListener("click", async () => {
      if (!API_BASE) {
        toast("Missing VITE_API_BASE on the storefront Netlify site.");
        return;
      }
      buyBtn.disabled = true;
      const old = buyBtn.textContent;
      buyBtn.textContent = "Starting checkout…";

      try {
        const res = await fetch(`${API_BASE}/api/gizmos/stripe/public/create-checkout-session`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ slug }),
        });

        const data = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(data?.error || `Checkout error (${res.status})`);

        if (data?.url) window.location.href = data.url;
        else throw new Error("No checkout URL returned yet (Stripe gizmo not fully configured).");
      } catch (err) {
        console.error(err);
        toast(err.message || "Checkout failed.");
        buyBtn.disabled = false;
        buyBtn.textContent = old;
      }
    });
  } catch (e) {
    console.error(e);
    viewEl.innerHTML = `
      <div class="heroCard">
        <div>
          <div style="font-weight:800;">Failed to load artwork.</div>
          <div class="small">${safe(e.message || "Check API + CORS + VITE_API_BASE.")}</div>
        </div>
      </div>
    `;
    setDefaultSeo();
  }
}

// ---------- router ----------
function parseRoute() {
  const h = window.location.hash || "#/";
  // #/art/<slug>
  const parts = h.replace(/^#\/?/, "").split("/").filter(Boolean);
  if (parts[0] === "art" && parts[1]) {
    return { name: "detail", slug: decodeURIComponent(parts[1]) };
  }
  return { name: "list" };
}

async function renderRoute() {
  const r = parseRoute();
  if (r.name === "detail") return showDetail(r.slug);
  return showList();
}

window.addEventListener("hashchange", renderRoute);

// boot
setDefaultSeo();
renderRoute();
