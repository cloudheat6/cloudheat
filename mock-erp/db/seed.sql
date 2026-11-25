-- 가상 ERP 데이터 초기화 (매일 04:00 KST, MES 초기화와 함께 실행)
SET search_path = erp;

BEGIN;

TRUNCATE mes_document, purchase_order, sales_order RESTART IDENTITY CASCADE;
DELETE FROM item;
DELETE FROM partner;
ALTER SEQUENCE doc_seq RESTART;

INSERT INTO item (item_code, item_name, item_type, unit) VALUES
    ('BRK-A100', '브래킷 A100', '제품', 'EA'),
    ('PLT-F080', '플레이트 F80', '제품', 'EA'),
    ('FRM-D450', '프레임 D450', '제품', 'EA'),
    ('SFT-E120', '샤프트 E120', '제품', 'EA'),
    ('HSG-B220', '하우징 B220', '제품', 'EA'),
    ('CVR-C310', '커버 C310', '제품', 'EA'),
    ('ASM-M500', '모듈 어셈블리 M500', '제품', 'EA'),
    ('ASM-K210', '키트 어셈블리 K210', '제품', 'EA'),
    ('RM-SPC-10', '강판 SPCC 1.0t', '원자재', 'KG'),
    ('RM-SPH-20', '강판 SPHC 2.0t', '원자재', 'KG'),
    ('RM-BLT-M8', '볼트 M8', '원자재', 'EA'),
    ('RM-NUT-M8', '너트 M8', '원자재', 'EA'),
    ('RM-WIR-12', '용접 와이어 1.2mm', '원자재', 'KG'),
    ('RM-PNT-GY', '도료 회색', '원자재', 'L'),
    ('RM-PNT-BK', '도료 흑색', '원자재', 'L'),
    ('RM-PKG-BX', '포장 박스', '원자재', 'EA'),
    ('RM-GSK-30', '가스켓 30 (ERP 신규 등록)', '원자재', 'EA');   -- MES 에는 아직 없음

INSERT INTO partner (partner_code, partner_name, partner_type) VALUES
    ('V001', '(주)한빛철강', '매입처'),
    ('V002', '대성볼트', '매입처'),
    ('V003', '세진도료', '매입처'),
    ('V004', '국제용접재', '매입처'),
    ('V005', '우진포장', '매입처'),
    ('C001', '가온모터스', '매출처'),
    ('C002', '태성산업', '매출처'),
    ('C003', '미래전자', '매출처'),
    ('C004', '한결기계', '매출처');

SELECT setseed(0.1125);

-- 발주 14건: 매입처별 취급 품목에서 1~3개 라인
INSERT INTO purchase_order (po_no, po_date, partner_code, due_date, updated_at)
SELECT 'PO-' || to_char(current_date, 'YYMM') || '-' || lpad(n::text, 4, '0'),
       current_date - (14 - n),
       (ARRAY['V001','V002','V003','V004','V005'])[1 + (n % 5)],
       current_date - (14 - n) + 7,
       now() - make_interval(mins => (14 - n) * 37)
FROM generate_series(1, 14) AS n;

INSERT INTO purchase_order_line (po_no, line_no, item_code, qty, unit_price)
SELECT po.po_no, l.line_no, l.item_code,
       (ceil(random() * 20) * 50)::integer,
       round((500 + random() * 9500)::numeric, -1)
FROM purchase_order po
CROSS JOIN LATERAL (
    SELECT row_number() OVER ()::smallint AS line_no, x.item_code
    FROM (
        SELECT unnest(CASE po.partner_code
                   WHEN 'V001' THEN ARRAY['RM-SPC-10', 'RM-SPH-20']
                   WHEN 'V002' THEN ARRAY['RM-BLT-M8', 'RM-NUT-M8', 'RM-GSK-30']
                   WHEN 'V003' THEN ARRAY['RM-PNT-GY', 'RM-PNT-BK']
                   WHEN 'V004' THEN ARRAY['RM-WIR-12']
                   ELSE ARRAY['RM-PKG-BX'] END) AS item_code
    ) x
    -- 가스켓(RM-GSK-30)은 PO-xxxx-0011 한 건에만 포함 → MES 수신 시 '품목 미등록' 사례
    WHERE x.item_code <> 'RM-GSK-30' OR po.po_no LIKE '%-0011'
) l;

-- 수주 10건: 제품 1~3개 라인
INSERT INTO sales_order (so_no, so_date, partner_code, due_date, updated_at)
SELECT 'SO-' || to_char(current_date, 'YYMM') || '-' || lpad(n::text, 4, '0'),
       current_date - (10 - n),
       (ARRAY['C001','C002','C003','C004'])[1 + (n % 4)],
       current_date - (10 - n) + 10,
       now() - make_interval(mins => (10 - n) * 53)
FROM generate_series(1, 10) AS n;

INSERT INTO sales_order_line (so_no, line_no, item_code, qty, unit_price)
SELECT so.so_no, row_number() OVER (PARTITION BY so.so_no ORDER BY p.item_code)::smallint,
       p.item_code,
       (ceil(random() * 12) * 10)::integer,
       round((8000 + random() * 42000)::numeric, -2)
FROM sales_order so
CROSS JOIN LATERAL (
    SELECT i.item_code FROM item i
    WHERE i.item_type = '제품'
    ORDER BY md5(so.so_no || i.item_code)
    LIMIT 1 + (ascii(right(so.so_no, 1)) % 3)
) p;

COMMIT;

SELECT (SELECT count(*) FROM purchase_order) AS purchase_orders,
       (SELECT count(*) FROM sales_order)    AS sales_orders;
