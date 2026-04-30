# Sanity + Loops + Vercel Integration

End-to-end setup: deploy the static site to Vercel, wire it to a Sanity project for plushie/drop content, and connect Loops for the newsletter + automated drop emails.

The site works **fully without** any of this — fall back to the hardcoded plushie cards and the example drop date. Everything below is opt-in via env vars.

## Architecture

```
[Sanity Studio]                       [Static site on Vercel]
  ├─ plushies            ──GROQ──▶     adopt.html, Collection.html
  ├─ drops               ──GROQ──▶     index.html (countdown)
  └─ on drop publish ──webhook──▶     /api/sanity-webhook
                                              │
                                              ▼
[Newsletter form]  ──POST──▶  /api/subscribe ─▶ [Loops API]
                                                   │
                                                   ├─ Mailing list: subscribers
                                                   └─ Event "drop_published" ──▶ subscribers' inboxes

[Contact form]     ──POST──▶  /api/contact   ─▶ [Loops Transactional]
                                                   ├─ Workshop notification ──▶ workshop inbox
                                                   └─ Optional auto-reply   ──▶ submitter's inbox

[Adopt button] ──Snipcart-add-item──▶ [Snipcart cart] ──checkout──▶ [Stripe via Snipcart]
```

## 1. Set up the Sanity project

```bash
npm create sanity@latest -- --template clean --create-project "Peaches N Plushies" --dataset production
```

Follow prompts. When it finishes, copy the schema files from this repo's `sanity/schemas/` into your new Studio project's `schemaTypes/` folder, and update its `sanity.config.js` to import them. Full instructions in [`sanity/README.md`](./sanity/README.md).

Make the dataset publicly readable so the static site can fetch without auth:

```bash
cd path/to/your-studio
npx sanity dataset visibility set production public
```

