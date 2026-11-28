-- 가상 ERP 데이터 초기화: 품목 · 거래처만 남기고 발주 · 수주 · MES 수신 문서는 비움 (수동 실행 전용)
-- 발주 · 수주는 erp.cloudheat.kr 화면에서 직접 입력
SET search_path = erp;

BEGIN;

TRUNCATE mes_document, goods_receipt, production_result, goods_issue, purchase_order, sales_order RESTART IDENTITY CASCADE;
DELETE FROM item;
DELETE FROM partner;
DELETE FROM code_group;
ALTER SEQUENCE doc_seq RESTART;

INSERT INTO code_group (group_code, group_name, remark, sort_no) VALUES
    ('PO_TYPE',      '발주구분',   '발주등록 과세 · 영세 구분', 1),
    ('SO_TYPE',      '주문구분',   '주문등록 과세 · 영세 구분', 2),
    ('CURRENCY',     '통화',       '거래 통화 코드',           3),
    ('ITEM_TYPE',    '품목구분',   '품목 자산 분류',           4),
    ('PARTNER_TYPE', '거래처구분', '매입 · 매출 거래처 구분',  5),
    ('UNIT',         '단위',       '재고 · 거래 계량 단위',    6),
    ('WH_TYPE',      '창고구분',   '창고 용도 구분',           7);

INSERT INTO common_code (group_code, code, code_name, sort_no, remark) VALUES
    ('PO_TYPE',      '0',      '국내발주', 1, '부가세 10% (소수점 버림)'),
    ('PO_TYPE',      '1',      '수입영세', 2, '부가세 0%'),
    ('SO_TYPE',      '0',      '국내주문', 1, '부가세 10% (소수점 버림)'),
    ('SO_TYPE',      '1',      '수출영세', 2, '부가세 0%'),
    ('CURRENCY',     'KRW',    '원화',     1, '기본 통화 (환율 1)'),
    ('CURRENCY',     'USD',    '미국 달러', 2, ''),
    ('CURRENCY',     'EUR',    '유로',     3, ''),
    ('CURRENCY',     'JPY',    '일본 엔',  4, ''),
    ('CURRENCY',     'CNY',    '중국 위안', 5, ''),
    ('ITEM_TYPE',    '제품',   '제품',     1, '완제품'),
    ('ITEM_TYPE',    '원자재', '원자재',   2, '원부자재'),
    ('PARTNER_TYPE', '매입처', '매입처',   1, '자재 구매처'),
    ('PARTNER_TYPE', '매출처', '매출처',   2, '제품 고객사'),
    ('UNIT',         'EA',     'EA',       1, '개'),
    ('UNIT',         'KG',     'KG',       2, '킬로그램'),
    ('UNIT',         'L',      'L',        3, '리터'),
    ('WH_TYPE',      '원자재', '원자재',   1, '원자재 보관 창고'),
    ('WH_TYPE',      '현장',   '현장',     2, '공정 중 재공 창고'),
    ('WH_TYPE',      '제품',   '제품',     3, '완제품 보관 창고'),
    ('WH_TYPE',      '일반',   '일반',     4, '일반 창고');

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
