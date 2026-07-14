# Swanson Worx — website

Standalone marketing site for **Swanson Worx Limited**, a family-run auto workshop in Swanson, West Auckland. One self-contained `index.html` (all CSS & JS inline) with a services ledger, an **indicative estimate & booking-request** wizard, FAQ, local-business structured data (`AutoRepair` + `FAQPage`), and a contact section with map. The hero image is self-hosted in `assets/` — no external image host.

## Local preview

No build step, nothing to install. From the repo root:

```bash
python -m http.server 8000
```

Then open <http://localhost:8000/> — `index.html` is the root entry point. (Google Fonts and the embedded Google Map load over the internet; the hero image is local.)

## Deploy — GitHub Pages

- **Source:** `main` branch, `/ (root)` folder.
- **Custom domain:** `swanson-worx.staging.maximisedai.com` — tracked by the `CNAME` file in this repo.
- **DNS:** a `CNAME` record for host `swanson-worx.staging` (in the `maximisedai.com` zone) points to `captjreacher.github.io`. *(Configured.)*
- In **Settings → Pages**, confirm the custom domain is `swanson-worx.staging.maximisedai.com`, then enable **Enforce HTTPS** once the certificate is issued.
- `.nojekyll` is included so Pages serves the HTML as-is.

## Assets

- `assets/workshop.svg` — the hero photo, an optimised JPEG wrapped in an SVG so the site is fully self-contained (referenced by relative path in the page; `og:image` uses the absolute HTTPS URL).

## Commercial positioning

- Prices are shown as **indicative ranges**; the exact price is confirmed by Swanson Worx **after a vehicle / service inspection**.
- The estimate wizard's final step submits a **booking request** (never an automatically confirmed appointment) to the booking-request API documented below. Prices stay indicative until Swanson Worx confirms after inspection.

## Business details

Swanson Worx Limited · 720D Swanson Road, Swanson, Auckland 0612, New Zealand · 09-833 9988 · swansonworx@gmail.com

---

## Booking-request API (estimate → booking request)

The estimate wizard's final step POSTs the collected details to a small **Cloudflare Worker**, which validates them, stores a **booking request** in **Supabase**, and sends notification emails via **Zoho SMTP**. It is a request only — nothing is confirmed automatically (no SMS, calendar, CRM, or auth).

```
static GitHub Pages site  ->  Cloudflare Worker (POST /v1/bookings)  ->  Supabase (service-role insert)  ->  SMTP emails
```

- **Endpoint:** `POST https://api.swanson-worx.staging.maximisedai.com/v1/bookings`
- **Front-end config:** the API base is configurable — override before the wizard script if needed:
  ```html
  <script>window.SwansonWorxConfig = { apiBase: 'https://api.swanson-worx.staging.maximisedai.com' };</script>
  ```
- **Success response:**
  ```json
  { "ok": true, "booking_reference": "SWW-YYYYMMDD-XXXX", "status": "received" }
  ```

### Worker environment variables (secrets)

| Variable | Purpose |
|---|---|
| `MGRNZ_SMTP_HOST` | Zoho SMTP host, for example `smtp.zoho.com` |
| `MGRNZ_SMTP_PORT` | Zoho SMTP port, for example `465` or `587` |
| `MGRNZ_SMTP_USERNAME` | Zoho SMTP username / mailbox |
| `MGRNZ_SMTP_PASSWORD` | Zoho SMTP password or app password |
| `SUPABASE_URL` | Supabase project URL (`https://<ref>.supabase.co`) |
| `SUPABASE_SERVICE_ROLE_KEY` | Service-role key — **Worker only**, never in the browser |
| `BOOKING_NOTIFICATION_EMAIL` | Internal recipient for new-request notifications |
| `EMAIL_FROM` | Verified sender identity, e.g. `Swanson Worx <bookings@swanson-worx.staging.maximisedai.com>` |
| `ALLOWED_ORIGINS` | Comma-separated CORS allowlist (site origin + local dev) |

