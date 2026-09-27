# DividendOS 0단계 기준점

- 확인일: 2026-09-28 KST
- 실제 저장소: `dttg123/msty-project1000`
- 기준 브랜치: `main`
- 기준 커밋: `573d1543acd82588efa9657dcaf46f1ee095c1c5`
- 기준 릴리스: `DividendOS v0.12.7-r64`
- 라이브 경로: `https://dttg123.github.io/msty-project1000/v4/`
- 원본과 `origin/main`: 일치
- 작업 시작 시 사용자 변경: 없음
- 저장 스키마: V4, portable backup schema 4
- Service Worker 캐시: `dividend-os-v0.12.7-r64`

## 기준선 검증

- 기존 Node 테스트 전체 통과
- 30년 개별 입력 시뮬레이션: 8,166건
- 35년 강화 시뮬레이션: 607개 검사
- ZIP 백업 생성·복원 왕복 및 CRC 손상 감지 통과
- 라이브 HTML의 버전·자산 쿼리와 저장소 원본 일치
- QA 저장소는 `?demo=1`에서 별도 DB를 사용하며 운영 DB와 분리
- Firebase 웹 API 키는 공개 클라이언트 설정이므로 정확히 `v4/firebase.js`만 비밀키
  탐지 예외다. 데이터 보호는 Firebase Auth와 Firestore 규칙으로 검증해야 한다.

## 배포 전 차단 위험

기준 버전의 `v4/toss-client.js`에는 Client ID와 Client Secret을 브라우저
`localStorage`에 저장하는 직접 연결 호환 경로가 있었다. 실제 비밀값이 저장소에
커밋된 것은 확인되지 않았다. 2단계 변경에서 서버 중계 방식만 남겼으며, 새 앱이
시작될 때 기존 브라우저 저장값을 내용 확인 없이 삭제한다.

## 복구선

1. 소스 복구: 위 기준 커밋으로 되돌린다.
2. 데이터 복구: 변경 전 앱에서 생성한 portable ZIP을 사용한다.
3. 캐시 복구: 기준 Service Worker 캐시 버전과 배포 파일을 함께 복구한다.
4. 저장 스키마를 바꾸는 후속 단계에서는 구형 V4 JSON 읽기 호환을 유지한다.

## 후속 제품 결정

6단계에서 PROJECT1000 전용 명칭과 기본 가정을 제거하고 제품명을 DividendOS로
통일한다. 기존 MSTY·1000주 기록은 삭제하지 않고 일반 종목·사용자 목표 데이터로
마이그레이션한다.
