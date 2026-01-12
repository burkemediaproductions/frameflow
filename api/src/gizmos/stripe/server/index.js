import router from "./router.js";

const stripePack = {
  slug: "stripe",
  auth: {
    // These should be PREFIXES and MUST start with "/"
    publicPrefixes: [
      // Create checkout session (public from the website)
      "/api/gizmos/stripe/create-checkout-session",

      // Any public helpers under /public/*
      "/api/gizmos/stripe/public",

      // Stripe webhooks MUST be public (Stripe won't send auth headers)
      "/api/gizmos/stripe/webhook",
    ],
  },

  register(app) {
    app.use("/api/gizmos/stripe", router);
  },
};

export default stripePack;
