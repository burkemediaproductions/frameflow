import express from "express";
import Stripe from "stripe";
import { buildShippingOptions } from "./shipping.js";

const router = express.Router();

/**
 * Small helper: fetch with timeout (Node 18+ / 20+ supports AbortController).
 */
async function fetchWithTimeout(url, options = {}, timeoutMs = 8000) {
  const controller = new AbortController();
  const t = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, { ...options, signal: controller.signal });
    return res;
  } finally {
    clearTimeout(t);
  }
}

/**
 * Base URL for your API when the server calls itself.
 * Prefer env, but fallback to incoming request host.
 */
function getApiBase(req) {
  const env =
    process.env.SERVICEUP_API_BASE ||
    process.env.API_BASE ||
    process.env.PUBLIC_API_BASE ||
    "";

  if (env && typeof env === "string") return env.replace(/\/+$/, "");

  // Fallback: derive from request host
  const proto =
    (req.headers["x-forwarded-proto"] || "").toString().split(",")[0].trim() ||
    (req.secure ? "https" : "http");
  const host =
    (req.headers["x-forwarded-host"] || "").toString().split(",")[0].trim() ||
    req.headers.host;

  return `${proto}://${host}`.replace(/\/+$/, "");
}

/**
 * Fetch published art list from the public endpoint:
 * GET /api/content/art?status=published
 * Then find by id/slug locally (fine for small inventories).
 */
async function getPublishedArtByIdOrSlug({ req, id, slug }) {
  const base = getApiBase(req);
  const url = `${base}/api/content/art?status=published`;

  const res = await fetchWithTimeout(
    url,
    {
      method: "GET",
      headers: { Accept: "application/json" },
    },
    Number(process.env.STRIPE_ART_FETCH_TIMEOUT_MS || 8000)
  );

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(
      `Art fetch failed: ${res.status} ${res.statusText} (url=${url}) body=${text.slice(
        0,
        300
      )}`
    );
  }

  const items = await res.json();
  const list = Array.isArray(items) ? items : items?.data || [];

  const wantId = id ? String(id) : null;
  const wantSlug = slug ? String(slug) : null;

  const match = list.find((x) => {
    const item = x?.data ? { ...x, ...x.data } : x; // support either shape
    const itemId = item?.id ? String(item.id) : null;
    const itemSlug = item?.slug || item?._slug ? String(item.slug || item._slug) : null;
    return (wantId && itemId === wantId) || (wantSlug && itemSlug === wantSlug);
  });

  // Normalize: ServiceUp entries usually have { title, slug, status, data }
  // Your public endpoint in this install already returns a flattened object in many places,
  // so we normalize to a single object with "art.<field>" style.
  if (!match) return null;

  // If it is an entry row, merge .data onto top-level for easier consumption
  const normalized =
    match?.data && typeof match.data === "object" ? { ...match.data, ...match } : match;

  return normalized;
}

/**
 * Parse price cents:
 * - Prefer numeric price_cents if it looks like cents
 * - If price_cents is too small but "price" string exists (e.g. "3,333.00"),
 *   parse the string and convert to cents.
 */
function resolvePriceCents(art) {
  const raw = art?.price_cents;

  // If it’s a valid integer and "seems like cents" (>= 1000 for most art),
  // accept it as-is.
  if (Number.isFinite(Number(raw))) {
    const n = Number(raw);

    // If someone put dollars instead of cents, it will often be "3333" while
    // price string shows "3,333.00". We detect that and fallback.
    if (n >= 10000) return Math.round(n); // likely cents already (>= $100.00)

    // If n is small, only accept it if there's no price string to contradict it.
    if (!art?.price) return Math.round(n);
  }

  // Fallback: parse "price" like "3,333.00"
  const p = String(art?.price || "")
    .replace(/[^0-9.]/g, "")
    .trim();

  if (!p) return null;

  const val = Number(p);
  if (!Number.isFinite(val) || val <= 0) return null;

  return Math.round(val * 100);
}

/* -------------------------
   Webhook (raw body!)
-------------------------- */
router.post(
  "/webhook",
  express.raw({ type: "application/json" }),
  async (req, res) => {
    const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;
    if (!webhookSecret) {
      return res.status(400).json({ error: "Missing STRIPE_WEBHOOK_SECRET" });
    }

    const secretKey = process.env.STRIPE_SECRET_KEY;
    if (!secretKey) {
      return res.status(500).json({ error: "Missing STRIPE_SECRET_KEY" });
    }

    const stripe = new Stripe(secretKey, { apiVersion: "2024-06-20" });

    let event;
    try {
      const sig = req.headers["stripe-signature"];
      event = stripe.webhooks.constructEvent(req.body, sig, webhookSecret);
    } catch (err) {
      return res.status(400).send(`Webhook Error: ${err.message}`);
    }

    try {
      if (event.type === "checkout.session.completed") {
        const session = event.data.object;

        console.log("[STRIPE] checkout.session.completed", {
          id: session.id,
          amount_total: session.amount_total,
          currency: session.currency,
          art_id: session?.metadata?.art_id,
          art_slug: session?.metadata?.art_slug,
          shipping_class: session?.metadata?.shipping_class,
        });

        // Later (you said next):
        // - mark art as sold
        // - hide sold pieces automatically
      }

      res.json({ received: true });
    } catch (e) {
      console.error("[STRIPE] webhook handler error", e);
      res.status(500).json({ error: "Webhook handler failed" });
    }
  }
);

