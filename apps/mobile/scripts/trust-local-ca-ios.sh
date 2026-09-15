#!/bin/sh
set -eu

if ! command -v mkcert >/dev/null 2>&1; then
  echo "mkcert is required (brew install mkcert)" >&2
  exit 1
fi

if ! xcrun simctl list devices | grep -q '(Booted)'; then
  echo "Boot an iOS Simulator before installing the local CA" >&2
  exit 1
fi

ca_file="$(mkcert -CAROOT)/rootCA.pem"
if [ ! -f "$ca_file" ]; then
  echo "mkcert root CA not found at $ca_file" >&2
  exit 1
fi

xcrun simctl keychain booted add-root-cert "$ca_file"
echo "Installed the mkcert root CA in the booted iOS Simulator"
