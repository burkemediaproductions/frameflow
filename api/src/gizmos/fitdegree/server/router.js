// api/src/gizmos/fitdegree/server/router.js
import express from "express";
import { fitdegreeFetchJson } from "./client.js";
import { FITDEGREE_ENDPOINTS } from "./endpoints.js";

const router = express.Router();

function resolveEndpoint(value, fallback) {
  if (typeof value === "function") return value();
  if (typeof value === "string" && value.trim()) return value.trim();
  return fallback;
}

function pickCompanyId(req) {
  // Prefer explicit query param for testing
  if (req.query.company_id) return String(req.query.company_id).trim();

  // Prefer a dedicated env var if you add it
  if (process.env.FITDEGREE_COMPANY_ID)
    return String(process.env.FITDEGREE_COMPANY_ID).trim();

  // Back-compat fallback (might not match FitDegree "company_id")
  if (process.env.FITDEGREE_FITSPOT_ID)
    return String(process.env.FITDEGREE_FITSPOT_ID).trim();

  return "";
}

router.get("/public/__ping", (_req, res) => {
  res.json({ ok: true, pack: "fitdegree", scope: "public" });
});

router.get("/__ping", (_req, res) => {
  res.json({ ok: true, pack: "fitdegree" });
});

// PUBLIC: instructors (employees / team members)
router.get("/public/instructors", async (req, res) => {
  try {
    const endpoint = resolveEndpoint(
      FITDEGREE_ENDPOINTS.instructors,
      FITDEGREE_ENDPOINTS.EMPLOYEES
    );

    const companyId = pickCompanyId(req);
    if (!companyId) {
      return res.status(400).json({
        ok: false,
        error:
          "Missing company_id. Provide ?company_id=### or set FITDEGREE_COMPANY_ID in Render env.",
      });
    }

    const data = await fitdegreeFetchJson(endpoint, {
      query: {
        company_id: companyId,
        page: req.query.page || 1,
        limit: req.query.limit || 50,
      },
    });

    res.json({ ok: true, data });
  } catch (err) {
    res.status(err.status || 500).json({
      ok: false,
      error: err.message || "Failed to fetch instructors",
      details: err.details || null,
    });
  }
});

// PUBLIC: upcoming classes (placeholder until we confirm FitDegree classes endpoint)
router.get("/public/classes", async (req, res) => {
  try {
    const endpoint = resolveEndpoint(
      FITDEGREE_ENDPOINTS.classes,
      FITDEGREE_ENDPOINTS.UPCOMING_CLASSES
    );

    const companyId = pickCompanyId(req);

    const data = await fitdegreeFetchJson(endpoint, {
      query: {
        ...(companyId ? { company_id: companyId } : {}),
        page: req.query.page || 1,
        limit: req.query.limit || 50,
      },
    });

    res.json({ ok: true, data });
  } catch (err) {
    res.status(err.status || 500).json({
      ok: false,
      error: err.message || "Failed to fetch classes",
      details: err.details || null,
    });
  }
});

export default router;