/* -------------------------
   JSON routes
-------------------------- */
router.use(express.json());

/**
 * GET helper (optional): nice for testing in browser.
 * /api/gizmos/stripe/health
 */
router.get("/health", (_req, res) => {
  res.json({
    ok: true,
    hasSecretKey: !!process.env.STRIPE_SECRET_KEY,
    hasWebhookSecret: !!process.env.STRIPE_WEBHOOK_SECRET,
    siteUrl: process.env.SITE_URL || null,
    serviceupApiBase:
      process.env.SERVICEUP_API_BASE ||
      process.env.API_BASE ||
      process.env.PUBLIC_API_BASE ||
      null,
  });
});

/**
 * POST /api/gizmos/stripe/create-checkout-session
 * Body: { id?: string, slug?: string }
 *
 * This must be PUBLIC (no auth token), which you’re already trying to do.
 */
router.post("/create-checkout-session", async (req, res) => {
  try {
    const secretKey = process.env.STRIPE_SECRET_KEY;
    if (!secretKey) {
      return res.status(500).json({ error: "Missing STRIPE_SECRET_KEY" });
    }

    const siteUrl = process.env.SITE_URL;
    if (!siteUrl) {
      return res.status(500).json({ error: "Missing SITE_URL" });
    }

    const stripe = new Stripe(secretKey, { apiVersion: "2024-06-20" });

    const { id, slug } = req.body || {};
    if (!id && !slug) {
      return res.status(400).json({ error: "Provide id or slug" });
    }

    // Pull art from public content list endpoint and find match
    const art = await getPublishedArtByIdOrSlug({ req, id, slug });
    if (!art) return res.status(404).json({ error: "Art not found" });

    // Ensure published (launch-safe)
    const status = String(art.status || art._status || "").toLowerCase();
    if (status && status !== "published") {
      return res.status(400).json({ error: "Art is not published" });
    }

    // Resolve price cents robustly
    const priceCents = resolvePriceCents(art);
    if (!Number.isFinite(priceCents) || priceCents <= 0) {
      return res.status(400).json({
        error:
          "Invalid pricing. Provide price_cents in cents (e.g. 333300) OR a price string like '3,333.00'.",
      });
    }

    const currency = String(art.currency || "USD").toLowerCase();

    const title = art.title || art._title || "Artwork";
    const slugSafe = String(art.slug || art._slug || "");
    const skuSafe = String(art.sku || "");

    const imageUrl =
      art?.primary_image?.publicUrl ||
      art?.primary_image?.url ||
      art?.primary_image ||
      null;

    const shippingClass = art.shipping_class || "Small";

    const shipping_options = buildShippingOptions({
      shippingClass,
      currency,
    });

    const successPath = process.env.STRIPE_SUCCESS_PATH || "/success";
    const cancelPath =
      process.env.STRIPE_CANCEL_PATH || `/art/${encodeURIComponent(slugSafe)}`;

    const session = await stripe.checkout.sessions.create({
      mode: "payment",
      line_items: [
        {
          price_data: {
            currency,
            product_data: {
              name: title,
              ...(imageUrl ? { images: [imageUrl] } : {}),
              metadata: {
                art_slug: slugSafe,
                sku: skuSafe,
              },
            },
            unit_amount: Math.round(priceCents),
          },
          quantity: 1,
        },
      ],

      // ✅ US-only shipping enforcement
      shipping_address_collection: {
        allowed_countries: ["US"],
      },

      // ✅ Your rate table (includes CA discount + rest-of-US)
      shipping_options,

      // Optional later:
      // automatic_tax: { enabled: true },

      metadata: {
        art_id: String(art.id || ""),
        art_slug: slugSafe,
        shipping_class: String(shippingClass),
      },

      success_url: `${siteUrl}${successPath}?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${siteUrl}${cancelPath}`,
    });

    res.json({ url: session.url, id: session.id });
  } catch (e) {
    console.error("[STRIPE] create-checkout-session error", e);
    res.status(500).json({
      error: e?.message || "Stripe checkout failed",
    });
  }
});

export default router;
