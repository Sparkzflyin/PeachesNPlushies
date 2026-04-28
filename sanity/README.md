# Sanity Studio Setup

These schemas drop into a Sanity v3 project and power the plushie data on the website.

## One-time setup

1. Create a Sanity project (if you don't have one):
   ```bash
   npm create sanity@latest -- --template clean --create-project "Peaches N Plushies" --dataset production
   ```
   Choose: **TypeScript: No**, **Output path: ../pnp-studio** (or wherever).

2. Copy these schema files into your Studio project's `schemaTypes/` (or `schemas/`) folder:
   - `plushie.js`
   - `drop.js`
   - `collection.js`
   - `index.js` (replaces the default index)

3. Make sure `sanity.config.js` (or `.ts`) imports them:
   ```js
   import { schemaTypes } from './schemaTypes';
   // ...
   schema: { types: schemaTypes }
   ```

4. Run the Studio locally to verify:
   ```bash
   npm run dev
   ```

5. Deploy the Studio (optional but recommended — gives you a URL to edit content):
   ```bash
   npx sanity deploy
   ```

## Make the data public-readable

The website fetches plushie/drop data from the **public** API (no token). Make sure your dataset is public:

```bash
npx sanity dataset visibility set production public
```

(If you ever want private data, you'd need a read token and the fetch would have to go through a Vercel Function instead.)

## Wire the webhook for "drop is live" emails

In the Sanity dashboard → API → Webhooks → Create:

- **Name**: Drop publish → Loops
- **URL**: `https://yourdomain.vercel.app/api/sanity-webhook`
- **Trigger on**: Create, Update
- **Filter**: `_type == "drop" && !defined(emailSentAt)`
- **Projection**: `{ _id, _type, name, description, dropAt, sendEmailOnPublish, emailSentAt }`
- **HTTP method**: POST
- **API version**: 2024-01-01
- **Secret**: copy a strong random string here, paste the same into Vercel as `SANITY_WEBHOOK_SECRET`

Now when you publish a `drop` document with `sendEmailOnPublish: true`, Vercel receives the webhook → fires a Loops event → Loops sends the drop email to your audience. The handler stamps `emailSentAt` on the doc so it never double-sends.

## Schemas

### `plushie`
A single plushie's profile (name, photo, personality, price, status). Used by `adopt.html`.

### `drop`
A scheduled restock. Has a `dropAt` datetime that drives the homepage countdown. Publishing fires the email automation.

### `collection`
A series the plushies belong to (Orchard Pals, Forest Sprites, etc.). Plushies reference one collection.

## Adding your first content

1. Open the Studio, create a `Collection` doc (e.g., "Orchard Pals").
2. Create a few `Plushie` docs, attach them to the Collection, set status: Available.
3. Create a `Drop` doc with a `dropAt` in the near future to test the countdown.
4. Visit your live site — `adopt.html` should render real data, the homepage countdown should match the drop.
