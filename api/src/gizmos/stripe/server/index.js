import router from "./router.js";

const stripePack = {
  slug: "stripe",
  // Declare which endpoints are public (skip auth token).
  // These are collected by gizmos-loader.js into app.locals.gizmoPublicPrefixes.
  auth: {
    publicPrefixes: [
      // Checkout
      "/api/gizmos/stripe/create-checkout-session",

      // Webhooks must be public (Stripe won't send Authorization headers)
      "/api/gizmos/stripe/webhook",

      // Convenience public namespace (if you add helper endpoints later)
      "/api/gizmos/stripe/public",

      // Helpful for deployment verification
      "/api/gizmos/stripe/health",
    ],
  },
  register(app) {
    // Public routes for checkout + webhook
    app.use("/api/gizmos/stripe", router);
  },
};

export default stripePack;
