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

  const expected = createHmac("sha256", secret)
    .update(`${ts}.${rawBody}`)
    .digest("hex");

  try {
    return timingSafeEqual(Buffer.from(sigHex, "hex"), Buffer.from(expected, "hex"));
  } catch {
    return false;
  }
}

export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ error: "method_not_allowed" });
  }

  const secret = process.env.SANITY_WEBHOOK_SECRET;
  const loopsKey = process.env.LOOPS_API_KEY;
  const eventName = process.env.LOOPS_DROP_EVENT_NAME || "drop_published";

  if (!secret || !loopsKey) {
    return res.status(500).json({ error: "missing_env" });
  }

  let rawBody = "";
  try {
    rawBody = await readRawBody(req);
  } catch {
    return res.status(400).json({ error: "could_not_read_body" });
  }

  const sigHeader = req.headers["sanity-webhook-signature"];
  if (!verifySignature(secret, sigHeader, rawBody)) {
    return res.status(401).json({ error: "invalid_signature" });
  }

  let payload;
  try {
    payload = JSON.parse(rawBody);
  } catch {
    return res.status(400).json({ error: "invalid_json" });
  }

  // Only handle "drop" docs that opted in and haven't been emailed yet
  if (payload._type !== "drop") {
    return res.status(200).json({ ok: true, ignored: "not_a_drop" });
  }
  if (payload.sendEmailOnPublish === false) {
    return res.status(200).json({ ok: true, ignored: "opt_out" });
  }
  if (payload.emailSentAt) {
    return res.status(200).json({ ok: true, ignored: "already_sent" });
  }

  // Fire the Loops event — Loops then sends whatever email is wired to this event
  const eventPayload = {
    eventName,
    // Loops requires either email OR userId at the contact level. We trigger
    // a "broadcast"-style event by including eventProperties Loops will pass
    // into the email template.
    contactProperties: {
      // use a synthetic system contact so the event isn't tied to one user;
      // your audience targeting in Loops decides who gets the email.
    },
    eventProperties: {
      dropName: payload.name || "New drop",
      dropDescription: payload.description || "",
      dropAt: payload.dropAt || null,
      dropId: payload._id,
    },
  };

  try {
    const loopsRes = await fetch("https://app.loops.so/api/v1/events/send", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${loopsKey}`,
      },
      body: JSON.stringify(eventPayload),
    });
    if (!loopsRes.ok) {
      const text = await loopsRes.text().catch(() => "");
      return res
        .status(502)
        .json({ error: "loops_event_failed", detail: text.slice(0, 200) });
    }
  } catch (err) {
    return res
      .status(502)
      .json({ error: "loops_unreachable", detail: String(err).slice(0, 200) });
  }

  // Best-effort: stamp emailSentAt on the drop so we don't double-send if
  // someone re-publishes. Skipped silently if the write token isn't set.
  const projectId = process.env.SANITY_PROJECT_ID;
  const dataset = process.env.SANITY_DATASET || "production";
  const writeToken = process.env.SANITY_WRITE_TOKEN;
  const apiVersion = process.env.SANITY_API_VERSION || "2024-01-01";

  if (projectId && writeToken && payload._id) {
    try {
      const mutateUrl = `https://${projectId}.api.sanity.io/v${apiVersion}/data/mutate/${dataset}`;
      await fetch(mutateUrl, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${writeToken}`,
        },
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
    } catch {
      // Non-fatal — Loops event was already sent. Worst case is a manual
      // unflag in Sanity if you ever re-publish the same drop.
    }
  }

  return res.status(200).json({ ok: true, sent: true });
}