Note your **Project ID** (you'll need it in step 4) — find it at <https://sanity.io/manage> or in `sanity.config.js`.

## 2. Set up Loops

1. Sign up at <https://loops.so>.
2. Settings → API → create a key. Save it — you'll need `LOOPS_API_KEY`.
3. Audience → Mailing Lists → create one called e.g. "PNP Drop Subscribers." Copy its ID from the URL — that's `LOOPS_MAILING_LIST_ID`.
4. Loops → Loops (the automation builder) → New Loop:
   - Trigger: **Event** → name it `drop_published` (or whatever you set as `LOOPS_DROP_EVENT_NAME`).
   - Audience filter: members of your mailing list.
   - Email body: use Loops' template editor. The available variables come from the event's `eventProperties`:
     - `{{eventProperties.dropName}}`
     - `{{eventProperties.dropDescription}}`
     - `{{eventProperties.dropAt}}` (ISO date string)
     - `{{eventProperties.dropId}}`
   - Set delay to "immediately" so it fires the moment Sanity publishes a drop.
   - Publish the loop.
5. **Contact form transactional template(s):**
   - Loops → **Transactional** → **New template**.
   - Subject line: e.g. `New contact: {{inquiryType}} — {{name}}`.
   - Body — reference these data variables:
     - `{{name}}`, `{{fromEmail}}`, `{{subject}}`, `{{message}}`, `{{inquiryType}}`, `{{submittedAt}}`.
   - Copy the template id (from the URL or the template's settings) — that's `LOOPS_CONTACT_TRANSACTIONAL_ID`.
   - **Optional auto-reply:** create a second transactional template that thanks the submitter for reaching out. It can reference `{{name}}`, `{{subject}}`, `{{inquiryType}}`. Copy its id into `LOOPS_CONTACT_CONFIRMATION_ID`. Skip this step if you'd rather just reply by hand.

## 3. Set up Snipcart (checkout)

1. Sign up at <https://snipcart.com>.
2. Account → API Keys → copy the **Public API Key**. You'll set it as `SNIPCART_PUBLIC_API_KEY` in Vercel.
3. Add Stripe (or another payment gateway) to your Snipcart account so you can actually take payments. Snipcart's own dashboard walks through this.
4. Define your products one of two ways:
   - **JSON crawler** (easiest for static sites): Snipcart re-fetches the `data-item-url` (e.g., `/adopt.html`) and validates the cart against the matching button on that page. As long as the button stays on the page with the same `data-item-id` and `data-item-price`, you're set.
   - **Dashboard products**: in the Snipcart dashboard, define each plushie as a product with the same `data-item-id`. More overhead but more control (variants, stock counts, taxes).
5. **Test mode**: Snipcart starts in TEST mode — every "purchase" goes through Stripe's test environment. Flip to LIVE in the dashboard when you're ready to take real orders.

The site auto-detects `SNIPCART_PUBLIC_API_KEY`:

- **Set** → Snipcart loads sitewide; Adopt buttons add the plushie to cart; a cart icon appears in the nav.
- **Unset** → Adopt buttons fall back to a plain link to `/store.html`; no Snipcart code loads.

## 4. Deploy to Vercel

```bash
cd "/path/to/PNC Website"
npx vercel
```

Walk through the prompts. The `vercel.json` and `package.json` are already configured. Vercel will:

- Detect `npm run build` and run `scripts/build-config.js` (which writes `config.js` from your env vars).
- Pick up `api/*.js` as serverless functions.
- Serve everything else as static files.

## 5. Add env vars in Vercel

Vercel dashboard → your project → Settings → Environment Variables. Add:

| Name                      | Value                                       | Where it's used                                                                         |
| ------------------------- | ------------------------------------------- | --------------------------------------------------------------------------------------- |
| `SANITY_PROJECT_ID`       | from Sanity dashboard                       | client + server                                                                         |
| `SANITY_DATASET`          | `production` (or yours)                     | client + server                                                                         |
| `SANITY_API_VERSION`      | `2024-01-01`                                | client + server                                                                         |
| `LOOPS_API_KEY`           | from Loops settings                         | server only                                                                             |
| `LOOPS_MAILING_LIST_ID`   | from Loops mailing list URL                 | server only                                                                             |
| `LOOPS_DROP_EVENT_NAME`   | `drop_published` (must match your loop)     | server only                                                                             |
| `LOOPS_CONTACT_TRANSACTIONAL_ID` | from Loops transactional template URL | server only — required for `/api/contact` to deliver the workshop notification          |
| `LOOPS_CONTACT_CONFIRMATION_ID`  | optional, second transactional id     | server only — if set, sends an auto-reply back to the submitter                         |
| `CONTACT_RECIPIENT_EMAIL`        | the workshop inbox                    | server only — where contact-form notifications are delivered                            |
| `SANITY_WEBHOOK_SECRET`   | a strong random string you make up          | server only                                                                             |
| `SANITY_WRITE_TOKEN`      | from Sanity → API → Tokens (Editor scope)   | server only — optional, used to mark drops as already-emailed so they don't double-send |
| `SNIPCART_PUBLIC_API_KEY` | from Snipcart → Account → API Keys → Public | client (safe to expose)                                                                 |
| `SNIPCART_VERSION`        | e.g. `3.7.1`                                | client. Pin so vendor updates can't break checkout silently                             |
| `SITE_ORIGIN`             | `https://yourdomain.vercel.app`             | optional, for canonical URLs                                                            |

Re-deploy (`npx vercel --prod`) so the build script picks up the new env vars and writes them into `config.js`.

## 6. Wire the Sanity webhook

Sanity dashboard → API → Webhooks → Create:

- **Name**: Drop publish → Vercel
- **URL**: `https://yourdomain.vercel.app/api/sanity-webhook`
- **Trigger on**: Create, Update
- **Filter**: `_type == "drop" && !defined(emailSentAt)`
- **Projection**:
  ```
  { _id, _type, name, description, dropAt, sendEmailOnPublish, emailSentAt }
  ```
- **HTTP method**: POST
- **API version**: 2024-01-01
- **Secret**: paste the same string you set as `SANITY_WEBHOOK_SECRET`

Save. Now publishing a `drop` document triggers a Loops email.

## 7. Test the full flow

1. **Newsletter signup**: open the homepage on the live site, type an email into the "Get the next drop, 24h early" form, submit. Check Loops → Audience to see the contact appear on your mailing list.
2. **Drop email**: in Sanity Studio, create a new `Drop` doc with `sendEmailOnPublish: true` and a `dropAt` in the near future. Publish it. Within ~30 seconds the Loops loop should send the email to anyone on the mailing list. Check Loops → Loops → your loop → Activity to see the run.
3. **Snipcart checkout**: open `adopt.html`, click "Adopt Pippa". Snipcart's drawer should slide in showing Pippa in the cart. Click "Checkout" — in TEST mode, use Stripe's test card `4242 4242 4242 4242`.
4. **Hardcoded fallback**: temporarily blank out `SANITY_PROJECT_ID` _or_ `SNIPCART_PUBLIC_API_KEY` in Vercel and redeploy. The site should fall back gracefully — no errors, just plain links to `/store.html` for adopt CTAs and hardcoded plushies on the page.

## What lives where

- `sanity/schemas/` — schema definitions to drop into your Sanity Studio project
- `sanity/README.md` — Studio-specific setup
- `sanity-client.js` — small browser-side helper (no SDK, just `fetch`)
- `config.js` — public env vars, generated at build time
- `scripts/build-config.js` — generates `config.js` from `process.env`
- `api/subscribe.js` — `/api/subscribe` Vercel Function (Loops contact create/update)
- `api/contact.js` — `/api/contact` Vercel Function (Loops transactional → workshop inbox)
- `api/sanity-webhook.js` — `/api/sanity-webhook` (HMAC-verified, fires Loops event)
- `vercel.json` — routes, function runtime, cache headers
- `package.json` — Vercel build hook + Node 20 ESM
- `.env.example` — env var reference

## Troubleshooting

**Newsletter form returns 500**
Check Vercel function logs (Deployments → click deploy → Functions → `/api/subscribe`). Most likely `LOOPS_API_KEY` is missing or wrong.

**Adopt page still shows hardcoded plushies after Sanity setup**

- Open DevTools → Network. Look for a request to `*.apicdn.sanity.io`. If 404, your `SANITY_PROJECT_ID` is wrong.
- If the request returns `result: []`, your dataset has no `plushie` documents yet.
- If it succeeds with data but the page doesn't update, check the Console for `[sanity]` warnings.

**Webhook fires but no email arrives**

1. Loops → Loops → your loop → Activity. If the run is missing, the webhook never reached Loops — check Vercel function logs for `/api/sanity-webhook` errors.
2. If the run is there but failed, check the loop's audience filter — most likely your test contacts aren't on the mailing list.
3. Check spam.

**Drop emails sending twice**
You skipped the `SANITY_WRITE_TOKEN` step, so the handler can't mark drops as already-sent. Either add the token, or just toggle `sendEmailOnPublish: false` on each drop after publishing.

**Snipcart cart opens but product fails to validate**
Snipcart re-fetches the `data-item-url` and looks for a button with the matching `data-item-id` and `data-item-price`. If you change a price after a customer puts the item in their cart, validation fails. Either bump the `data-item-id` (treat it as a new product) or define the product in Snipcart's dashboard so the dashboard is the source of truth.

**No cart icon in nav**
The cart icon only appears when `SNIPCART_PUBLIC_API_KEY` is set. Check `config.js` in your deployed site — `snipcartApiKey` should be a non-empty string.

## Costs at small-shop scale

- **Vercel** Hobby plan — free, includes generous function invocations + bandwidth.
- **Sanity** free tier — 3 users, 10k docs, 1M API requests/mo. Plenty of room.
- **Loops** free tier — 1,000 contacts, 2,000 sends/mo. Enough for a small handmade brand.
- **Snipcart** — 2% per transaction in test mode (free), 2% on live transactions or $20/mo flat once you do over $1k in sales. No setup fee.

If/when you outgrow Loops free, the next tier is $49/mo for 10k contacts.
