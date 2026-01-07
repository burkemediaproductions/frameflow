export function getFitDegreeConfig() {
  return {
    baseUrl: process.env.FITDEGREE_API_BASE || "https://api.fitdegree.com",
    apiKey: process.env.FITDEGREE_API_KEY || "",
    fitspotId: process.env.FITDEGREE_FITSPOT_ID || "",
    authHeader: process.env.FITDEGREE_AUTH_HEADER || "Authorization",
    authScheme: process.env.FITDEGREE_AUTH_SCHEME ?? "Bearer",
  };
}
