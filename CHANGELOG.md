# 변경 기록

버전 규칙 (SemVer): `MAJOR.MINOR.PATCH`
- **PATCH** 버그 수정 · 문구 수정 → `.\deploy.cmd -Bump patch`
- **MINOR** 화면 · 기능 추가 → `.\deploy.cmd -Bump minor`
- **MAJOR** 큰 구조 변경 · 1.0 정식 → `.\deploy.cmd -Bump major`

새 버전을 올리기 전에 아래 `다음 버전`에 바뀐 내용을 적고 커밋하세요.

## 다음 버전
-

## 0.1.0 — 2026-11-25
첫 버전.

- **포트폴리오** (cloudheat.kr): 경력 · ERP 연동 MES 경험 · 보유 스킬 · Claude 바이브코딩 소개
- **MES 웹** (mes.cloudheat.kr): React · React Router · AG Grid
  - 대시보드, 발주관리 · 주문관리(ERP 수신), 작업지시관리, 현재고조회, 재고수불조회, ERP 연동 모니터링
  - 입고 · 출고 · 재고이동 · 재고조정 · 기초재고 · 기준정보 화면은 준비 중
  - 표에서 Ctrl+C 셀 복사, Ctrl+Shift+C 행 복사
- **MES API**: ASP.NET Core (.NET 10) · Dapper · PostgreSQL 16
  - 재고 반영 함수(마이너스 재고 방지), 공정별 실적 · 불량 유형 윈도 함수
  - ERP 수신(1분 증분) · 송신(Transactional Outbox, 재시도 · 수동 재전송)
- **가상 ERP**: 별도 서비스 · DB 계정 · API 키, 일부러 15% 장애 · 5% 지연
- **서버**: Ubuntu · Caddy(자동 HTTPS) · systemd, 배포 스크립트(헬스체크 · 자동 롤백)
