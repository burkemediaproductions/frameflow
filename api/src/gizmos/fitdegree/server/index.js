import router from "./router.js";

const fitdegreePack = {
  slug: "fitdegree",
  register(app) {
    // This mounts:
    //   /api/gizmos/fitdegree/public/*
    //   /api/gizmos/fitdegree/*   (protected by your authMiddleware unless you exempt)
    app.use("/api/gizmos/fitdegree", router);
  },
};

export default fitdegreePack;
