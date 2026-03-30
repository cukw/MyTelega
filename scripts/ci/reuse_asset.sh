#!/usr/bin/env bash
set -euo pipefail

if [[ $# -ne 2 ]]; then
  echo "usage: $0 <current-release-tag> <asset-name>" >&2
  exit 1
fi

current_tag="$1"
asset_name="$2"

tmp_dir="$(mktemp -d)"
cleanup() {
  rm -rf "$tmp_dir"
}
trap cleanup EXIT

if ! gh release view "$current_tag" >/dev/null 2>&1; then
  echo "release '$current_tag' was not found" >&2
  exit 1
fi

mapfile -t release_tags < <(gh release list --limit 100 --json tagName --jq '.[].tagName')

for tag in "${release_tags[@]}"; do
  if [[ "$tag" == "$current_tag" ]]; then
    continue
  fi

  if gh release view "$tag" --json assets --jq '.assets[].name' 2>/dev/null | grep -Fxq "$asset_name"; then
    echo "reusing '$asset_name' from release '$tag'"
    gh release download "$tag" --pattern "$asset_name" --dir "$tmp_dir"
    gh release upload "$current_tag" "$tmp_dir/$asset_name" --clobber
    echo "uploaded reused asset '$asset_name' to '$current_tag'"
    exit 0
  fi
done

echo "unable to find previous release containing '$asset_name'" >&2
echo "trigger a full build at least once before reusing assets" >&2
exit 1
