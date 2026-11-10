#!/usr/bin/env bash
# Installs or updates the prey service. Run with sudo from WSL after deploy/build.sh:
#   sudo deploy/install.sh
# Idempotent: creates the system user and unit the first time, then just
# replaces the files in /opt/prey and restarts the service.
set -euo pipefail
cd "$(dirname "$0")/.."

[ "$(id -u)" -eq 0 ] || { echo "Run with sudo" >&2; exit 1; }
[ -f dist/index.html ] || { echo "dist/ missing: run deploy/build.sh first" >&2; exit 1; }

id prey >/dev/null 2>&1 || useradd --system --no-create-home --home-dir /opt/prey --shell /usr/sbin/nologin prey

# root owns the files, the service can only read them
install -d -o root -g prey -m 750 /opt/prey
find /opt/prey -mindepth 1 -delete
cp -r dist/. /opt/prey/
chown -R root:prey /opt/prey
chmod -R u=rwX,g=rX,o= /opt/prey

install -m 644 deploy/prey.service /etc/systemd/system/prey.service
systemctl daemon-reload
systemctl enable prey >/dev/null 2>&1
systemctl restart prey
systemctl --no-pager --lines=0 status prey
