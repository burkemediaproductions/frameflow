const API_BASE = import.meta.env.VITE_API_BASE;

const LOGO_URL =
  import.meta.env.VITE_LOGO_URL ||
  "https://nvvdqdomdbgcljlxbiwm.supabase.co/storage/v1/object/public/branding/logoUrl-1767926048166.png";

// ---------- helpers ----------
const safe = (s) => (typeof s === "string" ? s : "");
const clamp = (n, a, b) => Math.max(a, Math.min(b, n));

function formatUSDFromCents(cents) {
  const n = Number(cents);
  if (!Number.isFinite(n)) return null;
  // Your data uses price_cents=3333 but you want $33.33, so treat as cents.
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 2,
  }).format(n / 100);
}

function toPlainTextFromTiptap(doc) {
  try {
    if (!doc || typeof doc !== "object") return "";
    const out = [];
    const walk = (node) => {
      if (!node) return;
      if (node.type === "text" && typeof node.text === "string") out.push(node.text);
      if (Array.isArray(node.content)) node.content.forEach(walk);
    };
    walk(doc);
    return out.join("").replace(/\s+/g, " ").trim();
  } catch {
    return "";
  }
}

function slugify(s) {
  return safe(s)
    .toLowerCase()
    .trim()
    .replace(/[“”"]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "");
}

function normalizeItem(raw) {
  // ServiceUp returns content rows with a "data" object or can return flattened fields.
  const data = raw?.data && typeof raw.data === "object" ? raw.data : raw || {};
  return {
    ...data,
    // some installs include these at root
    _id: raw?.id || data?.id,
    _created_at: raw?.created_at || data?.created_at,
  };
}

function getPublicUrlFromImageField(img) {
  if (!img) return null;
  // Your image field has .publicUrl (from Supabase storage)
  if (typeof img === "string") return img;
  if (typeof img === "object") {
    return img.publicUrl || img.url || img.src || null;
  }
  return null;
}

function isAvailable(item) {
  // you can change this later once you add a true inventory / availability field
  const status = safe(item?.status || item?._status).toLowerCase();
  if (status && status !== "published") return false;
  // If channel includes Website, consider it “available” by default
  const ch = item?.channel;
  if (Array.isArray(ch) && ch.length) return ch.includes("Website");
  return true;
}

// ---------- API ----------
async function fetchJSON(url) {
  const res = await fetch(url, { headers: { Accept: "application/json" } });
  if (!res.ok) {
    const t = await res.text().catch(() => "");
    throw new Error(`HTTP ${res.status} ${res.statusText}: ${t.slice(0, 120)}`);
  }
  return res.json();
}

async function fetchArtList() {
  // ServiceUp content endpoint is: /api/content/:slug
  // Your content type slug is "art"
  const url = `${API_BASE.replace(/\/$/, "")}/api/content/art`;
  const data = await fetchJSON(url);

  // Support a few shapes:
  // - { items: [...] }
  // - { data: [...] }
  // - [...]
  const items = Array.isArray(data) ? data : Array.isArray(data?.items) ? data.items : Array.isArray(data?.data) ? data.data : [];
  return items;
}

async function fetchArtBySlug(slug) {
  // easiest: pull list and find by slug (small catalog)
  const list = await fetchArtList();
  const norm = list.map(normalizeItem);
  const found = norm.find((x) => safe(x.slug || x._slug) === slug);
  return found || null;
}

// ---------- UI ----------
const app = document.querySelector("#app");

app.innerHTML = `
  <header class="header">
    <div class="container nav">

      <div class="header-left">
      <div class="header-left">
  <a class="brand" href="/" aria-label="DCE Gallery home">
    <img
      class="brand-logo"
      src="https://nvvdqdomdbgcljlxbiwm.supabase.co/storage/v1/object/public/branding/logoUrl-1767918829592.png"
      alt="DCE Gallery"
      width="320"
      height="96"
      loading="eager"
      decoding="async"
    />
    <span class="sr-only">DCE Gallery</span>
  </a>

  <div class="brand-tagline">
    Curated pieces for collectors
  </div>
</div>

      <div class="actions">
        <div class="searchWrap">
          <input id="search" class="search" type="search" placeholder="Search titles…" aria-label="Search titles" />
        </div>

        <select id="filter" class="pill" aria-label="Filter">
          <option value="available">Available</option>
          <option value="all">All</option>
        </select>
      </div>

    </div>
  </header>

  <main id="main" class="container">
    <div id="view"></div>

    <footer class="footer">
      <div>© ${new Date().getFullYear()} DCE Gallery</div>
    </footer>
  </main>

  <div id="toast" class="toast" role="status" aria-live="polite"></div>
`;

const viewEl = document.querySelector("#view");
const toastEl = document.querySelector("#toast");

function toast(msg) {
  toastEl.textContent = msg;
  toastEl.classList.add("show");
  window.clearTimeout(toastEl._t);
  toastEl._t = window.setTimeout(() => toastEl.classList.remove("show"), 2600);
}

function setHeadMeta({ title, description, canonicalPath, image }) {
  // minimal, but effective
  document.title = title || "DCE Gallery";
  const metaDesc = document.querySelector('meta[name="description"]');
  if (metaDesc) metaDesc.setAttribute("content", description || "DCE Gallery — curated artwork for collectors.");

  const url = new URL(window.location.href);
  const canonical = url.origin + canonicalPath;

  let link = document.querySelector('link[rel="canonical"]');
  if (!link) {
    link = document.createElement("link");
    link.setAttribute("rel", "canonical");
    document.head.appendChild(link);
  }
  link.setAttribute("href", canonical);

  // OpenGraph / Twitter (optional, but nice)
  const upsertMeta = (attr, key, content) => {
    let m = document.querySelector(`meta[${attr}="${key}"]`);
    if (!m) {
      m = document.createElement("meta");
      m.setAttribute(attr, key);
      document.head.appendChild(m);
    }
    m.setAttribute("content", content || "");
  };

  upsertMeta("property", "og:title", title || "DCE Gallery");
  upsertMeta("property", "og:description", description || "");
  upsertMeta("property", "og:type", canonicalPath?.startsWith("/art/") ? "article" : "website");
  upsertMeta("property", "og:url", canonical);
  upsertMeta("property", "og:image", image || "");

  upsertMeta("name", "twitter:card", "summary_large_image");
  upsertMeta("name", "twitter:title", title || "DCE Gallery");
  upsertMeta("name", "twitter:description", description || "");
  upsertMeta("name", "twitter:image", image || "");

  // JSON-LD (basic)
  let jsonld = document.querySelector('script[type="application/ld+json"]');
  if (!jsonld) {
    jsonld = document.createElement("script");
    jsonld.type = "application/ld+json";
    document.head.appendChild(jsonld);
  }

  const schema =
    canonicalPath?.startsWith("/art/")
      ? {
          "@context": "https://schema.org",
          "@type": "Product",
          name: title,
          description,
          image: image ? [image] : undefined,
          brand: { "@type": "Brand", name: "DCE Gallery" },
          url: canonical,
        }
      : {
          "@context": "https://schema.org",
          "@type": "WebSite",
          name: "DCE Gallery",
          url: canonical,
          description: "Curated artwork for collectors.",
        };

  jsonld.textContent = JSON.stringify(schema);
}

function renderListView({ items = [] }) {
  setHeadMeta({
    title: "DCE Gallery — Curated Artwork",
    description: "A small, curated selection of artwork. New pieces added regularly.",
    canonicalPath: "/",
    image: LOGO_URL || "",
  });

  viewEl.innerHTML = `
    <section class="hero">
      <div class="heroBg" aria-hidden="true"></div>

      <div class="heroTop">
        <div>
          <h2>Artwork for collectors.</h2>
          <p class="sub">A small, curated selection. New pieces added regularly.</p>
        </div>
      </div>

      <div class="heroCard">
        <div>
          <div id="status" class="stat"></div>
          <div id="status2" class="small"></div>
        </div>
        <div class="small muted">Ships from U.S. • Secure checkout</div>
      </div>
    </section>

    <section>
      <div id="grid" class="grid"></div>
    </section>
  `;

  const statusEl = document.querySelector("#status");
  const status2El = document.querySelector("#status2");
  const grid = document.querySelector("#grid");
  const searchEl = document.querySelector("#search");
  const filterEl = document.querySelector("#filter");

  function apply() {
    const q = safe(searchEl.value).toLowerCase();
    const showAvailable = filterEl.value === "available";

    const filtered = items
      .map(normalizeItem)
      .filter((x) => {
        const title = safe(x.title || x._title).toLowerCase();
        const artist = safe(x.artist_name).toLowerCase();
        const medium = safe(x.medium).toLowerCase();
        const okSearch = !q || title.includes(q) || artist.includes(q) || medium.includes(q);
        const okAvail = !showAvailable || isAvailable(x);
        return okSearch && okAvail;
      });

    statusEl.textContent = `${filtered.length} piece(s)`;
    status2El.textContent = showAvailable ? "Showing available pieces only." : "Showing all pieces.";

    grid.innerHTML = filtered
      .map((raw) => {
        const n = normalizeItem(raw);

        const title = n?.title || n?._title || "Untitled";
        const slug = n?.slug || n?._slug || slugify(title);
        const artist = n?.artist_name ? safe(n.artist_name) : "";
        const year = n?.year ? safe(n.year) : "";

        const img = getPublicUrlFromImageField(n?.primary_image);
        const price = formatUSDFromCents(n?.price_cents);

        const descText = toPlainTextFromTiptap(n?.description);
        const excerpt = descText ? descText.slice(0, 140) + (descText.length > 140 ? "…" : "") : "A curated piece from our collection.";

        return `
          <article class="card">
            <a class="cardLink" href="#/art/${encodeURIComponent(slug)}" aria-label="${safe(title)}">
              <div class="imgWrap">
                ${img ? `<img class="img" src="${img}" alt="${safe(title)}" loading="lazy" decoding="async" />` : `<div class="imgPh" aria-hidden="true"></div>`}
              </div>

              <div class="cardBody">
                <h3 class="title">${safe(title)}</h3>

                <div class="meta">
                  ${artist ? `<span>${artist}</span>` : ""}
                  ${artist && year ? `<span class="dot">•</span>` : ""}
                  ${year ? `<span>${year}</span>` : ""}
                </div>

                <p class="excerpt">${safe(excerpt)}</p>

                <div class="bottom">
                  <div class="price">${price ? price : "<span class='muted'>Price on request</span>"}</div>
                  <div class="pillSmall">${isAvailable(n) ? "Online" : "Unavailable"}</div>
                </div>
              </div>
            </a>
          </article>
        `;
      })
      .join("");
  }

  searchEl.addEventListener("input", apply);
  filterEl.addEventListener("change", apply);

  apply();
}


async function createStripeCheckoutSession({ entry }) {
  const base = API_BASE.replace(/\/$/, "");
  const url = `${base}/api/gizmos/stripe/create-checkout-session`;

  const res = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json",
    },
    body: JSON.stringify({ entry }), // entry can be ID or slug
  });

  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(data?.error || `HTTP ${res.status} ${res.statusText}`);
  }

  if (!data?.url) throw new Error("Stripe did not return a checkout url.");
  return data; // { id, url }
}


