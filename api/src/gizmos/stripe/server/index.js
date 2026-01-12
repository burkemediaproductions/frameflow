import router from "./router.js";

const stripePack = {
  slug: "stripe",
  auth: {
    publicPrefixes: [
      "/api/gizmos/stripe/create-checkout-session",
      "/api/gizmos/stripe/webhook",
      "/api/gizmos/stripe/public",          // covers /public/*
      "/api/gizmos/stripe/public/session",  // if you use /public/session/:id
      "/api/gizmos/stripe/health",          // if you want this public
    ],
  },

  register(app) {
    app.use("/api/gizmos/stripe", router);
  },
};

export default stripePack;
