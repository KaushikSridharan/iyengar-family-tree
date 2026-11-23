# Iyengar Family Tree

A **zero-build, zero-Node** static, offline-capable Progressive Web App (PWA) for browsing a family tree read-only across phones, tablets, and desktops.

## Zero-Build Deployment

The site runs directly from plain static files (`index.html`, `styles.css`, `app.js`, `lib/*.js`, `tree.json`, `photos/`, `manifest.webmanifest`, `sw.js`) with **no Node, no npm, and no build step required**:

- **GitHub Pages**: Serve directly from the `main` branch (`/`).
- **Cloudflare Pages**: Connect the repository with **no build command** and output directory `/`.
- **Local preview**: `python3 scripts/serve.py` (or `python3 -m http.server 3000`).

## Repository Structure

- `index.html`, `styles.css`, `app.js`, `lib/` — Plain HTML, CSS, and browser ES modules.
- `tree.json` — Single source of truth for all people and unions.
- `photos/` — Square-cropped WebP portraits (`<id>.webp` at 400×400 and `<id>.thumb.webp` at 96×96). Originals are kept outside the repository.
- `sw.js`, `manifest.webmanifest` — Offline service worker (`NetworkFirst` for shell & `tree.json`, `CacheFirst` for viewed photos) and PWA manifest.
- `scripts/` — Optional Python 3 helper scripts (standard library; `add_photo.py` uses system `ffmpeg` or ImageMagick).
- `_headers` — Static hosting cache & `noindex` rules (Cloudflare Pages).

## Data Format (`tree.json`)

- `defaultStartId` — Optional person ID shown first to visitors who have not marked themselves with "This is me".
- `lastUpdated` — ISO date (`YYYY-MM-DD`) displayed in the app.
- `people` — Object keyed by stable lowercase ID (`p01`, `p18`, etc.).
  - Required: `name`
  - Optional: `fullName`, `altName`, `gender` (`"f" | "m" | "x"`), `born`, `died` (`YYYY`, `YYYY-MM`, or `YYYY-MM-DD`), `birthplace`, `location` (displayed as **Currently staying** for living people, or **Lived in** for deceased people), `parents` (1–2 IDs), `photo`, `notes`.
- `unions` — Array of partnerships with `partners: [idA, idB]`, optional `married`, `ended`, `status`, and `order`.

## Optional Editor Helpers (Python 3)

```bash
python3 scripts/edit_tree.py         # Full local browser UI to edit tree.json & photos
python3 scripts/new_id.py "Kiran"
python3 scripts/add_photo.py ~/Downloads/portrait.jpg p43-kiran
python3 scripts/format_tree.py
python3 scripts/validate.py --report
```