function renderDetailView(item, slug) {
  const n = normalizeItem(item || {});
  const title = n?.title || n?._title || "Artwork";
  const img = getPublicUrlFromImageField(n?.primary_image);
  const artist = safe(n?.artist_name);
  const year = safe(n?.year);
  const medium = safe(n?.medium);
  const framed = typeof n?.framed === "boolean" ? (n.framed ? "Framed" : "Unframed") : "";
  const dims =
    [n?.width_in, n?.height_in, n?.depth_in]
      .map((x) => (Number.isFinite(Number(x)) ? Number(x) : null))
      .filter(Boolean)
      .slice(0, 3)
      .join(" × ") || "";

  const price = formatUSDFromCents(n?.price_cents);
  const descText = toPlainTextFromTiptap(n?.description);
  const description = descText || "A curated piece from our collection.";

  setHeadMeta({
    title: `${title} — DCE Gallery`,
    description: description.slice(0, 160),
    canonicalPath: `/art/${encodeURIComponent(slug)}`,
    image: img || LOGO_URL || "",
  });

  viewEl.innerHTML = `
    <section class="detail">
      <a class="back" href="#/">&larr; Back to all artwork</a>

      <div class="detailGrid">
        <div class="detailMedia">
          ${img ? `<img class="detailImg" src="${img}" alt="${safe(title)}" />` : `<div class="detailPh"></div>`}
        </div>

        <div class="detailBody">
          <h1 class="detailTitle">${safe(title)}</h1>

          <div class="detailMeta">
            ${artist ? `<span>${artist}</span>` : ""}
            ${artist && year ? `<span class="dot">•</span>` : ""}
            ${year ? `<span>${year}</span>` : ""}
            ${(artist || year) && (medium || framed || dims) ? `<span class="dot">•</span>` : ""}
            ${medium ? `<span>${medium}</span>` : ""}
          </div>

          ${(framed || dims) ? `<div class="detailMeta2">${[framed, dims ? `${dims} in` : ""].filter(Boolean).join(" • ")}</div>` : ""}

          <div class="detailPriceRow">
            <div class="detailPrice">${price ? price : "Price on request"}</div>
            <div class="pillSmall">${isAvailable(n) ? "Online" : "Unavailable"}</div>
          </div>

          <div class="detailDesc">
            <h2>About this piece</h2>
            <p>${safe(description)}</p>
          </div>

          <div class="detailActions">
            <button class="btn" id="buyBtn" ${isAvailable(n) ? "" : "disabled"}>${isAvailable(n) ? "Buy" : "Unavailable"}</button>
            <button class="btnGhost" id="inquireBtn">Inquire</button>
          </div>

          <div class="detailFine muted">
            Shipping class: ${safe(n?.shipping_class) || "Standard"} • ${safe(n?.availability_note) || "Contact us for availability and shipping details."}
          </div>
        </div>
      </div>
    </section>
  `;

// Stripe Checkout
document.querySelector("#buyBtn")?.addEventListener("click", async () => {
  try {
    const btn = document.querySelector("#buyBtn");
    if (btn) {
      btn.disabled = true;
      btn.textContent = "Opening checkout…";
    }

    // Prefer DB id, fallback to slug
    const entry = n?._id || n?.id || n?.slug || n?._slug || slug;
    if (!entry) throw new Error("Missing entry id/slug for checkout.");

    const { url } = await createStripeCheckoutSession({ entry });
    window.location.href = url;
  } catch (e) {
    toast(safe(e?.message || e) || "Checkout error");
    const btn = document.querySelector("#buyBtn");
    if (btn) {
      btn.disabled = !isAvailable(n);
      btn.textContent = isAvailable(n) ? "Buy" : "Unavailable";
    }
  }
});

  document.querySelector("#inquireBtn")?.addEventListener("click", () => {
    toast("Inquiry: add contact form next (or mailto).");
  });
}

