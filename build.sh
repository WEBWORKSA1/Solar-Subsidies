#!/bin/bash
# Vercel build script — runs Python generators to produce 459 programmatic pages + vendor directory
# Configure in Vercel: Project Settings → Build & Development Settings → Build Command: bash build.sh

set -e

echo "🌞 SolarSubsidies.com — Build Pipeline"
echo "========================================================"

# Vercel ships Python 3 by default

# Step 1: Generate 459 programmatic district + DISCOM pages
echo ""
echo "[1/2] Generating district + DISCOM pages..."
python3 generator/generate.py

# Step 2: Generate vendor directory + profile pages
echo ""
echo "[2/2] Generating vendor directory + profile pages..."
python3 generator/generate-vendors.py

echo ""
echo "Copying generated pages to project root..."

# The generator outputs to /output. Copy to project root for Vercel static serving.
if [ -d "output" ]; then
  # Remove old generated dirs (clean rebuild)
  rm -rf ./d ./discom 2>/dev/null || true
  
  # Move district + DISCOM pages
  if [ -d "output/d" ]; then
    cp -r output/d ./d
    echo "✓ District pages: $(find d -name '*.html' | wc -l)"
  fi
  
  if [ -d "output/discom" ]; then
    cp -r output/discom ./discom
    echo "✓ DISCOM pages: $(find discom -name '*.html' | wc -l)"
  fi
  
  # Vendor pages — merge with existing /vendors/ dir (which has hand-built index.html, apply.html, portal.html)
  if [ -d "output/vendors" ]; then
    # Copy generated vendor profiles (e.g. /vendors/tata-power-solar.html)
    # but DO NOT overwrite hand-built files (index.html, apply.html, portal.html)
    for f in output/vendors/*.html; do
      filename=$(basename "$f")
      # Skip hand-built files
      if [ "$filename" != "index.html" ] && [ "$filename" != "apply.html" ] && [ "$filename" != "portal.html" ]; then
        cp "$f" "./vendors/$filename"
      fi
    done
    
    # Copy generated directory index
    if [ -d "output/vendors/directory" ]; then
      mkdir -p ./vendors/directory
      cp -f output/vendors/directory/index.html ./vendors/directory/index.html
      echo "✓ Vendor directory: ./vendors/directory/index.html"
    fi
    
    echo "✓ Vendor profile pages: $(find vendors -maxdepth 1 -name '*.html' ! -name 'index.html' ! -name 'apply.html' ! -name 'portal.html' | wc -l)"
  fi
  
  # Sitemap
  if [ -f "output/sitemap.xml" ]; then
    cp -f output/sitemap.xml ./sitemap.xml
    echo "✓ Sitemap updated"
  fi
fi

echo ""
echo "✅ Build complete — Vercel will serve all generated files as static."
