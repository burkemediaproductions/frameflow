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

const isPublished = (item) => String(item?.status || "").toLowerCase() === "published";
const isSold = (item) => String(item?.status || "").toLowerCase() === "sold";

const pickImageUrl = (item) =>
  item?.primary_image?.publicUrl ||
  item?.primary_image?.public_url ||
  item?.primary_image?.url ||
  "";

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
  const numeric = Number(s.replace(/[^0-9.]/g, ""));
  if (!Number.isFinite(numeric) || numeric <= 0) return null;
  return Math.round(numeric * 100);
};

const getPriceCents = (item) => {
  const cents = item?.price_cents;
  if (typeof cents === "number" && Number.isFinite(cents) && cents > 0) return cents;
  return parsePriceStringToCents(item?.price);
};

const channels = (item) => (Array.isArray(item?.channel) ? item.channel : []);
const wantsWebsite = (item) => channels(item).includes("Website");

// ---------- UI ----------
const app = document.querySelector("#app");

app.innerHTML = `
  <header class="topbar">
    <div class="nav">
      <div class="brand">
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
      </div>

      <div class="actions">
        <input id="search" class="pill search" type="search" placeholder="Search titles…" />
        <select id="filter" class="pill" aria-label="Filter">
          <option value="available">Available</option>
          <option value="all">All</option>
        </select>
      </div>
    </div>
  </header>

  <div class="container">
    <section class="hero">
      <div class="heroTop">
        <div>
          <h2>Artwork for collectors.</h2>
          <p class="sub">
            A small, curated selection. New pieces added regularly.
          </p>
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

    <footer class="footer">
      <div>© ${new Date().getFullYear()} DCE Gallery</div>
      <div class="small">Secure checkout powered by Stripe (coming online).</div>
    </footer>
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

const normalizeListResponse = async (res) => {
  const json = await res.json();
  if (Array.isArray(json)) return json;
  if (Array.isArray(json.items)) return json.items;
  if (Array.isArray(json.data)) return json.data;
  if (Array.isArray(json.rows)) return json.rows;
  return [];
};

function applyFilters() {
  const q = (searchEl.value || "").trim().toLowerCase();
  const mode = filterEl.value;

  let items = [...ALL];

  // Default: only show published, not sold, and intended for Website channel
  if (mode === "available") {
    items = items.filter((x) => isPublished(x) && !isSold(x) && wantsWebsite(x));
  }

  if (q) {
    items = items.filter((item) => {
      const hay = [item?.title, item?.slug].join(" ").toLowerCase();
      return hay.includes(q);
    });
  }

  render(items);
}

function render(items) {
  statusEl.textContent = `${items.length} piece(s)`;
  status2El.textContent =
    filterEl.value === "available"
      ? "Showing available pieces only."
      : "Showing all items returned by the API.";

  grid.innerHTML = items
    .map((item) => {
      const title = item?.title || "Untitled";
      const img = pickImageUrl(item);
      const ex = excerpt(item);

      const currency = item?.currency || "USD";
      const priceCents = getPriceCents(item);
      const priceText = priceCents ? formatMoney(priceCents, currency) : "";

      const badgeSold = isSold(item) ? `<span class="badge sold">Sold</span>` : "";
      const note = item?.availability_note ? `<span class="badge note">${safe(item.availability_note)}</span>` : "";

      const canBuy = isPublished(item) && !isSold(item) && wantsWebsite(item) && priceCents;

      return `
        <article class="card">
          <div class="media">
            <div class="badges">
              ${badgeSold}
              ${note}
            </div>
            ${
              img
                ? `<img src="${safe(img)}" alt="${safe(title)}" loading="lazy" />`
                : `<div class="small">No image yet</div>`
            }
          </div>

          <div class="content">
            <div class="title">${safe(title)}</div>

            ${ex ? `<div class="meta">${safe(ex)}</div>` : ``}

            <div class="priceRow">
              <div class="price">${priceText || `<span class="small">Price on request</span>`}</div>
              <div class="small">${wantsWebsite(item) ? "Online" : ""}</div>
            </div>

            <div class="btnRow">
              <button class="btn primary" data-buy="${safe(item?.slug || "")}" ${canBuy ? "" : "disabled"}>
                ${canBuy ? "Buy" : (isSold(item) ? "Sold" : "Unavailable")}
              </button>
            </div>
          </div>
        </article>
      `;
    })
    .join("");

  grid.querySelectorAll("button[data-buy]").forEach((btn) => {
    btn.addEventListener("click", async () => {
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
        // Stripe gizmo endpoint (we’ll wire keys + handler soon)
        const res = await fetch(`${API_BASE}/api/gizmos/stripe/public/create-checkout-session`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ slug }), // you can also pass { id } later if preferred
        });

        const data = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(data?.error || `Checkout error (${res.status})`);

        if (data?.url) {
          window.location.href = data.url;
        } else {
          throw new Error("No checkout URL returned yet (Stripe gizmo not fully configured).");
        }
      } catch (e) {
        console.error(e);
        toast(e.message || "Checkout failed. (Stripe not configured yet.)");
        btn.disabled = false;
        btn.textContent = oldText;
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
  status2El.textContent = "";

  try {
    // ✅ ServiceUp content endpoint (content type slug = art)
    const res = await fetch(`${API_BASE}/api/content/art`);
    if (!res.ok) throw new Error(`API error: ${res.status}`);

    const items = await normalizeListResponse(res);
    ALL = Array.isArray(items) ? items : [];

    applyFilters();
  } catch (e) {
    console.error(e);
    statusEl.textContent = "Failed to load art.";
    status2El.textContent = e.message || "Check API + CORS + VITE_API_BASE.";
  }
}

searchEl.addEventListener("input", applyFilters);
filterEl.addEventListener("change", applyFilters);

loadArt();
