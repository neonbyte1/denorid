#!/usr/bin/env bash

PKG_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" &> /dev/null && pwd)/packages"

function die() {
  echo "❌ $1"
  exit ${2:-1}
}

[ -z "${1}" ] && die "the first argument must be the name of the package without scope"

[[ "${2}" =~ ^v?([0-9]+)\.([0-9]+)\.([0-9]+)(-([0-9A-Za-z.-]+))?(\+([0-9A-Za-z.-]+))?$ ]] \
  || die "the second argument must be a valid semantic version, representing the version to publish"

[ ! -d "${PKG_DIR}/${1}" ] && die "Unable to locate package: ${1}"
cd "${PKG_DIR}/${1}"

echo "------------------------------------------------------------------------------------------"
echo "📦 package:         @denorid/${1}"
echo "✨ tagged version:  ${2#v}"

CURRENT_VERSION="$(jq -r '.version' deno.json)"
echo "📌 deno.json        ${CURRENT_VERSION}"
echo "------------------------------------------------------------------------------------------"

[[ "${CURRENT_VERSION}" != "${2#v}" ]] && die "the tagged version does not match with deno.json, skipping..." 0

JSR_VERSION=''

IFS=""
JSR_META=$(npx jsr info "@denorid/${1}" 2>&1)

if [[ \
  $? -eq 1 \
  || "$(echo "${JSR_META}" | grep -Po 'latest: \d+.\d+.\d+' | awk '{print $2}')" != "${CURRENT_VERSION}" \
]]; then
  if ! test -z "${GITHUB_RUN_ID}"; then
    echo "☁️  publishing to https://jsr.io/@denorid/${1} ..."

    npx jsr publish
  else
    echo "🤔 the package was not published because this job has not been triggered by GitHub Actions"
  fi
else
  echo "✅ package is already up to date"
fi
