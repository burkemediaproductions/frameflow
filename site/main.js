const API_BASE = import.meta.env.VITE_API_BASE;

/**
 * Optional: drop a URL into VITE_LOGO_URL if you want the logo to come from env
 * (Netlify supports VITE_* vars).
 * Otherwise, it shows a nice placeholder box.
 */
const LOGO_URL = import.meta.env.VITE_LOGO_URL || "";

// ---------- helpers ----------
const isPublished = (item) => String(item?.status || "").toLowerCase() === "published";
const isSold = (item) => String(item?.status || "").toLowerCase() === "sold";

const pickImageUrl = (item) =>
  item?.primary_image?.publicUrl ||
  item?.primary_image?.public_url ||
  item?.primary_image?.url ||
  "";

// TipTap doc -> plain text excerpt (good enough for MVP)
const tiptapToText = (node) => {
  if (!node) return "";
  if (node.type === "text") return node.text || "";
  if (!node.content) return "";
  return node.content.map(tiptapToText).join("");
};

const excerpt = (item, maxLen = 140) => {
  const text = tiptapToText(item?.description).replace(/\s+/g, " ").trim();
  if (!text) return "";
  return text.length > maxLen ? text.slice(0, maxLen) + "…" : text;
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
  // strip commas, $ etc. keep digits + dot
  const numeric = Number(s.replace(/[^0-9.]/g, ""));
  if (!Number.isFinite(numeric) || numeric <= 0) return null;
  return Math.round(numeric * 100);
};

const getPriceCents = (item) => {
  const cents = item?.price_cents;
  if (typeof cents === "number" && Number.isFinite(cents) && cents > 0) return cents;
  // fallback to text "price" like "3,333.00"
  return parsePriceStringToCents(item?.price);
};

const channels = (item) => Array.isArray(item?.channel) ? item.channel : [];

const dims = (item) => {
  const w = item?.width_in;
  const h = item?.height_in;
  const d = item?.depth_in;
  const parts = [];
  if (Number.isFinite(w) && Number.isFinite(h)) parts.push(`${w}" × ${h}"`);
  if (Number.isFinite(d) && d) parts.push(`${d}" deep`);
  return parts.join(" • ");
};

const safe = (s) => String(s ?? "").replace(/[&<>"']/g, (m) => ({
  "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
}[m]));

// ---------- UI ----------
const app = document.querySelector("#app");

app.innerHTML = `
  <header class="topbar">
    <div class="nav">
      <div class="brand">
        <div class="logo" aria-label="DCE Art logo">
          ${LOGO_URL ? `<img src="${safe(LOGO_URL)}" alt="DCE Art">` : `<span style="font-weight:800;opacity:.9;">DCE</span>`}
        </div>
        <div>
          <h1>DCE Art</h1>
          <p>Curated pieces for collectors</p>
        </div>
      </div>

      <div class="actions">
        <input id="search" class="pill search" type="search" placeholder="Search title, artist, year…" />
        <select id="filter" class="pill" aria-label="Filter">
          <option value="published">Published</option>
          <option value="all">All</option>
        </select>
      </div>
    </div>
  </header>

  <div class="container">
    <section class="hero">
      <h2>Featured works</h2>
      <p class="sub">
        Browse available pieces. When you’re ready, purchase securely with Stripe.
      </p>

      <div class="statusRow">
        <div class="statusLeft">
          <div id="status">Loading…</div>
          <div class="small" id="status2"></div>
        </div>
        <div class="small">API: <span id="apiBase"></span></div>
      </div>
    </section>

    <section>
      <div id="grid" class="grid"></div>
    </section>
  </div>

  <div id="toast" class="toast" role="status" aria-live="polite"></div>
`;

document.querySelector("#apiBase").textContent = API_BASE || "(missing VITE_API_BASE)";

const statusEl = document.querySelector("#status");
const status2El = document.querySelector("#status2");
const grid = document.querySelector("#grid");
const searchEl = document.querySelector("#search");
const filterEl = document.querySelector("#filter");
const toastEl = document.querySelector("#toast");

let ALL = [];

const toast = (msg) => {
  toastEl.textContent = msg;
  toastEl.classList.add("show");
  window.clearTimeout(toastEl._t);
  toastEl._t = window.setTimeout(() => toastEl.classList.remove("show"), 4200);
};

