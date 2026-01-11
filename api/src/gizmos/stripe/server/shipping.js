function cents(n) {
  return Math.round(Number(n));
}

// Launch pricing matrix (cents)
const RATES = {
  Small: { CA: 2500, US: 4500 },        // $25 CA / $45 US
  Oversize: { CA: 6500, US: 9500 },     // $65 CA / $95 US
  WhiteGlove: { CA: 12500, US: 17500 }, // $125 CA / $175 US
  Freight: { CA: 12500, US: 17500 },    // alias for Freight
};

function normalizeClass(input) {
  const s = String(input || "").trim().toLowerCase();
  if (!s) return "Small";
  if (s.includes("white")) return "WhiteGlove";
  if (s.includes("freight")) return "Freight";
  if (s.includes("over")) return "Oversize";
  return "Small";
}

/**
 * NOTE:
 * Stripe Checkout does not support state-based conditional shipping
 * inside checkout without collecting the address first.
 *
 * For launch, we present both:
 *  - California (discounted)
 *  - US (standard)
 *
 * Later upgrade (optional): ask state/zip on your site BEFORE session creation,
 * then only include the matching option.
 */
export function buildShippingOptions({ shippingClass, currency = "usd" }) {
  const klass = normalizeClass(shippingClass);
  const rate = RATES[klass] || RATES.Small;

  const cur = String(currency || "usd").toLowerCase();

  const caAmount = cents(rate.CA);
  const usAmount = cents(rate.US);

  const labelBase =
    klass === "Small"
      ? "Standard Shipping"
      : klass === "Oversize"
      ? "Oversize Shipping"
      : "White Glove Shipping";

  return [
    {
      shipping_rate_data: {
        display_name: `${labelBase} (California)`,
        type: "fixed_amount",
        fixed_amount: { amount: caAmount, currency: cur },
        delivery_estimate: {
          minimum: { unit: "business_day", value: 2 },
          maximum: { unit: "business_day", value: 6 },
        },
        metadata: {
          region_hint: "CA_ONLY",
          shipping_class: klass,
        },
      },
    },
    {
      shipping_rate_data: {
        display_name: `${labelBase} (US)`,
        type: "fixed_amount",
        fixed_amount: { amount: usAmount, currency: cur },
        delivery_estimate: {
          minimum: { unit: "business_day", value: 3 },
          maximum: { unit: "business_day", value: 8 },
        },
        metadata: {
          region_hint: "US",
          shipping_class: klass,
        },
      },
    },
  ];
}
