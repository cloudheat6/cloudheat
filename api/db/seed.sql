-- MES 데이터 초기화: 기준정보만 남기고 거래 데이터(작업지시 · 재고 · 발주 · 주문 · 연동 이력)는 비움
-- 수동 실행 전용 (deploy.cmd -ResetData). 기초재고는 기초재고관리 화면에서 직접 등록
SET search_path = mes;

BEGIN;

-- ── 기준정보 (UPSERT: MSSQL 의 MERGE 대신 ON CONFLICT) ──
INSERT INTO line (line_id, line_name) VALUES
    (1, 'L1 프레스'), (2, 'L2 용접'), (3, 'L3 도장'), (4, 'L4 조립')
ON CONFLICT (line_id) DO UPDATE SET line_name = EXCLUDED.line_name;

INSERT INTO item (item_code, item_name, line_id) VALUES
    ('BRK-A100', '브래킷 A100', 1),
    ('PLT-F080', '플레이트 F80', 1),
    ('FRM-D450', '프레임 D450', 2),
    ('SFT-E120', '샤프트 E120', 2),
    ('HSG-B220', '하우징 B220', 3),
    ('CVR-C310', '커버 C310', 3),
    ('ASM-M500', '모듈 어셈블리 M500', 4),
    ('ASM-K210', '키트 어셈블리 K210', 4)
ON CONFLICT (item_code) DO UPDATE SET item_name = EXCLUDED.item_name, line_id = EXCLUDED.line_id;

-- 원자재 (가스켓 RM-GSK-30 은 일부러 ERP 에만 있음 → 수신 시 'MES 품목 미등록' 사례)
INSERT INTO item (item_code, item_name, line_id, item_type, unit) VALUES
    ('RM-SPC-10', '강판 SPCC 1.0t',     NULL, '원자재', 'KG'),
    ('RM-SPH-20', '강판 SPHC 2.0t',     NULL, '원자재', 'KG'),
    ('RM-BLT-M8', '볼트 M8',            NULL, '원자재', 'EA'),
    ('RM-NUT-M8', '너트 M8',            NULL, '원자재', 'EA'),
    ('RM-WIR-12', '용접 와이어 1.2mm',  NULL, '원자재', 'KG'),
    ('RM-PNT-GY', '도료 회색',          NULL, '원자재', 'L'),
    ('RM-PNT-BK', '도료 흑색',          NULL, '원자재', 'L'),
    ('RM-PKG-BX', '포장 박스',          NULL, '원자재', 'EA')
ON CONFLICT (item_code) DO UPDATE
    SET item_name = EXCLUDED.item_name, line_id = EXCLUDED.line_id,
        item_type = EXCLUDED.item_type, unit = EXCLUDED.unit;

INSERT INTO warehouse (wh_code, wh_name) VALUES
    ('WH-RM', '원자재창고'), ('WH-WIP', '현장창고'), ('WH-FG', '제품창고')
ON CONFLICT (wh_code) DO UPDATE SET wh_name = EXCLUDED.wh_name;

-- 처음 설치할 때: 창고 구분 · 품목 기본 창고 (이미 정한 값은 유지)
UPDATE warehouse SET wh_type = CASE wh_code WHEN 'WH-RM' THEN '원자재' WHEN 'WH-WIP' THEN '현장' ELSE '제품' END
WHERE wh_code IN ('WH-RM', 'WH-WIP', 'WH-FG') AND wh_type = '일반';
UPDATE item SET default_wh_code = CASE WHEN item_type = '원자재' THEN 'WH-RM' ELSE 'WH-FG' END
WHERE default_wh_code IS NULL;

INSERT INTO worker (worker_id, worker_name) VALUES
    (1, '김민준'), (2, '이서연'), (3, '박지훈'), (4, '최유진'),
    (5, '정하늘'), (6, '강도윤'), (7, '윤채원'), (8, '임태오')
ON CONFLICT (worker_id) DO UPDATE SET worker_name = EXCLUDED.worker_name;

INSERT INTO routing_step (line_id, seq, step_name) VALUES
    (1, 1, '자재 투입'), (1, 2, '블랭킹'), (1, 3, '프레스 성형'), (1, 4, '외관 검사'),
    (2, 1, '자재 투입'), (2, 2, '스폿 용접'), (2, 3, 'CO2 용접'), (2, 4, '치수 검사'),
    (3, 1, '전처리'), (3, 2, '하도'), (3, 3, '상도'), (3, 4, '건조'), (3, 5, '도막 검사'),
    (4, 1, '부품 키팅'), (4, 2, '서브 조립'), (4, 3, '메인 조립'), (4, 4, '기능 검사'), (4, 5, '포장')
ON CONFLICT (line_id, seq) DO UPDATE SET step_name = EXCLUDED.step_name;

INSERT INTO defect_type (defect_type_id, line_id, defect_name) VALUES
    (11, 1, '치수 불량'), (12, 1, '버(Burr) 발생'), (13, 1, '외관 스크래치'), (14, 1, '크랙'),
    (21, 2, '용접 불량'), (22, 2, '비드 불균일'), (23, 2, '치수 불량'), (24, 2, '스패터'),
    (31, 3, '도막 불량'), (32, 3, '흐름 자국'), (33, 3, '이물 혼입'), (34, 3, '색차'),
    (41, 4, '조립 누락'), (42, 4, '체결 불량'), (43, 4, '기능 불량'), (44, 4, '외관 스크래치')
ON CONFLICT (defect_type_id) DO UPDATE SET line_id = EXCLUDED.line_id, defect_name = EXCLUDED.defect_name;

-- ── 거래 데이터 비우기 ─────────────────────────────────
-- 작업지시(+ 공정 · 불량 가중치), 재고 · 수불, 발주 · 주문 사본, ERP 송수신 이력
-- 수신 기준 시각도 비워서 ERP 의 공통코드 · 품목 · 거래처 · 발주 · 주문을 처음부터 다시 받게 함
DELETE FROM code_group
WHERE group_code NOT IN ('PO_TYPE', 'SO_TYPE', 'CURRENCY', 'ITEM_TYPE', 'PARTNER_TYPE', 'UNIT', 'WH_TYPE');
TRUNCATE work_order, stock, stock_tx, erp_outbox, erp_sync_log, erp_sync_cursor, purchase_order, sales_order
    RESTART IDENTITY CASCADE;
ALTER SEQUENCE doc_seq RESTART;

COMMIT;

SELECT (SELECT count(*) FROM item)       AS items,
       (SELECT count(*) FROM work_order) AS work_orders,
       (SELECT count(*) FROM stock)      AS stock_rows;
