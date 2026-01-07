import express from "express";
import Stripe from "stripe";

/**
 * Stripe Gizmo Pack (public)
 *
 * Endpoints:
 *  POST /api/gizmos/stripe/public/checkout   -> returns { url }
 *  POST /api/gizmos/stripe/public/webhook   -> Stripe webhook (raw body)
 *
 * ENV required:
 *  STRIPE_SECRET_KEY
 *  STRIPE_WEBHOOK_SECRET
 *  CHECKOUT_SUCCESS_URL   (must include {CHECKOUT_SESSION_ID})
 *  CHECKOUT_CANCEL_URL
 *
 * Optional ENV:
 *  STRIPE_DEFAULT_CURRENCY=USD
 *  STRIPE_CONTENT_TYPE_SLUG=art
 */
export default {
  register(app) {
    const router = express.Router();

    const STRIPE_SECRET_KEY = process.env.STRIPE_SECRET_KEY;
    if (!STRIPE_SECRET_KEY) {
      console.warn("[GIZMO][stripe] Missing STRIPE_SECRET_KEY. Checkout will fail until set.");
    }

    const stripe = new Stripe(STRIPE_SECRET_KEY || "sk_test_missing", {
      apiVersion: "2024-06-20",
    });

    const DEFAULT_CURRENCY = (process.env.STRIPE_DEFAULT_CURRENCY || "USD").toUpperCase();
    const DEFAULT_TYPE_SLUG = process.env.STRIPE_CONTENT_TYPE_SLUG || "art";

    const successUrl = process.env.CHECKOUT_SUCCESS_URL || "";
    const cancelUrl = process.env.CHECKOUT_CANCEL_URL || "";

    function asCheckoutItem(entryRow) {
      // entries row shape from your API: { title, slug, status, data: {...} }
      const data = entryRow?.data && typeof entryRow.data === "object" ? entryRow.data : {};
      return {
        title: entryRow?.title || data.title || "Artwork",
        slug: entryRow?.slug || data.slug || "",
        status: entryRow?.status || data.status || "",
        ...data,
      };
    }

    function isPublished(item) {
      return String(item?.status || "").toLowerCase() === "published";
    }

    function isSold(item) {
      return String(item?.status || "").toLowerCase() === "sold";
    }

    function getPriceCents(item) {
      const cents = item?.price_cents;
      if (typeof cents === "number" && Number.isFinite(cents) && cents > 0) return cents;

      // fallback: parse "3,333.00" type string
      const raw = String(item?.price || "").trim();
      if (!raw) return null;
      const numeric = Number(raw.replace(/[^0-9.]/g, ""));
      if (!Number.isFinite(numeric) || numeric <= 0) return null;
      return Math.round(numeric * 100);
    }

    async function fetchEntryBySlug({ pool, contentTypeSlug, entrySlug }) {
      // Resolve content_type_id by slug
      const { rows: typeRows } = await pool.query(
        "SELECT id FROM content_types WHERE slug = $1 LIMIT 1",
        [contentTypeSlug]
      );
      if (!typeRows.length) return null;

      const typeId = typeRows[0].id;

      // Find entry by slug
      const { rows: entryRows } = await pool.query(
        "SELECT * FROM entries WHERE content_type_id = $1 AND slug = $2 LIMIT 1",
        [typeId, entrySlug]
      );
      if (!entryRows.length) return null;

      return entryRows[0];
    }

    async function updateEntryStatusBySlug({ pool, contentTypeSlug, entrySlug, status, stripeSessionId }) {
      const { rows: typeRows } = await pool.query(
        "SELECT id FROM content_types WHERE slug = $1 LIMIT 1",
        [contentTypeSlug]
      );
      if (!typeRows.length) return false;

      const typeId = typeRows[0].id;

      // Store stripe session id into data->stripe_metadata_id if that field exists for you.
      // We keep it non-destructive by merging JSON.
      await pool.query(
        `
        UPDATE entries
           SET status = $1,
               data = COALESCE(data, '{}'::jsonb) || jsonb_build_object('stripe_metadata_id', $2),
               updated_at = now()
         WHERE content_type_id = $3
           AND slug = $4
        `,
        [status, stripeSessionId || null, typeId, entrySlug]
      );

      return true;
    }

    // ---------------------------
    // POST /public/checkout
    // ---------------------------
    router.post("/checkout", express.json(), async (req, res) => {
      try {
        const pool = app.locals.pool;
        if (!pool) return res.status(500).json({ error: "Server misconfigured: app.locals.pool missing" });

        const body = req.body || {};
        const contentTypeSlug = body.contentTypeSlug || DEFAULT_TYPE_SLUG;
        const entrySlug = body.slug;

        if (!entrySlug) return res.status(400).json({ error: "Missing slug" });
        if (!successUrl || !cancelUrl) {
          return res.status(500).json({ error: "Missing CHECKOUT_SUCCESS_URL or CHECKOUT_CANCEL_URL" });
        }

        const row = await fetchEntryBySlug({ pool, contentTypeSlug, entrySlug });
        if (!row) return res.status(404).json({ error: "Item not found" });

        const item = asCheckoutItem(row);

        if (!isPublished(item) || isSold(item)) {
          return res.status(400).json({ error: "Item is not available for purchase" });
        }

        const currency = String(item.currency || DEFAULT_CURRENCY).toLowerCase();
        const priceCents = getPriceCents(item);

        if (!priceCents) return res.status(400).json({ error: "Missing price_cents" });

        const imageUrl =
          item?.primary_image?.publicUrl ||
          item?.primary_image?.public_url ||
          item?.primary_image?.url ||
          undefined;

        const session = await stripe.checkout.sessions.create({
          mode: "payment",
          success_url: successUrl,
          cancel_url: cancelUrl,
          line_items: [
            {
              quantity: 1,
              price_data: {
                currency,
                unit_amount: priceCents,
                product_data: {
                  name: item.title || "Artwork",
                  images: imageUrl ? [imageUrl] : undefined,
                  metadata: {
                    content_type: contentTypeSlug,
                    slug: item.slug || entrySlug,
                    sku: item.sku || "",
                  },
                },
              },
            },
          ],
          metadata: {
            content_type: contentTypeSlug,
            slug: item.slug || entrySlug,
            sku: item.sku || "",
          },
        });

        return res.json({ url: session.url });
      } catch (err) {
        console.error("[GIZMO][stripe] checkout error:", err);
        return res.status(500).json({ error: "Failed to create checkout session" });
      }
    });

    // ---------------------------
    // POST /public/webhook  (RAW BODY REQUIRED)
    // ---------------------------
    router.post(
      "/webhook",
      // IMPORTANT: raw body for signature verification
      express.raw({ type: "application/json" }),
      async (req, res) => {
        const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;
        if (!webhookSecret) {
          console.warn("[GIZMO][stripe] Missing STRIPE_WEBHOOK_SECRET");
          return res.status(500).send("Missing STRIPE_WEBHOOK_SECRET");
        }

        let event;
        try {
          const sig = req.headers["stripe-signature"];
          event = stripe.webhooks.constructEvent(req.body, sig, webhookSecret);
        } catch (err) {
          console.error("[GIZMO][stripe] webhook signature failed:", err?.message || err);
          return res.status(400).send(`Webhook Error: ${err?.message || "bad signature"}`);
        }

        try {
          if (event.type === "checkout.session.completed") {
            const session = event.data.object;

            const pool = app.locals.pool;
            if (!pool) throw new Error("app.locals.pool missing");

            const contentTypeSlug = session.metadata?.content_type || DEFAULT_TYPE_SLUG;
            const entrySlug = session.metadata?.slug;

            if (entrySlug) {
              await updateEntryStatusBySlug({
                pool,
                contentTypeSlug,
                entrySlug,
                status: "sold",
                stripeSessionId: session.id,
              });
            }
          }

          return res.json({ received: true });
        } catch (err) {
          console.error("[GIZMO][stripe] webhook handler failed:", err);
          return res.status(500).send("Webhook handler failed");
        }
      }
    );

    // Mount as PUBLIC gizmo endpoints (matches your auth bypass rule)
    app.use("/api/gizmos/stripe/public", router);

    console.log("[GIZMOS] Stripe pack mounted at /api/gizmos/stripe/public/*");
  },
};
