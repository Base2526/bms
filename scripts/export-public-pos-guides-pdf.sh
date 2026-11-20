#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
FONT_DIR="$ROOT/apps/web/public/fonts/sarabun"
GUIDE_DIR="$ROOT/apps/web/public/guides/pos"
if [[ ! -f "$FONT_DIR/Sarabun-Regular.ttf" ]]; then
  echo "Missing Sarabun-Regular.ttf" >&2
  exit 1
fi
if ! command -v soffice >/dev/null 2>&1; then
  echo "LibreOffice soffice is required" >&2
  exit 1
fi

TEMP_DIR="$(mktemp -d "${TMPDIR:-/tmp}/bms-pos-guides.XXXXXXXX")"
trap 'rm -rf "$TEMP_DIR"' EXIT
cat > "$TEMP_DIR/fonts.conf" <<EOF
<?xml version="1.0"?>
<!DOCTYPE fontconfig SYSTEM "fonts.dtd">
<fontconfig>
  <dir>$FONT_DIR</dir>
  <cachedir>$TEMP_DIR/cache</cachedir>
</fontconfig>
EOF

FONTCONFIG_FILE="$TEMP_DIR/fonts.conf" soffice \
  "-env:UserInstallation=file://$TEMP_DIR/profile" \
  --headless --convert-to pdf --outdir "$GUIDE_DIR" \
  "$GUIDE_DIR"/bms-pos-*-th.docx
