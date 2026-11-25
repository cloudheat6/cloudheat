# cloudheat

포트폴리오(cloudheat.kr) + ERP 연동 MES 웹 데모(mes.cloudheat.kr). 한 대의 Ubuntu VM 에서 동작.

```
cloudheat.kr      ─ Caddy ─ /var/www/cloudheat/current            (site: React 포트폴리오)
mes.cloudheat.kr  ─ Caddy ─┬ /api/* → MES API  127.0.0.1:5080 ─┐  (api: ASP.NET Core)
                           └ 그 외  → /var/www/cloudheat-mes/current (mes-web: React + AG Grid)
                                                                 │ HTTP + API 키
                                       가상 ERP 127.0.0.1:5090 ◀─┘  (mock-erp: ASP.NET Core)
                     PostgreSQL 16: 스키마 mes (MES API 계정) / erp (가상 ERP 계정)
```

## 폴더
| 경로 | 내용 |
|---|---|
| `site/` | 포트폴리오 (React · Vite) |
| `mes-web/` | MES 웹 (React Router · AG Grid). 화면: `src/pages/` |
| `api/` | MES API (ASP.NET Core · Dapper · Npgsql). ERP 연동: `api/Erp/` |
| `api/db/` | `mes` 스키마 · 초기 데이터 (작업지시 · 품목 · 창고 · 기초재고) |
| `mock-erp/` | 가상 ERP 서버 + `erp` 스키마 · 초기 데이터 (발주 · 수주) |
| `deploy/` | 서버 설정 · 배포 스크립트, Caddyfile |

## ERP 연동 구조
- **ERP → MES 수신**: MES API 가 1분마다 가상 ERP 의 발주 · 수주를 `updated_at` 기준 증분으로 가져와 `mes.purchase_order` · `mes.sales_order` 에 반영. 결과는 `mes.erp_sync_log`.
  MES 품목 마스터에 없는 품목이 있으면 그 문서만 건너뜀 (데모: `PO-xxxx-0011` 의 가스켓)
- **MES → ERP 송신 (Transactional Outbox)**: 생산 실적 저장과 같은 트랜잭션에서 `mes.erp_outbox` 에 기록 →
  백그라운드가 3초마다 전송. 일시 장애는 5·10·20·40초 후 재시도, 5회 실패 · 검증 오류는 `실패` → 화면에서 재전송.
  ERP 는 `docNo` 로 중복 수신을 막음 (멱등)
- 가상 ERP 는 일부러 15% 일시 장애(503), 5% 응답 지연(타임아웃)을 냄
- 실제 더존 Amaranth 10 / iCUBE 규격이 아닌 범용 JSON API

## 개발
```powershell
cd mes-web; npm install; npm run dev     # http://localhost:5173 (/api 는 서버로 프록시)
cd site;    npm install; npm run dev
dotnet build api; dotnet build mock-erp
```

## 서버 설정 (처음 · 스키마나 서비스 구성을 바꿨을 때)
`setup-server.cmd` — sudo 비밀번호 1회. 여러 번 실행해도 안전 (DB 비밀번호 · 연동 키는 유지)

## 배포
```powershell
.\deploy.cmd                 # 전체: 가상 ERP → MES API → MES 화면 → 포트폴리오
.\deploy.cmd -Mes            # MES 화면만 (-Site / -Api / -Erp, 여러 개 조합 가능)
.\deploy.cmd -List           # 서버 버전 목록
.\deploy.cmd -Rollback -Api  # 이전 버전으로 (선택 안 하면 전체)
.\deploy.cmd -ResetData      # MES · 가상 ERP 데이터를 초기 가상 데이터로 되돌림 (수동 실행할 때만)
```
서비스는 재시작 후 헬스체크, 실패하면 이전 버전으로 자동 되돌림. 내부망 확인: `http://192.168.0.10:8080` (MES)

## 버전 · Git
- 저장소: https://github.com/cloudheat6/cloudheat
- 버전은 루트 `VERSION` 하나로 관리 (SemVer). 화면 사이드바 · `/api/health` 에 `v0.1.0 · 커밋` 으로 표시
- 평소: 작업 → `git commit` → `.\deploy.cmd` (버전 그대로, 커밋 번호만 바뀜)
- 릴리스: `CHANGELOG.md` 정리 · 커밋 → `.\deploy.cmd -Bump minor` (patch / minor / major)
  → VERSION · package.json 올림 → 커밋 `release: vX.Y.Z` + 태그 → 배포 → GitHub push
- 비밀번호 · 키는 저장소에 넣지 않음 (서버 `/etc/cloudheat/*.env` 에만 있음)
