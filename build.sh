#!/bin/bash
# Vercel build script — runs Python generator to produce 459 programmatic pages
# Configure in Vercel: Project Settings → Build & Development Settings → Build Command: bash build.sh

set -e

echo "🌞 SolarSubsidies.com — Building 459 programmatic pages"
echo "========================================================"

# Vercel ships Python 3 by default
python3 generator/generate.py

echo ""
echo "Copying generated pages to project root..."

# The generator outputs to /output. Copy to project root for Vercel static serving.
if [ -d "output" ]; then
  # Remove old generated dirs if they exist (clean rebuild)
  rm -rf ./d ./discom 2>/dev/null || true
  
  # Move new generated content
  cp -r output/d ./d
  cp -r output/discom ./discom
  cp -f output/sitemap.xml ./sitemap.xml
  
  # Count what we produced
  echo "✓ District pages: $(find d -name '*.html' | wc -l)"
  echo "✓ DISCOM pages: $(find discom -name '*.html' | wc -l)"
  echo "✓ Sitemap updated"
fi

echo ""
echo "✅ Build complete — Vercel will serve all generated files as static."