function applyFilters() {
  const q = (searchEl.value || "").trim().toLowerCase();
  const mode = filterEl.value;

  let items = [...ALL];

  if (mode === "published") items = items.filter(isPublished);

  if (q) {
    items = items.filter((item) => {
      const hay = [
        item?.title,
        item?.artist_name,
        item?.year,
        item?.sku,
        item?.slug
      ].join(" ").toLowerCase();
      return hay.includes(q);
    });
  }

  render(items);
}

function render(items) {
  statusEl.textContent = `${items.length} item(s) shown`;
  status2El.textContent = filterEl.value === "published"
    ? "Showing published items only."
    : "Showing all items (includes drafts/sold if your API returns them).";

  grid.innerHTML = items.map((item) => {
    const title = item?.title || "Untitled";
    const artist = item?.artist_name ? safe(item.artist_name) : "";
    const year = item?.year ? safe(item.year) : "";
    const metaLine = [artist, year].filter(Boolean).join(" • ");

    const img = pickImageUrl(item);
    const currency = item?.currency || "USD";
    const priceCents = getPriceCents(item);
    const priceText = priceCents ? formatMoney(priceCents, currency) : "";

    const badgeSold = isSold(item) ? `<span class="badge sold">Sold</span>` : "";
    const note = item?.availability_note ? `<span class="badge note">${safe(item.availability_note)}</span>` : "";
    const shipping = item?.shipping_class ? `Shipping: ${safe(item.shipping_class)}` : "";
    const dimText = dims(item);
    const ex = excerpt(item);

    const canBuy = isPublished(item) && !isSold(item) && priceCents;

    return `
      <article class="card">
        <div class="media">
          <div class="badges">
            ${badgeSold}
            ${note}
          </div>
          ${img
            ? `<img src="${safe(img)}" alt="${safe(title)}">`
            : `<div class="small">No image</div>`
          }
        </div>

        <div class="content">
          <div class="title">${safe(title)}</div>

          ${metaLine ? `<div class="meta">${metaLine}</div>` : ``}
          ${dimText ? `<div class="meta">${safe(dimText)}</div>` : ``}
          ${shipping ? `<div class="meta">${shipping}</div>` : ``}
          ${ex ? `<div class="meta">${safe(ex)}</div>` : ``}

          <div class="priceRow">
            <div class="price">${priceText || `<span class="small">Price on request</span>`}</div>
            <div class="small">${channels(item).includes("Website") ? "Online" : ""}</div>
          </div>

          <div class="btnRow">
            <button class="btn primary" data-buy="${safe(item?.slug || "")}" ${canBuy ? "" : "disabled"}>
              ${canBuy ? "Buy with Stripe" : (isSold(item) ? "Sold" : "Unavailable")}
            </button>
          </div>
        </div>
      </article>
    `;
  }).join("");

  // buy buttons
  grid.querySelectorAll("button[data-buy]").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const slug = btn.getAttribute("data-buy");
      if (!slug) return;

      if (!API_BASE) {
        toast("Missing VITE_API_BASE on the storefront site.");
        return;
      }

      btn.disabled = true;
      btn.textContent = "Creating checkout…";

      try {
        // You will implement this endpoint on the API (steps below)
        const res = await fetch(`${API_BASE}/api/checkout/create`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          credentials: "include",
          body: JSON.stringify({ slug }),
        });

        const data = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(data?.error || `Checkout error (${res.status})`);

        if (data?.url) {
          window.location.href = data.url; // Stripe hosted checkout
        } else {
          throw new Error("No checkout URL returned.");
        }
      } catch (e) {
        console.error(e);
        toast(e.message || "Checkout failed. Check API logs + CORS.");
        btn.disabled = false;
        btn.textContent = "Buy with Stripe";
      }
    });
  });
}

async function loadArt() {
  if (!API_BASE) {
    statusEl.textContent = "Missing VITE_API_BASE environment variable.";
    status2El.textContent = "Set it in Netlify: VITE_API_BASE=https://<your-render-api>.onrender.com";
    return;
  }

  statusEl.textContent = "Loading…";

  try {
    // IMPORTANT: adjust this endpoint if your API uses a different path for listing art.
    // If your ServiceUp endpoint is /api/art (or /api/content/art), change it here.
    const res = await fetch(`${API_BASE}/api/art`, { credentials: "include" });
    if (!res.ok) throw new Error(`API error: ${res.status}`);

    const items = await res.json();
    ALL = Array.isArray(items) ? items : [];

    applyFilters();
  } catch (e) {
    console.error(e);
    statusEl.textContent = "Failed to load art.";
    status2El.textContent = e.message || "Check API + CORS.";
  }
}

searchEl.addEventListener("input", applyFilters);
filterEl.addEventListener("change", applyFilters);

loadArt();