async function router() {
  const hash = window.location.hash || "#/";
  const m = hash.match(/^#\/art\/(.+)$/);

  if (!API_BASE) {
    viewEl.innerHTML = `<div class="empty"><h2>Missing VITE_API_BASE</h2><p class="sub">Set it in Netlify env vars for this site.</p></div>`;
    return;
  }

  try {
    if (m) {
      const slug = decodeURIComponent(m[1]);
      viewEl.innerHTML = `<div class="empty"><h2>Loading…</h2><p class="sub">Fetching artwork details.</p></div>`;
      const item = await fetchArtBySlug(slug);
      if (!item) {
        viewEl.innerHTML = `<div class="empty"><h2>Not found</h2><p class="sub">That artwork isn’t available.</p><p><a class="back" href="#/">&larr; Back</a></p></div>`;
        return;
      }
      renderDetailView(item, slug);
      return;
    }

    viewEl.innerHTML = `
      <div class="empty">
        <h2>Loading…</h2>
        <p class="sub">Fetching the latest pieces.</p>
      </div>
    `;

    const items = await fetchArtList();
    renderListView({ items });
  } catch (e) {
    viewEl.innerHTML = `
      <div class="empty">
        <h2>Couldn’t load artwork</h2>
        <p class="sub">${safe(e?.message || e)}</p>
        <button class="btn" id="retry">Retry</button>
      </div>
    `;
    document.querySelector("#retry")?.addEventListener("click", router);
  }
}

window.addEventListener("hashchange", router);
router();
