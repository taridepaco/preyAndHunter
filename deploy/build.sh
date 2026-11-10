#!/usr/bin/env bash
# Builds the static site into dist/. Cloudflare caches JS and CSS for hours even when the server
# says no-cache, and ES modules import each other, so a ?v=hash on index.html would not reach them.
# Instead everything but index.html goes under v/<hash>/, a directory named after the content:
# any change gives new URLs, while index.html (which always arrives fresh) points to the latest one.
set -euo pipefail
cd "$(dirname "$0")/.."

files=$(cd web && find . -type f ! -path './tests/*' ! -name index.html | sort)
v=$(cd web && echo "$files" | xargs sha256sum | sha256sum | cut -c1-10)

rm -rf dist
mkdir -p "dist/v/$v"
(cd web && echo "$files" | xargs -I{} cp --parents {} "../dist/v/$v/")
# every local stylesheet and script (style.css, system.css, theme.js, main.js); URLs with ':' stay
sed -E "s#(href|src)=\"([^\":]+\.(css|js))\"#\1=\"v/$v/\2\"#g" web/index.html > dist/index.html

grep -oE '(src|href)="v/[^"]+"' dist/index.html
echo "dist/ ready (v/$v)"
