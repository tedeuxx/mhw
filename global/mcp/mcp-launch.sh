#!/bin/sh
# Launch one local MCP server with its credentials taken from the OS secret store at process start
# (ADR-0017). The harness config that starts this script holds only secret NAMES, never a value.
#
#   mcp-launch.sh [--secret NAME=SOURCE]... -- <server command> [server args...]
#
# SOURCE is one of:
#   keychain:<service>   macOS login Keychain, generic password with that service name, read with
#                        /usr/bin/security at launch. The value travels on that tool's stdout into
#                        this shell, never through any process's argv.
#   env:<VAR>            the value of VAR in this script's own environment (indirection: the harness
#                        must forward VAR; Codex does it through env_vars, which the renderer writes).
#
# Each value is exported as NAME into the server's environment, and then this script execs the
# server, so the server is the process the harness talks to. A missing or empty secret stops the
# launch with a message naming NAME and its source, never the value: the harness reports the server
# as failed, which is visible, instead of starting it without its credential.
set -eu

die() {
  printf 'mcp-launch: %s\n' "$1" >&2
  exit "${2:-2}"
}

valid_name() {
  case $1 in
    '' | [0-9]* | *[!A-Za-z0-9_]*) return 1 ;;
  esac
  return 0
}

while [ $# -gt 0 ]; do
  case $1 in
    --secret)
      [ $# -ge 2 ] || die "--secret needs NAME=SOURCE"
      spec=$2
      shift 2
      case $spec in *=*) ;; *) die "--secret '$spec' is not NAME=SOURCE" ;; esac
      name=${spec%%=*}
      src=${spec#*=}
      valid_name "$name" || die "secret name '$name' is not a valid environment variable name"
      case $src in
        keychain:?*)
          service=${src#keychain:}
          [ -x /usr/bin/security ] || die "secret $name: keychain: needs macOS (/usr/bin/security not found)"
          if ! value=$(/usr/bin/security find-generic-password -s "$service" -w 2>/dev/null); then
            die "secret $name: no readable Keychain item for service '$service' (absent, or the Keychain is locked)" 3
          fi
          ;;
        env:?*)
          var=${src#env:}
          valid_name "$var" || die "secret $name: '$var' is not a valid environment variable name"
          if ! value=$(printenv "$var"); then
            die "secret $name: environment variable $var is not set in the launcher's environment" 3
          fi
          ;;
        *) die "secret $name: unknown source '$src' (use keychain:<service> or env:<VAR>)" ;;
      esac
      [ -n "$value" ] || die "secret $name: the source $src is empty" 3
      export "$name=$value"
      unset value
      ;;
    --)
      shift
      break
      ;;
    *) die "unexpected argument '$1' (usage: mcp-launch.sh [--secret NAME=SOURCE]... -- command [args...])" ;;
  esac
done

[ $# -gt 0 ] || die "no server command after --"
exec "$@"
