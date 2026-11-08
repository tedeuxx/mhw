#!/bin/sh
# The PROD install canary in a clean container (Issue #452). Runs prod_canary.py `run` inside IMAGE,
# as the image's unprivileged `node` user, against packages built OUTSIDE it by prod_canary.py `pack`.
#
#   prod-canary-container.sh IMAGE PKG_DIR COMMIT fresh|upgrade
#
# IMAGE must be pinned by digest (name@sha256:<64 hex>), the convention of reference-delivery-gate.yml.
# PKG_DIR holds mhw-HEAD.tgz, src-HEAD/ and, for upgrade, mhw-from.tgz; it is mounted read-only.
# CONTAINER_RUNTIME picks docker (default) or podman. The one thing fetched inside is jq, from the
# image's own Debian archive, because install.sh needs it and the image does not carry it.
# Evidence level: installed. No agent harness runs in the container.
set -eu
[ "$#" -eq 4 ] || { echo "usage: $0 IMAGE PKG_DIR COMMIT fresh|upgrade" >&2; exit 2; }
image=$1 pkg=$2 commit=$3 mode=$4
printf '%s\n' "$image" | grep -Eq '^[^@[:space:]]+@sha256:[0-9a-f]{64}$' \
  || { echo "BLOCK  the image is not pinned by digest: $image" >&2; exit 2; }
case "$mode" in
  fresh) from="" ;;
  upgrade) from="--from-tgz /pkg/mhw-from.tgz" ;;
  *) echo "mode must be fresh or upgrade" >&2; exit 2 ;;
esac
here=$(cd "$(dirname "$0")" && pwd)
pkg=$(cd "$pkg" && pwd)
runtime=${CONTAINER_RUNTIME:-docker}
# shellcheck disable=SC2016  # $1..$3 expand inside the container's sh, not here
"$runtime" run --rm --network=bridge \
  -v "$pkg:/pkg:ro" -v "$here:/canary:ro" \
  "$image" sh -euc '
    export DEBIAN_FRONTEND=noninteractive
    apt-get update -qq >/dev/null
    apt-get install -y -qq --no-install-recommends jq >/dev/null
    echo "image: $(. /etc/os-release && echo "$PRETTY_NAME"); node $(node --version); npm $(npm --version); $(git --version); $(/usr/bin/python3 --version); jq $(jq --version)"
    exec su node -s /bin/sh -c "python3 -B /canary/prod_canary.py run --source /pkg/src-HEAD \
      --tgz /pkg/mhw-HEAD.tgz $3 --work /tmp/prod-canary-$2 --commit $1"
  ' canary "$commit" "$mode" "$from"
