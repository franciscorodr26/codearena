# CodeArena Logo Asset Package

The finished logo asset package and instructions for installing it into the
Next.js app. Everything in this folder is design/source material; nothing here
is wired into the live app until you run the install step below.

## Concept

A **"C with negative space"** mark: a single continuous mint stroke that forms
the letter **C** while carving an inner notch that doubles as the negative-space
counter. It sits on a near-black rounded squircle, reading as a clean app-icon
silhouette at any size.

## Colors

| Role            | Hex       | Notes                                  |
| --------------- | --------- | -------------------------------------- |
| Mark (stroke)   | `#5EEAD4` | Mint                                   |
| Background tile | `#0A0A0B` | Near-black squircle                    |

## Source files (this folder)

| File                            | Purpose                                                              |
| ------------------------------- | ------------------------------------------------------------------- |
| `codearena-mark-refined.svg`    | **Final** mark, true to the original proportions. Master source.    |
| `codearena-mark-balanced.svg`   | Alt mark with gaps opened slightly for tiny-size legibility.        |
| `og-image.svg`                  | Source for the Open Graph / social share card.                      |
| `index.html`                    | Local preview page for the concepts.                                |
| `concept-*.svg`                 | Earlier exploration concepts (not for production).                  |

## Generated raster assets (`dist/`)

These are rendered from the source SVGs by the asset-generation pass and are what
actually ship to the app:

| File in `dist/`               | Used for                                                        |
| ----------------------------- | --------------------------------------------------------------- |
| `favicon-16x16.png`           | Browser tab favicon (small).                                    |
| `favicon-32x32.png`           | Browser tab favicon (standard).                                 |
| `favicon.ico`                 | Legacy/multi-size favicon for older browsers.                   |
| `apple-touch-icon.png`        | iOS home-screen icon (180x180).                                 |
| `android-chrome-192x192.png`  | Android / PWA icon, referenced by `site.webmanifest`.           |
| `android-chrome-512x512.png`  | Android / PWA large icon + splash, referenced by manifest.      |
| `og-image.png`                | Open Graph + Twitter share image (1200x630).                    |

## How to install

`install.sh` (in this folder) copies every `dist/` file over the matching live
asset in `frontend/public/`. Run it **from the repo root**:

```bash
./design/logo-concepts/install.sh
```

The exact mapping it performs:

| Source (`dist/`)              | Destination (`frontend/public/`)        |
| ----------------------------- | --------------------------------------- |
| `favicon-16x16.png`           | `frontend/public/favicon-16x16.png`     |
| `favicon-32x32.png`           | `frontend/public/favicon-32x32.png`     |
| `favicon.ico`                 | `frontend/public/favicon.ico`           |
| `apple-touch-icon.png`        | `frontend/public/apple-touch-icon.png`  |
| `android-chrome-192x192.png`  | `frontend/public/android-chrome-192x192.png` |
| `android-chrome-512x512.png`  | `frontend/public/android-chrome-512x512.png` |
| `og-image.png`                | `frontend/public/og-image.png`          |

These filenames already match what `frontend/pages/_document.js` and
`frontend/public/site.webmanifest` reference, so no markup changes are required
for the favicons or share image to pick up the new artwork.

## Things to double-check after install

1. **Manifest colors.** `frontend/public/site.webmanifest` currently has
   `"theme_color": "#ffffff"` and `"background_color": "#ffffff"`. Against the new
   dark icon, consider switching both to `#0A0A0B` so the PWA splash/chrome match.
2. **TileColor.** `frontend/pages/_document.js` sets
   `msapplication-TileColor` to `#0abab5` (and `theme-color` to `#000000`). These
   are fine as-is, just noted in case you want them aligned with the new palette.
3. **In-app header/footer logo is TEXT, not an icon image.**
   `frontend/components/Logo.js` and `frontend/components/ui/Logo.js` render a
   text wordmark ("CodeArena" with a `</>` symbol in mint), used by `Header.js`
   and `Footer.js`. Swapping the icon files here does **not** change the nav logo.
   If you want the new "C" mark in the header/footer, those Logo components must be
   updated separately (out of scope for this package).
