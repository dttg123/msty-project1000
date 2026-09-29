#!/usr/bin/env bash
set -Eeuo pipefail
umask 077

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/../.." && pwd)"
FROM_DATE="${1:-2020-01-01}"

fail() {
  printf 'ERROR: %s\n' "$*" >&2
  exit 1
}

command -v node >/dev/null 2>&1 || fail 'Node.js가 필요합니다.'
command -v curl >/dev/null 2>&1 || fail 'curl이 필요합니다.'
[[ "${FROM_DATE}" =~ ^[0-9]{4}-[0-9]{2}-[0-9]{2}$ ]] || fail '시작일은 YYYY-MM-DD 형식이어야 합니다.'

PUBLIC_IP="$(curl --fail --silent --show-error --max-time 10 https://api.ipify.org)"
[[ "${PUBLIC_IP}" =~ ^[0-9]{1,3}(\.[0-9]{1,3}){3}$ ]] || fail '현재 공인 IP를 확인하지 못했습니다.'

printf '\n현재 조회 IP: %s\n' "${PUBLIC_IP}"
printf '토스증권 Open API 설정에 이 IP를 등록한 뒤 계속하세요.\n'
read -r -p '등록을 마쳤으면 REGISTERED 입력: ' CONFIRM_IP
[[ "${CONFIRM_IP}" == 'REGISTERED' ]] || fail '조회 전 중단했습니다.'

read -r -p 'Toss Client ID: ' TOSS_CLIENT_ID
[[ -n "${TOSS_CLIENT_ID}" && ${#TOSS_CLIENT_ID} -le 256 ]] || fail 'Toss Client ID를 확인하세요.'
read -r -s -p 'Toss Client Secret (화면에 표시되지 않음): ' TOSS_CLIENT_SECRET
printf '\n'
[[ -n "${TOSS_CLIENT_SECRET}" && ${#TOSS_CLIENT_SECRET} -le 512 ]] || fail 'Toss Client Secret을 확인하세요.'
trap 'unset TOSS_CLIENT_ID TOSS_CLIENT_SECRET' EXIT

OUTPUT_NAME="DividendOS_Toss_$(date -u +%Y%m%dT%H%M%SZ).json"
TOSS_CLIENT_ID="${TOSS_CLIENT_ID}" \
TOSS_CLIENT_SECRET="${TOSS_CLIENT_SECRET}" \
TOSS_DEFAULT_FROM="${FROM_DATE}" \
node "${REPO_ROOT}/toss-bridge/export-snapshot.mjs" "${OUTPUT_NAME}"

unset TOSS_CLIENT_ID TOSS_CLIENT_SECRET
printf '\n완료: %s\n' "${OUTPUT_NAME}"
printf 'Cloud Shell 파일 메뉴에서 이 JSON만 다운로드해 DividendOS에 불러오세요.\n'
printf '불러온 뒤 Cloud Shell에서 rm %q 로 삭제하세요.\n' "${OUTPUT_NAME}"
printf '현재 등록 IP: %s\n' "${PUBLIC_IP}"
