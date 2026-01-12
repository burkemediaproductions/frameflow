import router from "./router.js";

const stripePack = {
  slug: "stripe",
  auth: {
    publicPrefixes: [
      "/api/gizmos/stripe/public",  // everything public goes under /public/*
      "/api/gizmos/stripe/webhook", // Stripe webhooks must be public
    ],
  },

  register(app) {
    app.use("/api/gizmos/stripe", router);
  },
};

export default stripePack;
