// Newsletter signup endpoint.
// Receives { email } from the homepage form, adds the contact to a Loops
// mailing list. Loops handles double opt-in / unsubscribe / GDPR.
//
// Required env vars:
//   LOOPS_API_KEY            — from Loops settings
//   LOOPS_MAILING_LIST_ID    — the list newsletter subscribers go on
// Optional:
//   LOOPS_SOURCE             — string label written to contact metadata

// Bounded segments prevent the catastrophic backtracking sonar warns about
// (sonarjs/slow-regex). Real email validation is delegated to Loops/Stripe.
const EMAIL_RE = /^[^\s@]{1,254}@[^\s@]{1,253}\.[^\s@]{1,253}$/;

const LOOPS_BASE = "https://app.loops.so/api/v1";
const LOOPS_CREATE_URL = `${LOOPS_BASE}/contacts/create`;
const LOOPS_UPDATE_URL = `${LOOPS_BASE}/contacts/update`;

const CONTENT_TYPE_HEADER = "Content-Type";
const JSON_CONTENT_TYPE = "application/json";

const HTTP_OK = 200;
const HTTP_BAD_REQUEST = 400;
const HTTP_METHOD_NOT_ALLOWED = 405;
const HTTP_CONFLICT = 409;
const HTTP_INTERNAL_ERROR = 500;
const HTTP_BAD_GATEWAY = 502;

const ERROR_DETAIL_MAX_LENGTH = 200;

function jsonHeaders(apiKey) {
  return {
    [CONTENT_TYPE_HEADER]: JSON_CONTENT_TYPE,
    Authorization: `Bearer ${apiKey}`,
  };
}

function parseRequestBody(rawBody) {
  if (typeof rawBody === "string") {
    try {
      return JSON.parse(rawBody);
    } catch (jsonErr) {
      // Body wasn't JSON — try urlencoded form data instead.
      console.warn("[subscribe] JSON parse failed, falling back to urlencoded:", jsonErr.message);
      return Object.fromEntries(new URLSearchParams(rawBody));
    }
  }
  if (rawBody && typeof rawBody === "object" && Buffer.isBuffer(rawBody)) {
    return JSON.parse(rawBody.toString("utf8"));
  }
  return rawBody;
}

async function readErrorDetail(response) {
  try {
    const text = await response.text();
    return text.slice(0, ERROR_DETAIL_MAX_LENGTH);
  } catch (readErr) {
    console.warn("[subscribe] could not read upstream error body:", readErr.message);
    return "";
  }
}

export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(HTTP_METHOD_NOT_ALLOWED).json({ error: "method_not_allowed" });
  }

  const apiKey = process.env.LOOPS_API_KEY;
  const mailingListId = process.env.LOOPS_MAILING_LIST_ID;
  const source = process.env.LOOPS_SOURCE || "pnp_newsletter_homepage";

  if (!apiKey) {
    return res.status(HTTP_INTERNAL_ERROR).json({ error: "missing_loops_api_key" });
  }

  let body;
  try {
    body = parseRequestBody(req.body);
  } catch (parseErr) {
    console.warn("[subscribe] body parse failed:", parseErr.message);
    return res.status(HTTP_BAD_REQUEST).json({ error: "invalid_body" });
  }

  const email = (body?.email || "").toString().trim().toLowerCase();
  if (!EMAIL_RE.test(email)) {
    return res.status(HTTP_BAD_REQUEST).json({ error: "invalid_email" });
  }

  const payload = { email, source, subscribed: true };
  if (mailingListId) {
    payload.mailingLists = { [mailingListId]: true };
  }

  try {
    const upstream = await fetch(LOOPS_CREATE_URL, {
      method: "POST",
      headers: jsonHeaders(apiKey),
      body: JSON.stringify(payload),
    });

    if (upstream.status === HTTP_CONFLICT) {
      // Already subscribed — update so they get added to the mailing list if they weren't
      const update = await fetch(LOOPS_UPDATE_URL, {
        method: "PUT",
        headers: jsonHeaders(apiKey),
        body: JSON.stringify(payload),
      });
      if (!update.ok) {
        const detail = await readErrorDetail(update);
        return res.status(HTTP_BAD_GATEWAY).json({ error: "loops_update_failed", detail });
      }
      return res.status(HTTP_OK).json({ ok: true, status: "updated" });
    }

    if (!upstream.ok) {
      const detail = await readErrorDetail(upstream);
      return res.status(HTTP_BAD_GATEWAY).json({ error: "loops_create_failed", detail });
    }

    return res.status(HTTP_OK).json({ ok: true, status: "created" });
  } catch (err) {
    return res
      .status(HTTP_BAD_GATEWAY)
      .json({ error: "loops_unreachable", detail: String(err).slice(0, ERROR_DETAIL_MAX_LENGTH) });
  }
}
