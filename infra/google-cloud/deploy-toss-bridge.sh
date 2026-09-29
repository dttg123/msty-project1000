#!/usr/bin/env bash
set -Eeuo pipefail

# One-time, interactive Google Cloud Shell deployment for the DividendOS
# read-only Toss bridge. Run from the repository root. Secret values are read
# without terminal echo and are sent directly to Secret Manager.

PROJECT_ID="${PROJECT_ID:-msty-project1000}"
REGION="${REGION:-asia-northeast3}"
SERVICE_NAME="${SERVICE_NAME:-dividend-os-toss-bridge}"
NETWORK_NAME="${NETWORK_NAME:-dividend-os-toss}"
SUBNET_NAME="${SUBNET_NAME:-dividend-os-toss-seoul}"
SUBNET_RANGE="${SUBNET_RANGE:-10.20.0.0/24}"
ROUTER_NAME="${ROUTER_NAME:-dividend-os-toss-router}"
NAT_NAME="${NAT_NAME:-dividend-os-toss-nat}"
ADDRESS_NAME="${ADDRESS_NAME:-dividend-os-toss-egress}"
RUNTIME_SERVICE_ACCOUNT="${RUNTIME_SERVICE_ACCOUNT:-dividend-os-toss-runtime}"
ALLOWED_ORIGIN="${ALLOWED_ORIGIN:-https://dttg123.github.io}"
FIREBASE_PROJECT_ID="${FIREBASE_PROJECT_ID:-msty-project1000}"

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/../.." && pwd)"

fail() {
  printf 'ERROR: %s\n' "$*" >&2
  exit 1
}

command -v gcloud >/dev/null 2>&1 || fail 'gcloud CLI가 필요합니다. Google Cloud Shell에서 실행하세요.'
command -v curl >/dev/null 2>&1 || fail 'curl이 필요합니다.'
[[ -f "${REPO_ROOT}/toss-bridge/Dockerfile" ]] || fail 'DividendOS 저장소 안에서 실행하세요.'

ACTIVE_ACCOUNT="$(gcloud auth list --filter=status:ACTIVE --format='value(account)' | head -n 1)"
[[ -n "${ACTIVE_ACCOUNT}" ]] || fail 'Google Cloud 로그인이 필요합니다.'

printf 'Project: %s\nRegion: %s\nAccount: %s\n' "${PROJECT_ID}" "${REGION}" "${ACTIVE_ACCOUNT}"
printf 'Cloud Run, Cloud NAT, 고정 외부 IP, Secret Manager 사용 요금이 발생할 수 있습니다.\n'
if [[ "${CONFIRM_CHARGES:-}" != 'DEPLOY' ]]; then
  read -r -p '계속하려면 DEPLOY를 입력하세요: ' CONFIRM_CHARGES
fi
[[ "${CONFIRM_CHARGES}" == 'DEPLOY' ]] || fail '배포를 취소했습니다.'

gcloud config set project "${PROJECT_ID}" >/dev/null
gcloud projects describe "${PROJECT_ID}" >/dev/null

