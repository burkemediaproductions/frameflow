import router from "./router.js";

const stripePack = {
  slug: "stripe",
  register(app) {
    // Public routes for checkout + webhook
    app.use("/api/gizmos/stripe", router);
  },
};

export default stripePack;
