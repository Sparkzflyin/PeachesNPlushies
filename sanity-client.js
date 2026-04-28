// Tiny browser-side Sanity helper. No SDK, no build step — just fetch.
// Exposes window.PNP_SANITY with isConfigured(), fetchPlushies(),
// fetchNextDrop(), and imageUrl().
//
// All data is read from the public Sanity CDN (no auth). Make sure your
// dataset is public: `npx sanity dataset visibility set production public`.
(function () {
  const cfg = window.PNP_CONFIG || {};
  const projectId = cfg.sanityProjectId || "";
  const dataset = cfg.sanityDataset || "production";
  const apiVersion = cfg.sanityApiVersion || "2024-01-01";

  const isConfigured = () => Boolean(projectId);

  async function query(groq, params) {
    if (!isConfigured()) return null;
    const url = new URL(
      `https://${projectId}.apicdn.sanity.io/v${apiVersion}/data/query/${dataset}`,
    );
    url.searchParams.set("query", groq);
    if (params) {
      for (const [k, v] of Object.entries(params)) {
        url.searchParams.set(`$${k}`, JSON.stringify(v));
      }
    }
    const res = await fetch(url.toString());
    if (!res.ok) {
      console.warn(`[sanity] query failed: ${res.status}`);
      return null;
    }
    const json = await res.json();
    return json.result;
  }

  // Build a CDN image URL from a Sanity image asset reference like
  //   "image-abc123def456-1080x1350-jpg"
  // Returns null if the ref looks malformed.
  function imageUrl(assetOrRef, opts = {}) {
    if (!assetOrRef || !isConfigured()) return null;
    const ref = typeof assetOrRef === "string"
      ? assetOrRef
      : assetOrRef?.asset?._ref || assetOrRef?._ref;
    if (!ref || !ref.startsWith("image-")) return null;

    const parts = ref.split("-");
    if (parts.length < 4) return null;
    const fmt = parts.pop();
    const dim = parts.pop();
    const hash = parts.slice(1).join("-");

    const url = new URL(
      `https://cdn.sanity.io/images/${projectId}/${dataset}/${hash}-${dim}.${fmt}`,
    );
    if (opts.w) url.searchParams.set("w", String(opts.w));
    if (opts.h) url.searchParams.set("h", String(opts.h));
    if (opts.fit) url.searchParams.set("fit", opts.fit);
    if (opts.auto !== false) url.searchParams.set("auto", "format");
    if (opts.q) url.searchParams.set("q", String(opts.q));
    return url.toString();
  }

  const PLUSHIE_QUERY = `*[_type == "plushie"] | order(_createdAt desc) {
    _id,
    name,
    "slug": slug.current,
    pronouns,
    "collectionName": collection->name,
    "collectionSlug": collection->slug.current,
    personality,
    snack,
    stitchedOn,
    weighted,
    weightGrams,
    price,
    status,
    snipcartId,
    "image": image.asset._ref
  }`;

  const NEXT_DROP_QUERY = `*[_type == "drop" && dropAt > now()] | order(dropAt asc)[0] {
    _id,
    name,
    dropAt,
    humanMeta,
    eyebrow,
    description
  }`;

  async function fetchPlushies() {
    return (await query(PLUSHIE_QUERY)) || [];
  }

  async function fetchNextDrop() {
    return (await query(NEXT_DROP_QUERY)) || null;
  }

  window.PNP_SANITY = {
    isConfigured,
    query,
    imageUrl,
    fetchPlushies,
    fetchNextDrop,
  };
})();
