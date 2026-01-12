import express from "express";
import Stripe from "stripe";
import { buildShippingOptions } from "./shipping.js";

const router = express.Router();

/* -------------------------
   Helpers
-------------------------- */

function isUuid(value) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
    String(value || "").trim()
  );
}

function requirePool(req) {
  const pool = req.app?.locals?.pool;
  if (!pool) throw new Error("Missing app.locals.pool (did you set app.locals.pool = pool in api/index.js?)");
  return pool;
}

async function lookupArtEntry(pool, entryOrSlugOrId) {
  const key = String(entryOrSlugOrId || "").trim();
  if (!key) return null;

  const { rows: ctRows } = await pool.query(
    "SELECT id FROM content_types WHERE slug = $1 LIMIT 1",
    ["art"]
  );
  if (!ctRows.length) return null;
  const typeId = ctRows[0].id;

  if (isUuid(key)) {
    const { rows } = await pool.query(
      "SELECT * FROM entries WHERE id = $1 AND content_type_id = $2 LIMIT 1",
      [key, typeId]
    );
    return rows[0] || null;
  }

  // treat as slug
  const { rows } = await pool.query(
    "SELECT * FROM entries WHERE slug = $1 AND content_type_id = $2 LIMIT 1",
    [key, typeId]
  );
  return rows[0] || null;
}

function entryData(entry) {
  return entry?.data && typeof entry.data === "object" ? entry.data : {};
}

function readTitle(entry) {
  return entry?.title || entryData(entry)?.title || "Artwork";
}

function readCurrency(entry) {
  return String(entryData(entry)?.currency || "USD").toLowerCase();
}

function readShippingClass(entry) {
  return entryData(entry)?.shipping_class || "Small";
}

function readSoldFlag(entry) {
  const d = entryData(entry);
  return !!(d?.sold || d?.is_sold || d?.status_sold);
}

function readImage(entry) {
  const d = entryData(entry);
  const img = d?.primary_image;
  return (
    img?.publicUrl ||
    img?.url ||
    (typeof img === "string" ? img : null) ||
    null
  );
}

function resolvePriceCents(entry) {
  const d = entryData(entry);

  const raw = d?.price_cents;
  if (Number.isFinite(Number(raw))) {
    const n = Number(raw);
    if (n >= 50) return Math.round(n); // assume cents
  }

  // fallback: parse price string like "3,333.00"
  const p = String(d?.price || "")
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
    if (!webhookSecret) return res.status(400).json({ error: "Missing STRIPE_WEBHOOK_SECRET" });

    const secretKey = process.env.STRIPE_SECRET_KEY;
    if (!secretKey) return res.status(500).json({ error: "Missing STRIPE_SECRET_KEY" });

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
          art_id: session?.metadata?.entry_id,
          art_slug: session?.metadata?.entry_slug,
          shipping_class: session?.metadata?.shipping_class,
        });

        // Next step: mark art as sold + hide sold pieces
      }

      res.json({ received: true });
    } catch (e) {
      console.error("[STRIPE] webhook handler error", e);
      res.status(500).json({ error: "Webhook handler failed" });
    }
  }
);

/* -------------------------
   JSON routes (normal parser)
-------------------------- */
router.use(express.json());

router.get("/public/__ping", (_req, res) => res.json({ ok: true }));

router.get("/public/health", (_req, res) => {
  res.json({
    ok: true,
    hasSecretKey: !!process.env.STRIPE_SECRET_KEY,
    hasWebhookSecret: !!process.env.STRIPE_WEBHOOK_SECRET,
    siteUrl: process.env.SITE_URL || null,
  });
});

/**
 * PUBLIC
 * POST /api/gizmos/stripe/public/create-checkout-session
 * Body: { entry: "<uuid|slug>" }   (also supports {id} or {slug} for convenience)
 */
router.post("/public/create-checkout-session", async (req, res) => {
  try {
    const secretKey = process.env.STRIPE_SECRET_KEY;
    if (!secretKey) return res.status(500).json({ error: "Missing STRIPE_SECRET_KEY" });

    const siteUrl = process.env.SITE_URL;
    if (!siteUrl) return res.status(500).json({ error: "Missing SITE_URL" });

    const stripe = new Stripe(secretKey, { apiVersion: "2024-06-20" });

    const entryKey = (req.body?.entry || req.body?.id || req.body?.slug || "").toString().trim();
    if (!entryKey) return res.status(400).json({ error: "Provide entry (uuid or slug)" });

    const pool = requirePool(req);
    const art = await lookupArtEntry(pool, entryKey);
    if (!art) return res.status(404).json({ error: "Art not found" });

    const status = String(art.status || "").toLowerCase();
    if (status !== "published") return res.status(400).json({ error: "Art is not published" });
    if (readSoldFlag(art)) return res.status(400).json({ error: "This piece has already been sold." });

    const priceCents = resolvePriceCents(art);
    if (!Number.isFinite(priceCents) || priceCents <= 0) {
      return res.status(400).json({
        error: "Invalid pricing. Provide data.price_cents (in cents) or data.price like '3,333.00'.",
      });
    }

    const title = readTitle(art);
    const currency = readCurrency(art);
    const imageUrl = readImage(art);
    const shippingClass = readShippingClass(art);

    const shipping_options = buildShippingOptions({ shippingClass, currency });

    const successPath = process.env.STRIPE_SUCCESS_PATH || "/success";
    const cancelPath = process.env.STRIPE_CANCEL_PATH || "/";

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
                entry_id: String(art.id),
                entry_slug: String(art.slug || ""),
                shipping_class: String(shippingClass),
              },
            },
            unit_amount: Math.round(priceCents),
          },
          quantity: 1,
        },
      ],

      shipping_address_collection: { allowed_countries: ["US"] },
      shipping_options,

      metadata: {
        entry_id: String(art.id),
        entry_slug: String(art.slug || ""),
        shipping_class: String(shippingClass),
      },

      success_url: `${siteUrl}${successPath}?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${siteUrl}${cancelPath}`,
    });

    res.json({ url: session.url, id: session.id });
  } catch (e) {
    console.error("[STRIPE] create-checkout-session error", e);
    res.status(500).json({ error: e?.message || "Stripe checkout failed" });
  }
});

export default router;