read -r -p 'Firebase 사용자 UID: ' ALLOWED_FIREBASE_UID
[[ "${ALLOWED_FIREBASE_UID}" =~ ^[A-Za-z0-9_-]{1,128}$ ]] || fail 'Firebase UID 형식이 올바르지 않습니다.'
read -r -p 'Toss Client ID: ' TOSS_CLIENT_ID
[[ -n "${TOSS_CLIENT_ID}" && ${#TOSS_CLIENT_ID} -le 256 ]] || fail 'Toss Client ID를 확인하세요.'
read -r -s -p 'Toss Client Secret (화면에 표시되지 않음): ' TOSS_CLIENT_SECRET
printf '\n'
[[ -n "${TOSS_CLIENT_SECRET}" && ${#TOSS_CLIENT_SECRET} -le 512 ]] || fail 'Toss Client Secret을 확인하세요.'

printf '1/7 Google Cloud API 활성화\n'
gcloud services enable \
  run.googleapis.com \
  compute.googleapis.com \
  cloudbuild.googleapis.com \
  artifactregistry.googleapis.com \
  secretmanager.googleapis.com \
  --quiet

printf '2/7 전용 네트워크와 서브넷 준비\n'
if ! gcloud compute networks describe "${NETWORK_NAME}" >/dev/null 2>&1; then
  gcloud compute networks create "${NETWORK_NAME}" --subnet-mode=custom --quiet
fi
if ! gcloud compute networks subnets describe "${SUBNET_NAME}" --region="${REGION}" >/dev/null 2>&1; then
  gcloud compute networks subnets create "${SUBNET_NAME}" \
    --network="${NETWORK_NAME}" \
    --region="${REGION}" \
    --range="${SUBNET_RANGE}" \
    --enable-private-ip-google-access \
    --quiet
fi

printf '3/7 고정 출구 IP와 Cloud NAT 준비\n'
if ! gcloud compute addresses describe "${ADDRESS_NAME}" --region="${REGION}" >/dev/null 2>&1; then
  gcloud compute addresses create "${ADDRESS_NAME}" --region="${REGION}" --network-tier=PREMIUM --quiet
fi
STATIC_IP="$(gcloud compute addresses describe "${ADDRESS_NAME}" --region="${REGION}" --format='value(address)')"
[[ -n "${STATIC_IP}" ]] || fail '고정 IP를 확인하지 못했습니다.'
if ! gcloud compute routers describe "${ROUTER_NAME}" --region="${REGION}" >/dev/null 2>&1; then
  gcloud compute routers create "${ROUTER_NAME}" --network="${NETWORK_NAME}" --region="${REGION}" --quiet
fi
if ! gcloud compute routers nats describe "${NAT_NAME}" --router="${ROUTER_NAME}" --region="${REGION}" >/dev/null 2>&1; then
  gcloud compute routers nats create "${NAT_NAME}" \
    --router="${ROUTER_NAME}" \
    --region="${REGION}" \
    --nat-custom-subnet-ip-ranges="${SUBNET_NAME}" \
    --nat-external-ip-pool="${STATIC_IP}" \
    --enable-logging \
    --logging-filter=ERRORS_ONLY \
    --quiet
fi

printf '4/7 런타임 서비스 계정 준비\n'
RUNTIME_SA_EMAIL="${RUNTIME_SERVICE_ACCOUNT}@${PROJECT_ID}.iam.gserviceaccount.com"
if ! gcloud iam service-accounts describe "${RUNTIME_SA_EMAIL}" >/dev/null 2>&1; then
  gcloud iam service-accounts create "${RUNTIME_SERVICE_ACCOUNT}" \
    --display-name='DividendOS Toss read-only runtime' \
    --quiet
fi

printf '5/7 토스 키를 Secret Manager에 저장\n'
for SECRET_NAME in dividend-os-toss-client-id dividend-os-toss-client-secret; do
  if ! gcloud secrets describe "${SECRET_NAME}" >/dev/null 2>&1; then
    gcloud secrets create "${SECRET_NAME}" --replication-policy=automatic --quiet
  fi
  gcloud secrets add-iam-policy-binding "${SECRET_NAME}" \
    --member="serviceAccount:${RUNTIME_SA_EMAIL}" \
    --role='roles/secretmanager.secretAccessor' \
    --quiet >/dev/null
done
printf '%s' "${TOSS_CLIENT_ID}" | gcloud secrets versions add dividend-os-toss-client-id --data-file=- --quiet >/dev/null
printf '%s' "${TOSS_CLIENT_SECRET}" | gcloud secrets versions add dividend-os-toss-client-secret --data-file=- --quiet >/dev/null
unset TOSS_CLIENT_ID TOSS_CLIENT_SECRET

printf '6/7 Cloud Run 빌드 및 배포\n'
gcloud run deploy "${SERVICE_NAME}" \
  --source="${REPO_ROOT}/toss-bridge" \
  --region="${REGION}" \
  --service-account="${RUNTIME_SA_EMAIL}" \
  --network="${NETWORK_NAME}" \
  --subnet="${SUBNET_NAME}" \
  --vpc-egress=all-traffic \
  --allow-unauthenticated \
  --ingress=all \
  --port=8080 \
  --cpu=1 \
  --memory=256Mi \
  --concurrency=20 \
  --min-instances=0 \
  --max-instances=2 \
  --timeout=60s \
  --set-env-vars="FIREBASE_PROJECT_ID=${FIREBASE_PROJECT_ID},ALLOWED_FIREBASE_UID=${ALLOWED_FIREBASE_UID},ALLOWED_ORIGIN=${ALLOWED_ORIGIN},TOSS_DEFAULT_FROM=2020-01-01" \
  --set-secrets='TOSS_CLIENT_ID=dividend-os-toss-client-id:latest,TOSS_CLIENT_SECRET=dividend-os-toss-client-secret:latest' \
  --quiet

printf '7/7 읽기 전용 상태 확인\n'
SERVICE_URL="$(gcloud run services describe "${SERVICE_NAME}" --region="${REGION}" --format='value(status.url)')"
[[ "${SERVICE_URL}" == https://* ]] || fail 'Cloud Run HTTPS 주소를 확인하지 못했습니다.'
HEALTH="$(curl --fail --silent --show-error "${SERVICE_URL}/health")"
[[ "${HEALTH}" == *'"mode":"read-only"'* && "${HEALTH}" == *'"ordersEnabled":false'* ]] || fail '읽기 전용 상태 확인에 실패했습니다.'

printf '\n배포 완료\n'
printf 'TOSS_BRIDGE_URL=%s\n' "${SERVICE_URL}"
printf 'TOSS_ALLOWLIST_IP=%s\n' "${STATIC_IP}"
printf '위 두 값만 복사하세요. 토스 Client ID/Secret은 복사하거나 채팅에 보내지 마세요.\n'
