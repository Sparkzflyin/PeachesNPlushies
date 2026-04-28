// Newsletter signup endpoint.
// Receives { email } from the homepage form, adds the contact to a Loops
// mailing list. Loops handles double opt-in / unsubscribe / GDPR.
//
// Required env vars:
//   LOOPS_API_KEY            — from Loops settings
//   LOOPS_MAILING_LIST_ID    — the list newsletter subscribers go on
// Optional:
//   LOOPS_SOURCE             — string label written to contact metadata

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ error: "method_not_allowed" });
  }

  const apiKey = process.env.LOOPS_API_KEY;
  const mailingListId = process.env.LOOPS_MAILING_LIST_ID;
  const source = process.env.LOOPS_SOURCE || "pnp_newsletter_homepage";

  if (!apiKey) {
    return res.status(500).json({ error: "missing_loops_api_key" });
  }

  // Body parsing — Vercel may give us a Buffer/string depending on content-type
  let body = req.body;
  if (typeof body === "string") {
    try {
      body = JSON.parse(body);
    } catch {
      // try urlencoded
      body = Object.fromEntries(new URLSearchParams(body));
    }
  } else if (body && typeof body === "object" && Buffer.isBuffer(body)) {
    try {
      body = JSON.parse(body.toString("utf8"));
    } catch {
      return res.status(400).json({ error: "invalid_body" });
    }
  }

  const email = (body?.email || "").toString().trim().toLowerCase();
  if (!EMAIL_RE.test(email)) {
    return res.status(400).json({ error: "invalid_email" });
  }

  // Create or update the contact in Loops
  const payload = {
    email,
    source,
    subscribed: true,
  };
  if (mailingListId) {
    payload.mailingLists = { [mailingListId]: true };
  }

  try {
    const upstream = await fetch("https://app.loops.so/api/v1/contacts/create", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify(payload),
    });

    if (upstream.status === 409) {
      // Already subscribed — update instead so they go on the list if they weren't
      const update = await fetch("https://app.loops.so/api/v1/contacts/update", {
        method: "PUT",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify(payload),
      });
      if (!update.ok) {
        const text = await update.text().catch(() => "");
        return res.status(502).json({ error: "loops_update_failed", detail: text.slice(0, 200) });
      }
      return res.status(200).json({ ok: true, status: "updated" });
    }

    if (!upstream.ok) {
      const text = await upstream.text().catch(() => "");
      return res.status(502).json({ error: "loops_create_failed", detail: text.slice(0, 200) });
    }

    return res.status(200).json({ ok: true, status: "created" });
  } catch (err) {
    return res.status(502).json({ error: "loops_unreachable", detail: String(err).slice(0, 200) });
  }
}
