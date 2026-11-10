#!/usr/bin/env bash
# Installs or updates the site on this machine. Run with sudo after deploy/build.sh:
#   deploy/build.sh && sudo deploy/install.sh
# <name> is the name of the only deploy/<name>.service: copies dist/ to /opt/<name> and installs
# that unit, which serves it on 127.0.0.1 as the system user <name>.
# Idempotent: creates the user and the unit the first time, then just replaces the files and
# restarts the service.
# Common to every taridepaco site, copied from taridepaco.github.io: do not edit it here.
set -euo pipefail
cd "$(dirname "$0")/.."

[ "$(id -u)" -eq 0 ] || { echo "Run with sudo" >&2; exit 1; }
[ -f dist/index.html ] || { echo "dist/ missing: run deploy/build.sh first" >&2; exit 1; }

units=(deploy/*.service)
[ "${#units[@]}" -eq 1 ] && [ -f "${units[0]}" ] || { echo "expected exactly one deploy/*.service" >&2; exit 1; }
name=$(basename "${units[0]}" .service)
dest=/opt/$name

id "$name" >/dev/null 2>&1 || useradd --system --no-create-home --home-dir "$dest" --shell /usr/sbin/nologin "$name"

# root owns the files, the service can only read them
install -d -o root -g "$name" -m 750 "$dest"
find "$dest" -mindepth 1 -delete
cp -r dist/. "$dest/"
chown -R "root:$name" "$dest"
chmod -R u=rwX,g=rX,o= "$dest"

install -m 644 "${units[0]}" "/etc/systemd/system/$name.service"
systemctl daemon-reload
systemctl enable "$name" >/dev/null 2>&1
systemctl restart "$name"
systemctl --no-pager --lines=0 status "$name"
