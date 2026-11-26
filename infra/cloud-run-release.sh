#!/usr/bin/env bash
set -euo pipefail

: "${PROJECT_ID:?}" "${REGION:?}" "${SERVICE:?}" "${GIT_SHA:?}" "${BUILD_ID:?}"
[[ "$GIT_SHA" =~ ^[0-9a-f]{40}$ ]] || { echo 'A full Main commit is required'; exit 1; }
readonly candidate="${SERVICE}-main-${GIT_SHA:0:7}-${BUILD_ID:0:8}"
readonly common=(--project="$PROJECT_ID" --region="$REGION" --quiet)

resolve_gcloud_python() {
  local bin
  bin="$(gcloud info --format='value(basic.python_location)')"
  bin="${bin%$'\r'}"
  if [[ -z "$bin" || "$bin" == *$'\n'* || ! -f "$bin" || ! -x "$bin" ]]; then
    echo 'Missing executable Python from gcloud info' >&2
    exit 1
  fi
  readonly python_bin="$bin"
}

case "${1:-}" in
  prepare)
    : "${IMAGE_TAG:?}"
    resolve_gcloud_python
    # No credentials are written to a file or printed: select only the existing public pin.
    current_pin="$(gcloud run services describe "$SERVICE" "${common[@]}" --format=json |
      "$python_bin" -c 'import json,sys; s=json.load(sys.stdin); print(next((e.get("value","") for e in s["spec"]["template"]["spec"]["containers"][0].get("env",[]) if e["name"]=="MF06_CUTOVER_MANIFEST_SHA256"),""))')"
    new_pin="$("$python_bin" -c 'import json; print(json.load(open("/workspace/.mf06-release-info.json"))["reviewedManifestSha256"])')"
    if [[ "$current_pin" != "$new_pin" ]]; then
      echo 'The reviewed authority release changed. Complete the canonical migration/epoch rollout before automatic promotion.' >&2
      exit 1
    fi
    digest="$(gcloud artifacts docker images describe "$IMAGE_TAG" --project="$PROJECT_ID" --format='value(image_summary.digest)')"
    [[ "$digest" =~ ^sha256:[0-9a-f]{64}$ ]] || { echo 'Missing immutable image digest'; exit 1; }
    image="${IMAGE_TAG%:*}@${digest}"
    gcloud run services update "$SERVICE" "${common[@]}" --image="$image" \
      --revision-suffix="main-${GIT_SHA:0:7}-${BUILD_ID:0:8}" \
      --labels="smartsite-git-sha=$GIT_SHA" --no-traffic --tag=main-candidate
    # Inspect this revision, never the service's previously Ready revision.
    gcloud run revisions describe "$candidate" "${common[@]}" \
      --format='json(metadata.name,metadata.labels,status.conditions,status.imageDigest)' \
      > /workspace/.cloud-run-candidate.json
    ;;
  promote)
    resolve_gcloud_python
    # An older concurrent Main build must not overwrite the newer build's deployment.
    trigger="$(gcloud builds describe "$BUILD_ID" --project="$PROJECT_ID" --region="$REGION" --format='value(buildTriggerId)')"
    [[ -n "$trigger" ]] || { echo 'Automatic promotion requires the Main trigger'; exit 1; }
    latest="$(gcloud builds list --project="$PROJECT_ID" --region="$REGION" \
      --filter="trigger_id=$trigger" --sort-by='~createTime' --limit=1 --format='value(id)')"
    [[ "$latest" == "$BUILD_ID" ]] || { echo 'Superseded Main build: traffic was not changed'; exit 1; }
    url="$(gcloud run services describe "$SERVICE" "${common[@]}" --format='json(status.traffic)' |
      "$python_bin" -c 'import json,sys; rows=json.load(sys.stdin)["status"]["traffic"]; print(next(r["url"] for r in rows if r.get("tag")=="main-candidate" and r.get("revisionName")==sys.argv[1]))' "$candidate")"
    curl --fail --silent --show-error --connect-timeout 5 --max-time 20 \
      --retry 2 --retry-delay 2 "${url}/api/v1/health/ready" > /dev/null
    gcloud run services update-traffic "$SERVICE" "${common[@]}" --to-revisions="${candidate}=100"
    gcloud run services describe "$SERVICE" "${common[@]}" --format='json(status.traffic)' \
      > /workspace/.cloud-run-serving.json
    ;;
  *) echo 'Expected prepare or promote' >&2; exit 1 ;;
esac
