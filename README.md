# Swanson Worx — website

Standalone marketing site for **Swanson Worx Limited**, a family-run auto workshop in Swanson, West Auckland. One self-contained `index.html` (all CSS & JS inline) with a services ledger, an **indicative estimate & booking-request** wizard, FAQ, local-business structured data (`AutoRepair` + `FAQPage`), and a contact section with map.

## Local preview

No build step, no dependencies to install. From the repo root:

```bash
python -m http.server 8000
```

Then open <http://localhost:8000/> — `index.html` is the root entry point. (The hero image, Google Fonts and the embedded Google Map load over the internet.)

## Deploy — GitHub Pages

- **Source:** `main` branch, `/ (root)` folder.
- **Custom domain:** `swanson-works.maximisedai.com` — tracked by the `CNAME` file in this repo.
- **DNS:** add a `CNAME` record for host `swanson-works` (in the `maximisedai.com` zone) pointing to `captjreacher.github.io`.
- In **Settings → Pages**, set the custom domain to `swanson-works.maximisedai.com`, then enable **Enforce HTTPS** once the certificate is issued.
- `.nojekyll` is included so Pages serves the HTML as-is (no Jekyll processing).

## Commercial positioning (important)

- Prices are shown as **indicative ranges**; the exact price is confirmed by Swanson Worx **after a vehicle / service inspection**.
- The estimate wizard is a **front-end demo**: the final step is a **booking request**, not an automatically confirmed appointment, and is not yet wired to a live API.

## Business details

Swanson Worx Limited · 720D Swanson Road, Swanson, Auckland 0612, New Zealand · 09-833 9988 · swansonworx@gmail.com
