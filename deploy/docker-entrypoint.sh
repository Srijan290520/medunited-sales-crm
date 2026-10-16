#!/bin/sh
# Writes config.js from the CRM_API_URL environment variable at container start,
# so one image works with any backend deployment.
set -eu
if [ -n "${CRM_API_URL:-}" ]; then
  case "$CRM_API_URL" in
    https://*) ;;
    *) echo "CRM_API_URL must start with https://" >&2; exit 1 ;;
  esac
  esc=$(printf '%s' "$CRM_API_URL" | sed "s/[\\\\']/\\\\&/g")
  printf "window.__CRM_CONFIG__ = { apiUrl: '%s', appName: 'MedUnited CRM' };\n" "$esc" > /usr/share/nginx/html/config.js
fi
