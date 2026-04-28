// Sanity webhook handler.
// When a "drop" document is published, fires a Loops event so the matching
// event-triggered loop sends the drop announcement to subscribers.
//
// Required env vars:
//   SANITY_WEBHOOK_SECRET   — same value pasted into Sanity's webhook config
//   LOOPS_API_KEY
//   LOOPS_DROP_EVENT_NAME   — e.g. "drop_published"
// Optional:
//   SANITY_PROJECT_ID, SANITY_DATASET, SANITY_WRITE_TOKEN
//     — if all three are set, the handler stamps emailSentAt on the drop
//       so it never double-sends. Without these it just logs and continues.

import { createHmac, timingSafeEqual } from "node:crypto";

const LOOPS_EVENT_URL = "https://app.loops.so/api/v1/events/send";

const CONTENT_TYPE_HEADER = "Content-Type";
const JSON_CONTENT_TYPE = "application/json";

const HTTP_OK = 200;
const HTTP_BAD_REQUEST = 400;
const HTTP_UNAUTHORIZED = 401;
const HTTP_METHOD_NOT_ALLOWED = 405;
const HTTP_INTERNAL_ERROR = 500;
const HTTP_BAD_GATEWAY = 502;

const ERROR_DETAIL_MAX_LENGTH = 200;
const DEFAULT_DROP_EVENT = "drop_published";
const DEFAULT_SANITY_DATASET = "production";
const DEFAULT_SANITY_API_VERSION = "2024-01-01";

export const config = {
  api: {
    // Disable Vercel's default body parsing so we can verify the raw body
    bodyParser: false,
  },
};

async function readRawBody(req) {
  const chunks = [];
  for await (const chunk of req) {
    chunks.push(typeof chunk === "string" ? Buffer.from(chunk) : chunk);
  }
  return Buffer.concat(chunks).toString("utf8");
}

function verifySignature(secret, signatureHeader, rawBody) {
  if (!signatureHeader || !secret) return false;
  // Sanity sends "t=<timestamp>,v1=<sig>"
  const parts = Object.fromEntries(
    signatureHeader.split(",").map((kv) => kv.split("=").map((s) => s.trim())),
  );
  const ts = parts.t;
  const sigHex = parts.v1;
  if (!ts || !sigHex) return false;

  const expected = createHmac("sha256", secret).update(`${ts}.${rawBody}`).digest("hex");

  try {
    return timingSafeEqual(Buffer.from(sigHex, "hex"), Buffer.from(expected, "hex"));
  } catch (compareErr) {
    // Buffers of mismatched length throw — treat as invalid signature.
    console.warn("[sanity-webhook] signature comparison failed:", compareErr.message);
    return false;
  }
}

async function readErrorDetail(response) {
  try {
    const text = await response.text();
    return text.slice(0, ERROR_DETAIL_MAX_LENGTH);
  } catch (readErr) {
    console.warn("[sanity-webhook] could not read upstream error body:", readErr.message);
    return "";
  }
}

function jsonAuthHeaders(token) {
  return {
    [CONTENT_TYPE_HEADER]: JSON_CONTENT_TYPE,
    Authorization: `Bearer ${token}`,
  };
}

async function fireLoopsEvent(loopsKey, eventPayload) {
  const loopsRes = await fetch(LOOPS_EVENT_URL, {
    method: "POST",
    headers: jsonAuthHeaders(loopsKey),
    body: JSON.stringify(eventPayload),
  });
  if (!loopsRes.ok) {
    const detail = await readErrorDetail(loopsRes);
    return { ok: false, detail };
  }
  return { ok: true };
}

async function stampEmailSentAt(payload) {
  const projectId = process.env.SANITY_PROJECT_ID;
  const dataset = process.env.SANITY_DATASET || DEFAULT_SANITY_DATASET;
  const writeToken = process.env.SANITY_WRITE_TOKEN;
  const apiVersion = process.env.SANITY_API_VERSION || DEFAULT_SANITY_API_VERSION;

  if (!projectId || !writeToken || !payload?._id) return;

  try {
    const mutateUrl = `https://${projectId}.api.sanity.io/v${apiVersion}/data/mutate/${dataset}`;
    await fetch(mutateUrl, {
      method: "POST",
      headers: jsonAuthHeaders(writeToken),
      body: JSON.stringify({
        mutations: [
          {
            patch: {
              id: payload._id,
              set: { emailSentAt: new Date().toISOString() },
            },
          },
        ],
      }),
    });
  } catch (writeErr) {
    // Non-fatal — Loops event was already sent. Worst case is a manual
    // unflag in Sanity if you ever re-publish the same drop.
    console.warn("[sanity-webhook] failed to stamp emailSentAt:", writeErr.message);
  }
}

function ignored(reason) {
  return { status: HTTP_OK, body: { ok: true, ignored: reason } };
}

function classifyDrop(payload) {
  if (payload._type !== "drop") return ignored("not_a_drop");
  if (payload.sendEmailOnPublish === false) return ignored("opt_out");
  if (payload.emailSentAt) return ignored("already_sent");
  return null;
}

export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(HTTP_METHOD_NOT_ALLOWED).json({ error: "method_not_allowed" });
  }

  const secret = process.env.SANITY_WEBHOOK_SECRET;
  const loopsKey = process.env.LOOPS_API_KEY;
  const eventName = process.env.LOOPS_DROP_EVENT_NAME || DEFAULT_DROP_EVENT;

  if (!secret || !loopsKey) {
    return res.status(HTTP_INTERNAL_ERROR).json({ error: "missing_env" });
  }

  let rawBody = "";
  try {
    rawBody = await readRawBody(req);
  } catch (readErr) {
    console.warn("[sanity-webhook] failed to read body:", readErr.message);
    return res.status(HTTP_BAD_REQUEST).json({ error: "could_not_read_body" });
  }

  if (!verifySignature(secret, req.headers["sanity-webhook-signature"], rawBody)) {
    return res.status(HTTP_UNAUTHORIZED).json({ error: "invalid_signature" });
  }

  let payload;
  try {
    payload = JSON.parse(rawBody);
  } catch (jsonErr) {
    console.warn("[sanity-webhook] invalid JSON body:", jsonErr.message);
    return res.status(HTTP_BAD_REQUEST).json({ error: "invalid_json" });
  }

  const skip = classifyDrop(payload);
  if (skip) return res.status(skip.status).json(skip.body);

  const eventPayload = {
    eventName,
    contactProperties: {},
    eventProperties: {
      dropName: payload.name || "New drop",
      dropDescription: payload.description || "",
      dropAt: payload.dropAt || null,
      dropId: payload._id,
    },
  };

  let loopsResult;
  try {
    loopsResult = await fireLoopsEvent(loopsKey, eventPayload);
  } catch (err) {
    return res.status(HTTP_BAD_GATEWAY).json({
      error: "loops_unreachable",
      detail: String(err).slice(0, ERROR_DETAIL_MAX_LENGTH),
    });
  }
  if (!loopsResult.ok) {
    return res
      .status(HTTP_BAD_GATEWAY)
      .json({ error: "loops_event_failed", detail: loopsResult.detail });
  }

  await stampEmailSentAt(payload);

  return res.status(HTTP_OK).json({ ok: true, sent: true });
}
