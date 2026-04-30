// Contact form endpoint.
// Receives { name, email, subject, message, inquiry_type } from contact.html
// and forwards it to the workshop inbox via Loops transactional email. If
// LOOPS_CONTACT_CONFIRMATION_ID is set, also sends a confirmation back to the
// submitter.
//
// Required env vars:
//   LOOPS_API_KEY                    — from Loops settings
//   LOOPS_CONTACT_TRANSACTIONAL_ID   — transactional template that emails the workshop
//   CONTACT_RECIPIENT_EMAIL          — workshop inbox the form notifications go to
// Optional:
//   LOOPS_CONTACT_CONFIRMATION_ID    — transactional template for the auto-reply to the sender

const EMAIL_RE = /^[^\s@]{1,254}@[^\s@]{1,253}\.[^\s@]{1,253}$/;

const LOOPS_TRANSACTIONAL_URL = "https://app.loops.so/api/v1/transactional";

const CONTENT_TYPE_HEADER = "Content-Type";
const JSON_CONTENT_TYPE = "application/json";

const HTTP_OK = 200;
const HTTP_BAD_REQUEST = 400;
const HTTP_METHOD_NOT_ALLOWED = 405;
const HTTP_INTERNAL_ERROR = 500;
const HTTP_BAD_GATEWAY = 502;

const ERROR_DETAIL_MAX_LENGTH = 200;
const NAME_MAX = 100;
const SUBJECT_MAX = 200;
const MESSAGE_MAX = 1000;

const ALLOWED_INQUIRY_TYPES = new Set(["commission", "general", "wholesale", "press"]);

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
      console.warn("[contact] JSON parse failed, falling back to urlencoded:", jsonErr.message);
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
    console.warn("[contact] could not read upstream error body:", readErr.message);
    return "";
  }
}

function clampStr(value, max) {
  return String(value ?? "").trim().slice(0, max);
}

function validate(body) {
  const name = clampStr(body?.name, NAME_MAX);
  const email = clampStr(body?.email, 254).toLowerCase();
  const subject = clampStr(body?.subject, SUBJECT_MAX);
  const message = clampStr(body?.message, MESSAGE_MAX);
  const inquiryRaw = clampStr(body?.inquiry_type || body?.inquiryType, 32).toLowerCase();
  const inquiryType = ALLOWED_INQUIRY_TYPES.has(inquiryRaw) ? inquiryRaw : "general";

  if (!name) return { error: "missing_name" };
  if (!EMAIL_RE.test(email)) return { error: "invalid_email" };
  if (!message) return { error: "missing_message" };

  return { value: { name, email, subject, message, inquiryType } };
}

async function sendLoopsTransactional({ apiKey, transactionalId, recipient, dataVariables }) {
  const upstream = await fetch(LOOPS_TRANSACTIONAL_URL, {
    method: "POST",
    headers: jsonHeaders(apiKey),
    body: JSON.stringify({
      transactionalId,
      email: recipient,
      dataVariables,
    }),
  });
  if (!upstream.ok) {
    const detail = await readErrorDetail(upstream);
    return { ok: false, status: upstream.status, detail };
  }
  return { ok: true };
}

export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(HTTP_METHOD_NOT_ALLOWED).json({ error: "method_not_allowed" });
  }

  const apiKey = process.env.LOOPS_API_KEY;
  const transactionalId = process.env.LOOPS_CONTACT_TRANSACTIONAL_ID;
  const recipient = process.env.CONTACT_RECIPIENT_EMAIL;
  const confirmationId = process.env.LOOPS_CONTACT_CONFIRMATION_ID;

  if (!apiKey) {
    return res.status(HTTP_INTERNAL_ERROR).json({ error: "missing_loops_api_key" });
  }
  if (!transactionalId) {
    return res.status(HTTP_INTERNAL_ERROR).json({ error: "missing_transactional_id" });
  }
  if (!recipient || !EMAIL_RE.test(recipient)) {
    return res.status(HTTP_INTERNAL_ERROR).json({ error: "missing_recipient_email" });
  }

  let body;
  try {
    body = parseRequestBody(req.body);
  } catch (parseErr) {
    console.warn("[contact] body parse failed:", parseErr.message);
    return res.status(HTTP_BAD_REQUEST).json({ error: "invalid_body" });
  }

  // Honeypot — bots tend to fill every visible-looking field. Real users never see it.
  if (clampStr(body?.website, 200)) {
    // Pretend we accepted it. No work done.
    return res.status(HTTP_OK).json({ ok: true, status: "queued" });
  }

  const { error: validationError, value } = validate(body);
  if (validationError) {
    return res.status(HTTP_BAD_REQUEST).json({ error: validationError });
  }

  const { name, email, subject, message, inquiryType } = value;

  const submittedAt = new Date().toISOString();
  const workshopVars = {
    name,
    fromEmail: email,
    subject: subject || `(no subject)`,
    message,
    inquiryType,
    submittedAt,
  };

  try {
    const main = await sendLoopsTransactional({
      apiKey,
      transactionalId,
      recipient,
      dataVariables: workshopVars,
    });
    if (!main.ok) {
      return res
        .status(HTTP_BAD_GATEWAY)
        .json({ error: "loops_send_failed", status: main.status, detail: main.detail });
    }

    // Auto-reply to the sender — best-effort. A failure here doesn't fail the request.
    if (confirmationId) {
      const confirmation = await sendLoopsTransactional({
        apiKey,
        transactionalId: confirmationId,
        recipient: email,
        dataVariables: { name, subject: subject || "your note", inquiryType },
      });
      if (!confirmation.ok) {
        console.warn(
          `[contact] confirmation send failed (status=${confirmation.status}):`,
          confirmation.detail
        );
      }
    }

    return res.status(HTTP_OK).json({ ok: true, status: "sent" });
  } catch (err) {
    return res
      .status(HTTP_BAD_GATEWAY)
      .json({ error: "loops_unreachable", detail: String(err).slice(0, ERROR_DETAIL_MAX_LENGTH) });
  }
}