**Staging routing:** set `BOOKING_NOTIFICATION_EMAIL` to Mike / a test inbox first. Point it at the client only after approval. No secrets are committed to the repo.

### Commands

```bash
# 1. Install dependencies
cd worker
npm install

# 2. Local development (copy the example env first)
cp .dev.vars.example .dev.vars   # then fill in real values (gitignored)
npm run dev                       # wrangler dev on http://localhost:8787

# 3. Set production secrets (once per environment)
npx wrangler secret put MGRNZ_SMTP_HOST
npx wrangler secret put MGRNZ_SMTP_PORT
npx wrangler secret put MGRNZ_SMTP_USERNAME
npx wrangler secret put MGRNZ_SMTP_PASSWORD
npx wrangler secret put SUPABASE_URL
npx wrangler secret put SUPABASE_SERVICE_ROLE_KEY
npx wrangler secret put BOOKING_NOTIFICATION_EMAIL
npx wrangler secret put EMAIL_FROM
npx wrangler secret put ALLOWED_ORIGINS

# 4. Deploy the Worker (provisions the custom domain + TLS when the zone is on Cloudflare)
npx wrangler deploy

# 5. (Optional) idempotency + per-IP rate limiting
npx wrangler kv namespace create BOOKINGS_KV
# add the returned id to wrangler.jsonc under kv_namespaces, then redeploy
```

### Supabase migration

```bash
# With the Supabase CLI, linked to the project:
supabase link --project-ref <project-ref>
supabase db push          # applies supabase/migrations/*.sql

# Or run the SQL directly:
psql "$SUPABASE_DB_URL" -f supabase/migrations/20260710050000_swanson_worx_booking_requests.sql
```

Table `public.swanson_worx_booking_requests` has **RLS enabled with no policies**, so only the service-role key (used by the Worker) can write. Do not add public/anon insert policies.

### DNS

`api.swanson-worx.staging.maximisedai.com` is served by the Worker as a **Cloudflare Custom Domain**. If the `maximisedai.com` zone is on Cloudflare, `wrangler deploy` (with the `custom_domain` route in `wrangler.jsonc`) creates the DNS record and certificate automatically. If DNS is managed elsewhere, instead use a Worker **route** and add a proxied `CNAME` for host `api.swanson-worx.staging` pointing at the Worker.

### Test the endpoint

```bash
# Valid request (expect 201 + booking_reference)
curl -sS -X POST https://api.swanson-worx.staging.maximisedai.com/v1/bookings \
  -H 'Content-Type: application/json' \
  -H 'Origin: https://swanson-worx.staging.maximisedai.com' \
  -d '{"customer_name":"Test User","customer_phone":"0212345678","customer_email":"test@example.com","services":["WOF inspection"],"vehicle_make":"Toyota","vehicle_model":"Aqua","preferred_slot":"Fri 11 Jul  morning drop-off","indicative_estimate":220,"source":"swanson-worx-staging"}'

# Missing email (expect 400)
curl -sS -X POST https://api.swanson-worx.staging.maximisedai.com/v1/bookings \
  -H 'Content-Type: application/json' -H 'Origin: https://swanson-worx.staging.maximisedai.com' \
  -d '{"customer_name":"Test","customer_phone":"021","services":["WOF inspection"],"vehicle_make":"Toyota","vehicle_model":"Aqua","preferred_slot":"Fri"}'

# Disallowed origin (expect 403)
curl -sS -X POST https://api.swanson-worx.staging.maximisedai.com/v1/bookings \
  -H 'Content-Type: application/json' -H 'Origin: https://evil.example' -d '{}'
```

### Repository layout

```
index.html                                   # site + estimate/booking-request wizard
worker/src/index.ts                          # Cloudflare Worker (POST /v1/bookings)
worker/wrangler.jsonc                        # Worker config (no secrets)
worker/package.json                          # scripts + dev deps
worker/tsconfig.json
worker/.dev.vars.example                     # local env template (copy to .dev.vars)
supabase/migrations/*_swanson_worx_booking_requests.sql
```
