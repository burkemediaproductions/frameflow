import { getFitDegreeConfig } from "./config.js";

function buildAuthValue(apiKey, scheme) {
  if (!apiKey) return "";
  if (scheme === "" || scheme === null || scheme === undefined) return apiKey;
  return `${scheme} ${apiKey}`;
}

export async function fitdegreeFetchJson(path, { query = {}, method = "GET" } = {}) {
  const cfg = getFitDegreeConfig();
  const url = new URL(cfg.baseUrl.replace(/\/$/, "") + path);

  Object.entries(query || {}).forEach(([k, v]) => {
    if (v === undefined || v === null || v === "") return;
    url.searchParams.set(k, String(v));
  });

  const headers = { Accept: "application/json" };
  const authValue = buildAuthValue(cfg.apiKey, cfg.authScheme);
  if (authValue) headers[cfg.authHeader] = authValue;

  const res = await fetch(url.toString(), { method, headers });
  const text = await res.text();

  let data;
  try { data = text ? JSON.parse(text) : null; }
  catch { data = { raw: text }; }

  if (!res.ok) {
    const msg = data?.message || data?.error || `fitDEGREE API error (${res.status})`;
    const err = new Error(msg);
    err.status = res.status;
    err.details = data;
    throw err;
  }
  return data;
}
