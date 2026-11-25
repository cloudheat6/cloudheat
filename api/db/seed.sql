-- MES 데모 데이터 초기화 (가상 데이터)
-- 서버에서 매일 04:00 에 실행돼서 방문자가 수정한 내용을 되돌립니다.
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

-- ── 작업지시 240건 재생성 ───────────────────────────────
TRUNCATE work_order RESTART IDENTITY CASCADE;

SELECT setseed(0.20261125);   -- 시드 고정: 매번 같은 패턴, 날짜만 오늘 기준

INSERT INTO work_order (wo_no, due_date, item_code, worker_id, plan_qty, prod_qty, defect_qty)
SELECT 'WO-' || to_char(current_date, 'YYMM') || '-' || lpad(p.n::text, 4, '0'),
       current_date + p.day_offset,
       p.item_code,
       p.worker_id,
       p.plan_qty,
       p.prod_qty,
       LEAST(p.prod_qty, round(p.prod_qty * p.defect_rate))::integer
FROM (
    SELECT r.n, r.day_offset, r.item_code, r.worker_id, r.plan_qty,
           CASE
               WHEN prog.progress >= 1 THEN r.plan_qty
               ELSE round(r.plan_qty * prog.progress)::integer
           END AS prod_qty,
           CASE WHEN r.r3 < 0.15 THEN 0.02 + r.r4 * 0.05 ELSE r.r4 * 0.015 END AS defect_rate
    FROM (
        SELECT g.n,
               (floor(random() * 21) - 12)::integer AS day_offset,          -- 납기: 12일 전 ~ 8일 후
               (ARRAY['BRK-A100','PLT-F080','FRM-D450','SFT-E120',
                      'HSG-B220','CVR-C310','ASM-M500','ASM-K210'])[1 + floor(random() * 8)::integer] AS item_code,
               (1 + floor(random() * 8))::smallint AS worker_id,
               (round((200 + random() * 1800) / 10) * 10)::integer AS plan_qty,
               random() AS r1, random() AS r2, random() AS r3, random() AS r4
        FROM generate_series(1, 240) AS g(n)
        OFFSET 0   -- random() 이 행마다 한 번만 평가되도록 서브쿼리 고정
    ) r
    CROSS JOIN LATERAL (
        SELECT CASE
                   WHEN r.day_offset < -3 THEN CASE WHEN r.r1 < 0.80 THEN 1 ELSE 0.60 + r.r2 * 0.35 END
                   WHEN r.day_offset <  0 THEN CASE WHEN r.r1 < 0.50 THEN 1 ELSE 0.30 + r.r2 * 0.60 END
                   WHEN r.day_offset <  4 THEN CASE WHEN r.r1 < 0.25 THEN 0 ELSE 0.10 + r.r2 * 0.85 END
                   ELSE                        CASE WHEN r.r1 < 0.60 THEN 0 ELSE r.r2 * 0.40 END
               END AS progress
    ) prog
) p
ORDER BY p.n;

-- 공정별 손실 가중치
INSERT INTO wo_process_weight (wo_id, seq, weight)
SELECT w.wo_id, rs.seq, round((0.2 + random())::numeric, 3)
FROM work_order w
JOIN item i          ON i.item_code = w.item_code
JOIN routing_step rs ON rs.line_id  = i.line_id
ORDER BY w.wo_id, rs.seq;

-- 불량 유형: 라인별 4개 중 3개를 골라 가중치 부여
INSERT INTO wo_defect_weight (wo_id, defect_type_id, weight)
SELECT x.wo_id, x.defect_type_id, x.weight
FROM (
    SELECT w.wo_id,
           dt.defect_type_id,
           round((0.1 + random())::numeric, 3) AS weight,
           row_number() OVER (PARTITION BY w.wo_id ORDER BY random()) AS rn
    FROM work_order w
    JOIN item i         ON i.item_code = w.item_code
    JOIN defect_type dt ON dt.line_id  = i.line_id
) x
WHERE x.rn <= 3;

-- ── 재고 · ERP 연동 데이터 초기화 ─────────────────────────
TRUNCATE stock, stock_tx, erp_outbox, erp_sync_log, erp_sync_cursor, purchase_order, sales_order
    RESTART IDENTITY CASCADE;

-- 기초재고: 원자재 → 원자재창고, 제품 → 제품창고
SELECT count(*) AS opening_stock
FROM (
    SELECT fn_post_stock(
               '기초', i.item_code,
               CASE WHEN i.item_type = '원자재' THEN 'WH-RM' ELSE 'WH-FG' END,
               CASE WHEN i.item_type = '원자재' THEN 500 + floor(random() * 4500)
                    ELSE 50 + floor(random() * 450) END::integer,
               '기초재고', 'OPEN-' || to_char(current_date, 'YYMM'), '데모 기초재고')
    FROM item i
    ORDER BY i.item_code
) x;

COMMIT;

SELECT count(*) AS work_orders FROM work_order;
