#!/bin/sh
# Runs as root (the image's default user) so it can fix ownership of the
# mounted signing-keys volume before dropping to the unprivileged `node`
# user for the actual process. Needed because some hosts (e.g. Railway)
# mount a fresh volume as root-owned regardless of what the image directory
# was chowned to, unlike Docker's own named-volume behavior which copies
# the image directory's ownership on first use.
set -e

KEYS_DIR="${SIGNING_KEYS_DIR:-/keys}"
if [ -d "$KEYS_DIR" ]; then
  chown node:node "$KEYS_DIR" 2>/dev/null || true
fi

exec su node -s /bin/sh -c 'exec "$0" "$@"' -- "$@"
