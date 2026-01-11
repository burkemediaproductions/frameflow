import express from "express";
import Stripe from "stripe";
import { getArtByIdOrSlug } from "./storage.js";
import { buildShippingOptions } from "./shipping.js";

const router = express.Router();

// Stripe needs raw body for webhooks, but JSON for normal routes.
// Webhook route must be defined BEFORE express.json() middleware.
router.post(
  "/webhook",
  express.raw({ type: "application/json" }),
  async (req, res) => {
    const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;
    if (!webhookSecret) {
      return res.status(400).json({ error: "Missing STRIPE_WEBHOOK_SECRET" });
    }

    const stripe = new Stripe(process.env.STRIPE_SECRET_KEY, {
      apiVersion: "2024-06-20",
    });

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

        // Later (optional):
        // - mark item sold in your DB/content status
        // - store order record, shipping details, buyer email, etc.
      }

      res.json({ received: true });
    } catch (e) {
      console.error("[STRIPE] webhook handler error", e);
      res.status(500).json({ error: "Webhook handler failed" });
    }
  }
);

// Normal JSON routes AFTER webhook
router.use(express.json());

// POST /api/gizmos/stripe/create-checkout-session
// Body: { id?: string, slug?: string }
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

    // Pull art from your ServiceUp content endpoint
    const art = await getArtByIdOrSlug({ id, slug });
    if (!art) return res.status(404).json({ error: "Art not found" });

    // Ensure published (launch-safe)
    const status = (art.status || art._status || "").toLowerCase();
    if (status && status !== "published") {
      return res.status(400).json({ error: "Art is not published" });
    }

    // Price sanity: cents integer e.g. 333300 for $3,333.00
    const priceCents = Number(art.price_cents);
    if (!Number.isFinite(priceCents) || priceCents <= 0) {
      return res.status(400).json({
        error:
          "Invalid price_cents. Must be integer cents like 333300 for $3,333.00.",
      });
    }

    const currency = (art.currency || "USD").toLowerCase();
    const title = art.title || art._title || "Artwork";

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
      process.env.STRIPE_CANCEL_PATH ||
      `/art/${encodeURIComponent(art.slug || art._slug || "")}`;

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
                art_slug: String(art.slug || art._slug || ""),
                sku: String(art.sku || ""),
              },
            },
            unit_amount: priceCents,
          },
          quantity: 1,
        },
      ],

      // Collect shipping address (US only)
      shipping_address_collection: {
        allowed_countries: ["US"],
      },

      // Shipping options (includes CA discount option + US option)
      shipping_options,

      // Optional later (requires Stripe Tax setup):
      // automatic_tax: { enabled: true },

      metadata: {
        art_id: String(art.id || ""),
        art_slug: String(art.slug || art._slug || ""),
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
