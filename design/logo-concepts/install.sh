#!/usr/bin/env bash
#
# install.sh — Install the new CodeArena logo asset package into the live app.
#
# This copies the generated raster assets from design/logo-concepts/dist/ into
# frontend/public/, OVERWRITING the current live icons and OG image in place.
#
# Run this from the REPO ROOT:
#     ./design/logo-concepts/install.sh
#
# The destination filenames already match what _document.js and
# site.webmanifest reference, so no markup changes are needed for the
# favicons / share image to pick up the new artwork.

set -euo pipefail

SRC="design/logo-concepts/dist"
DEST="frontend/public"

cp "$SRC/favicon-16x16.png"          "$DEST/favicon-16x16.png"
cp "$SRC/favicon-32x32.png"          "$DEST/favicon-32x32.png"
cp "$SRC/favicon.ico"                "$DEST/favicon.ico"
cp "$SRC/apple-touch-icon.png"       "$DEST/apple-touch-icon.png"
cp "$SRC/android-chrome-192x192.png" "$DEST/android-chrome-192x192.png"
cp "$SRC/android-chrome-512x512.png" "$DEST/android-chrome-512x512.png"
cp "$SRC/og-image.png"               "$DEST/og-image.png"

echo "Logo assets installed into $DEST."
echo
echo "Follow-ups to consider (not done automatically):"
echo "  1. site.webmanifest: theme_color/background_color are #ffffff -> consider #0A0A0B to match the dark icon."
echo "  2. _document.js: msapplication-TileColor is #0abab5 (fine; noted for palette alignment)."
echo "  3. Header/Footer use a TEXT Logo component (components/Logo.js, components/ui/Logo.js)."
echo "     Update those separately if you want the new mark in the nav."
