import router from "./router.js";

const stripePack = {
  slug: "stripe",
  auth: {
    publicPrefixes: [
      "/api/gizmos/stripe/checkout", // create checkout session
      "/api/gizmos/stripe/webhook",  // Stripe webhooks MUST be public
      "/api/gizmos/stripe/public",   // if you expose any public helpers
    ],
  },

  register(app) {
    // Mount everything for this gizmo under:
    app.use("/api/gizmos/stripe", router);
  },
};

export default stripePack;
