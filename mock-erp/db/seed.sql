-- 가상 ERP 데이터 초기화: 품목 · 거래처만 남기고 발주 · 수주 · MES 수신 문서는 비움 (수동 실행 전용)
-- 발주 · 수주는 erp.cloudheat.kr 화면에서 직접 입력
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
    ('RM-GSK-30', '가스켓 30', '원자재', 'EA');

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

COMMIT;

SELECT (SELECT count(*) FROM item)    AS items,
       (SELECT count(*) FROM partner) AS partners;
