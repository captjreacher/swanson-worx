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
- The estimate wizard is a **front-end demo**: the final step is a **booking request**, not an automatically confirmed appointment, and is not yet wired to a live API.

## Business details

Swanson Worx Limited · 720D Swanson Road, Swanson, Auckland 0612, New Zealand · 09-833 9988 · swansonworx@gmail.com
