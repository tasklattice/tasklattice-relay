#!/usr/bin/env sh
# Match the OpenShell Kubernetes workload identity without allowing root.
set -eu
uid="${OPENSHELL_SANDBOX_UID:-1000}"
gid="${OPENSHELL_SANDBOX_GID:-1000}"
case "$uid:$gid" in *[!0-9:]* | 0:* | *:0) echo "Invalid sandbox identity" >&2; exit 1 ;; esac
uid_owner="$(getent passwd "$uid" | cut -d: -f1 || true)"
gid_owner="$(getent group "$gid" | cut -d: -f1 || true)"
for owner in "$uid_owner" "$gid_owner"; do
  case "$owner" in "" | node | sandbox) ;; *) echo "Sandbox identity is already allocated" >&2; exit 1 ;; esac
done
if getent passwd node >/dev/null; then userdel --remove node; fi
if getent group node >/dev/null; then groupdel node; fi
groupmod --gid "$gid" sandbox
usermod --uid "$uid" --gid "$gid" sandbox
chown -R sandbox:sandbox /sandbox
test "$(id -u sandbox):$(id -g sandbox)" = "$uid:$gid"
test "$(stat -c '%u:%g' /sandbox)" = "$uid:$gid"
