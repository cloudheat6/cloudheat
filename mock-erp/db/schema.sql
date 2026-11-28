-- 가상 ERP 스키마 (MES 와 분리된 별도 시스템이라고 가정)
-- 실제 더존 Amaranth 10 / iCUBE 규격이 아닌 범용 구조입니다.
CREATE SCHEMA IF NOT EXISTS erp;
SET search_path = erp;

CREATE TABLE IF NOT EXISTS item (
    item_code  varchar(20) PRIMARY KEY,
    item_name  varchar(50) NOT NULL,
    item_type  varchar(10) NOT NULL,
    unit       varchar(10) NOT NULL
);

CREATE TABLE IF NOT EXISTS partner (
    partner_code  varchar(10) PRIMARY KEY,
    partner_name  varchar(50) NOT NULL,
    partner_type  varchar(20) NOT NULL
);
ALTER TABLE partner DROP CONSTRAINT IF EXISTS partner_partner_type_check;
ALTER TABLE partner ALTER COLUMN partner_type TYPE varchar(20);

-- 관리내역 (공통코드 분류 · 상세): 발주구분 · 주문구분 · 통화 · 품목구분 · 거래처구분 · 단위 · 창고구분 등
CREATE TABLE IF NOT EXISTS code_group (
    group_code  varchar(20)  PRIMARY KEY,
    group_name  varchar(50)  NOT NULL,
    remark      varchar(200) NOT NULL DEFAULT '',
    use_yn      boolean      NOT NULL DEFAULT true,
    sort_no     smallint     NOT NULL DEFAULT 0,
    updated_at  timestamptz  NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS ix_code_group_updated ON code_group (updated_at);

CREATE TABLE IF NOT EXISTS common_code (
    group_code  varchar(20)  NOT NULL REFERENCES code_group ON DELETE CASCADE,
    code        varchar(20)  NOT NULL,
    code_name   varchar(50)  NOT NULL,
    sort_no     smallint     NOT NULL DEFAULT 0,
    use_yn      boolean      NOT NULL DEFAULT true,
    remark      varchar(200) NOT NULL DEFAULT '',
    updated_at  timestamptz  NOT NULL DEFAULT now(),
    PRIMARY KEY (group_code, code)
);
CREATE INDEX IF NOT EXISTS ix_common_code_updated ON common_code (updated_at);

-- 발주
CREATE TABLE IF NOT EXISTS purchase_order (
    po_no         varchar(20) PRIMARY KEY,
    po_date       date        NOT NULL,
    partner_code  varchar(10) NOT NULL REFERENCES partner,
    due_date      date        NOT NULL,
    status        varchar(10) NOT NULL DEFAULT '확정',
    updated_at    timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS purchase_order_line (
    po_no       varchar(20)   NOT NULL REFERENCES purchase_order ON DELETE CASCADE,
    line_no     smallint      NOT NULL,
    item_code   varchar(20)   NOT NULL REFERENCES item,
    qty         integer       NOT NULL CHECK (qty > 0),
    unit_price  numeric(12,2) NOT NULL,
    PRIMARY KEY (po_no, line_no)
);
CREATE INDEX IF NOT EXISTS ix_po_updated ON purchase_order (updated_at);

-- 수주
CREATE TABLE IF NOT EXISTS sales_order (
    so_no         varchar(20) PRIMARY KEY,
    so_date       date        NOT NULL,
    partner_code  varchar(10) NOT NULL REFERENCES partner,
    due_date      date        NOT NULL,
    status        varchar(10) NOT NULL DEFAULT '확정',
    updated_at    timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS sales_order_line (
    so_no       varchar(20)   NOT NULL REFERENCES sales_order ON DELETE CASCADE,
    line_no     smallint      NOT NULL,
    item_code   varchar(20)   NOT NULL REFERENCES item,
    qty         integer       NOT NULL CHECK (qty > 0),
    unit_price  numeric(12,2) NOT NULL,
    PRIMARY KEY (so_no, line_no)
);
CREATE INDEX IF NOT EXISTS ix_so_updated ON sales_order (updated_at);

-- MES 에서 받은 문서 (입고 · 생산실적 · 출고). doc_no 로 중복 수신 방지
CREATE TABLE IF NOT EXISTS mes_document (
    doc_no       varchar(40) PRIMARY KEY,
    doc_type     varchar(20) NOT NULL,
    erp_doc_no   varchar(40) NOT NULL UNIQUE,
    payload      jsonb       NOT NULL,
    received_at  timestamptz NOT NULL DEFAULT now()
);

CREATE SEQUENCE IF NOT EXISTS doc_seq;

-- MES 가 품목 · 거래처를 증분으로 가져가도록 변경 시각
ALTER TABLE item    ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now();
ALTER TABLE partner ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now();

-- 발주 · 수주 비고 (ERP 화면에서 입력)
ALTER TABLE purchase_order ADD COLUMN IF NOT EXISTS remark varchar(200) NOT NULL DEFAULT '';
ALTER TABLE sales_order    ADD COLUMN IF NOT EXISTS remark varchar(200) NOT NULL DEFAULT '';

-- 발주 · 주문 구분 (관리내역 PO_TYPE / SO_TYPE 코드), 통화 · 환율, 공급가 · 부가세 · 합계액
ALTER TABLE purchase_order ADD COLUMN IF NOT EXISTS order_type    varchar(20)   NOT NULL DEFAULT '0';
ALTER TABLE purchase_order ADD COLUMN IF NOT EXISTS currency      varchar(10)   NOT NULL DEFAULT 'KRW';
ALTER TABLE purchase_order ADD COLUMN IF NOT EXISTS exchange_rate numeric(12,4) NOT NULL DEFAULT 1 CHECK (exchange_rate > 0);
ALTER TABLE sales_order    ADD COLUMN IF NOT EXISTS order_type    varchar(20)   NOT NULL DEFAULT '0';
ALTER TABLE sales_order    ADD COLUMN IF NOT EXISTS currency      varchar(10)   NOT NULL DEFAULT 'KRW';
ALTER TABLE sales_order    ADD COLUMN IF NOT EXISTS exchange_rate numeric(12,4) NOT NULL DEFAULT 1 CHECK (exchange_rate > 0);

-- 예전 smallint order_type 컬럼이 있던 DB 를 varchar(20) 코드형으로 변환
ALTER TABLE purchase_order DROP CONSTRAINT IF EXISTS purchase_order_order_type_check;
ALTER TABLE sales_order    DROP CONSTRAINT IF EXISTS sales_order_order_type_check;
ALTER TABLE purchase_order ALTER COLUMN order_type DROP DEFAULT;
ALTER TABLE sales_order    ALTER COLUMN order_type DROP DEFAULT;
ALTER TABLE purchase_order ALTER COLUMN order_type TYPE varchar(20) USING order_type::text;
ALTER TABLE sales_order    ALTER COLUMN order_type TYPE varchar(20) USING order_type::text;
ALTER TABLE purchase_order ALTER COLUMN order_type SET DEFAULT '0';
ALTER TABLE sales_order    ALTER COLUMN order_type SET DEFAULT '0';

ALTER TABLE purchase_order_line ADD COLUMN IF NOT EXISTS supply_amt bigint NOT NULL DEFAULT 0;
ALTER TABLE purchase_order_line ADD COLUMN IF NOT EXISTS vat_amt    bigint NOT NULL DEFAULT 0;
ALTER TABLE purchase_order_line ADD COLUMN IF NOT EXISTS total_amt  bigint NOT NULL DEFAULT 0;

ALTER TABLE sales_order_line ADD COLUMN IF NOT EXISTS supply_amt bigint NOT NULL DEFAULT 0;
ALTER TABLE sales_order_line ADD COLUMN IF NOT EXISTS vat_amt    bigint NOT NULL DEFAULT 0;
ALTER TABLE sales_order_line ADD COLUMN IF NOT EXISTS total_amt  bigint NOT NULL DEFAULT 0;

-- ════════════════════════════════════════════════════════
-- 전표 테이블: 입고 · 생산실적 · 출고 (헤더 + 행)
-- 출처(source: MES/ERP), MES 문서번호, ERP 전표번호, 연결된 발주 · 수주 행 기록
-- ════════════════════════════════════════════════════════

-- 입고
CREATE TABLE IF NOT EXISTS goods_receipt (
    erp_doc_no    varchar(40)  PRIMARY KEY,
    doc_date      date         NOT NULL,
    source        varchar(10)  NOT NULL DEFAULT 'MES' CHECK (source IN ('MES', 'ERP')),
    mes_doc_no    varchar(40)  UNIQUE,
    po_no         varchar(20)  REFERENCES purchase_order,
    partner_code  varchar(10)  REFERENCES partner,
    status        varchar(10)  NOT NULL DEFAULT '확정' CHECK (status IN ('확정', '취소')),
    remark        varchar(200) NOT NULL DEFAULT '',
    created_at    timestamptz  NOT NULL DEFAULT now(),
    CONSTRAINT ck_gr_mes_doc CHECK (source <> 'MES' OR mes_doc_no IS NOT NULL)
);
CREATE INDEX IF NOT EXISTS ix_gr_date ON goods_receipt (doc_date DESC, erp_doc_no DESC);

CREATE TABLE IF NOT EXISTS goods_receipt_line (
    erp_doc_no    varchar(40)  NOT NULL REFERENCES goods_receipt ON DELETE CASCADE,
    line_no       smallint     NOT NULL,
    item_code     varchar(20)  NOT NULL REFERENCES item,
    qty           integer      NOT NULL CHECK (qty <> 0),
    wh_code       varchar(10),
    po_no         varchar(20),
    po_line_no    smallint,
    PRIMARY KEY (erp_doc_no, line_no),
    CONSTRAINT ck_gr_line_po CHECK ((po_no IS NULL) = (po_line_no IS NULL)),
    CONSTRAINT fk_gr_line_po FOREIGN KEY (po_no, po_line_no) REFERENCES purchase_order_line (po_no, line_no)
);
CREATE INDEX IF NOT EXISTS ix_gr_line_po ON goods_receipt_line (po_no, po_line_no) WHERE po_no IS NOT NULL;

-- 생산실적
CREATE TABLE IF NOT EXISTS production_result (
    erp_doc_no    varchar(40)  PRIMARY KEY,
    doc_date      date         NOT NULL,
    source        varchar(10)  NOT NULL DEFAULT 'MES' CHECK (source IN ('MES', 'ERP')),
    mes_doc_no    varchar(40)  UNIQUE,
    wo_no         varchar(20),
    status        varchar(10)  NOT NULL DEFAULT '확정' CHECK (status IN ('확정', '취소')),
    remark        varchar(200) NOT NULL DEFAULT '',
    created_at    timestamptz  NOT NULL DEFAULT now(),
    CONSTRAINT ck_pr_mes_doc CHECK (source <> 'MES' OR mes_doc_no IS NOT NULL)
);
CREATE INDEX IF NOT EXISTS ix_pr_date ON production_result (doc_date DESC, erp_doc_no DESC);

CREATE TABLE IF NOT EXISTS production_result_line (
    erp_doc_no    varchar(40)  NOT NULL REFERENCES production_result ON DELETE CASCADE,
    line_no       smallint     NOT NULL,
    line_type     varchar(10)  NOT NULL DEFAULT '생산' CHECK (line_type IN ('생산', '투입')),
    item_code     varchar(20)  NOT NULL REFERENCES item,
    qty           integer      NOT NULL CHECK (qty <> 0),
    defect_qty    integer      NOT NULL DEFAULT 0 CHECK (defect_qty >= 0),
    wh_code       varchar(10),
    wo_no         varchar(20),
    PRIMARY KEY (erp_doc_no, line_no)
);

-- 출고
CREATE TABLE IF NOT EXISTS goods_issue (
    erp_doc_no    varchar(40)  PRIMARY KEY,
    doc_date      date         NOT NULL,
    source        varchar(10)  NOT NULL DEFAULT 'MES' CHECK (source IN ('MES', 'ERP')),
    mes_doc_no    varchar(40)  UNIQUE,
    so_no         varchar(20)  REFERENCES sales_order,
    partner_code  varchar(10)  REFERENCES partner,
    status        varchar(10)  NOT NULL DEFAULT '확정' CHECK (status IN ('확정', '취소')),
    remark        varchar(200) NOT NULL DEFAULT '',
    created_at    timestamptz  NOT NULL DEFAULT now(),
    CONSTRAINT ck_gi_mes_doc CHECK (source <> 'MES' OR mes_doc_no IS NOT NULL)
);
CREATE INDEX IF NOT EXISTS ix_gi_date ON goods_issue (doc_date DESC, erp_doc_no DESC);

CREATE TABLE IF NOT EXISTS goods_issue_line (
    erp_doc_no    varchar(40)  NOT NULL REFERENCES goods_issue ON DELETE CASCADE,
    line_no       smallint     NOT NULL,
    item_code     varchar(20)  NOT NULL REFERENCES item,
    qty           integer      NOT NULL CHECK (qty <> 0),
    wh_code       varchar(10),
    so_no         varchar(20),
    so_line_no    smallint,
    PRIMARY KEY (erp_doc_no, line_no),
    CONSTRAINT ck_gi_line_so CHECK ((so_no IS NULL) = (so_line_no IS NULL)),
    CONSTRAINT fk_gi_line_so FOREIGN KEY (so_no, so_line_no) REFERENCES sales_order_line (so_no, line_no)
);
CREATE INDEX IF NOT EXISTS ix_gi_line_so ON goods_issue_line (so_no, so_line_no) WHERE so_no IS NOT NULL;

-- 1회성 데이터 이관 기록
CREATE TABLE IF NOT EXISTS schema_migration (
    key         varchar(50) PRIMARY KEY,
    applied_at  timestamptz NOT NULL DEFAULT now()
);

-- 기존 erp.mes_document 수신 문서 → 전표 테이블로 한 번만 이관
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM erp.schema_migration WHERE key = '20261128_mes_document_to_vouchers') THEN
        -- 1) 입고
        INSERT INTO erp.goods_receipt (erp_doc_no, doc_date, source, mes_doc_no, po_no, partner_code, status, created_at)
        SELECT m.erp_doc_no,
               COALESCE(NULLIF(m.payload->>'DocDate', '')::date, NULLIF(m.payload->>'docDate', '')::date, (m.received_at AT TIME ZONE 'Asia/Seoul')::date),
               'MES',
               m.doc_no,
               po.po_no,
               po.partner_code,
               '확정',
               m.received_at
        FROM erp.mes_document m
        LEFT JOIN erp.purchase_order po
               ON po.po_no = NULLIF(COALESCE(m.payload->>'Ref', m.payload->>'ref'), '')
        WHERE m.doc_type = '입고'
        ON CONFLICT DO NOTHING;

        INSERT INTO erp.goods_receipt_line (erp_doc_no, line_no, item_code, qty, wh_code, po_no, po_line_no)
        SELECT m.erp_doc_no,
               l.ord::smallint,
               COALESCE(l.elem->>'ItemCode', l.elem->>'itemCode'),
               COALESCE((l.elem->>'Qty')::integer, (l.elem->>'qty')::integer),
               NULLIF(COALESCE(l.elem->>'WhCode', l.elem->>'whCode'), ''),
               pol.po_no,
               pol.line_no
        FROM erp.mes_document m
        CROSS JOIN LATERAL jsonb_array_elements(COALESCE(m.payload->'Lines', m.payload->'lines', '[]'::jsonb)) WITH ORDINALITY AS l(elem, ord)
        JOIN erp.item i
          ON i.item_code = COALESCE(l.elem->>'ItemCode', l.elem->>'itemCode')
        LEFT JOIN erp.purchase_order_line pol
          ON pol.po_no = COALESCE(NULLIF(COALESCE(l.elem->>'RefNo', l.elem->>'refNo'), ''), NULLIF(COALESCE(m.payload->>'Ref', m.payload->>'ref'), ''))
         AND pol.line_no = COALESCE((l.elem->>'RefLineNo')::smallint, (l.elem->>'refLineNo')::smallint)
        WHERE m.doc_type = '입고'
          AND EXISTS (SELECT 1 FROM erp.goods_receipt gr WHERE gr.erp_doc_no = m.erp_doc_no)
          AND COALESCE((l.elem->>'Qty')::integer, (l.elem->>'qty')::integer, 0) <> 0
        ON CONFLICT (erp_doc_no, line_no) DO NOTHING;

        -- 2) 생산실적
        INSERT INTO erp.production_result (erp_doc_no, doc_date, source, mes_doc_no, wo_no, status, created_at)
        SELECT m.erp_doc_no,
               COALESCE(NULLIF(m.payload->>'DocDate', '')::date, NULLIF(m.payload->>'docDate', '')::date, (m.received_at AT TIME ZONE 'Asia/Seoul')::date),
               'MES',
               m.doc_no,
               NULLIF(COALESCE(m.payload->>'Ref', m.payload->>'ref'), ''),
               '확정',
               m.received_at
        FROM erp.mes_document m
        WHERE m.doc_type = '생산실적'
        ON CONFLICT DO NOTHING;

        INSERT INTO erp.production_result_line (erp_doc_no, line_no, line_type, item_code, qty, defect_qty, wh_code, wo_no)
        SELECT m.erp_doc_no,
               l.ord::smallint,
               CASE WHEN COALESCE(l.elem->>'LineType', l.elem->>'lineType') = '투입' THEN '투입' ELSE '생산' END,
               COALESCE(l.elem->>'ItemCode', l.elem->>'itemCode'),
               COALESCE((l.elem->>'Qty')::integer, (l.elem->>'qty')::integer),
               GREATEST(COALESCE((l.elem->>'DefectQty')::integer, (l.elem->>'defectQty')::integer, 0), 0),
               NULLIF(COALESCE(l.elem->>'WhCode', l.elem->>'whCode'), ''),
               NULLIF(COALESCE(l.elem->>'RefNo', l.elem->>'refNo', m.payload->>'Ref', m.payload->>'ref'), '')
        FROM erp.mes_document m
        CROSS JOIN LATERAL jsonb_array_elements(COALESCE(m.payload->'Lines', m.payload->'lines', '[]'::jsonb)) WITH ORDINALITY AS l(elem, ord)
        JOIN erp.item i
          ON i.item_code = COALESCE(l.elem->>'ItemCode', l.elem->>'itemCode')
        WHERE m.doc_type = '생산실적'
          AND EXISTS (SELECT 1 FROM erp.production_result pr WHERE pr.erp_doc_no = m.erp_doc_no)
          AND COALESCE((l.elem->>'Qty')::integer, (l.elem->>'qty')::integer, 0) <> 0
        ON CONFLICT (erp_doc_no, line_no) DO NOTHING;

        -- 3) 출고
        INSERT INTO erp.goods_issue (erp_doc_no, doc_date, source, mes_doc_no, so_no, partner_code, status, created_at)
        SELECT m.erp_doc_no,
               COALESCE(NULLIF(m.payload->>'DocDate', '')::date, NULLIF(m.payload->>'docDate', '')::date, (m.received_at AT TIME ZONE 'Asia/Seoul')::date),
               'MES',
               m.doc_no,
               so.so_no,
               so.partner_code,
               '확정',
               m.received_at
        FROM erp.mes_document m
        LEFT JOIN erp.sales_order so
               ON so.so_no = NULLIF(COALESCE(m.payload->>'Ref', m.payload->>'ref'), '')
        WHERE m.doc_type = '출고'
        ON CONFLICT DO NOTHING;

        INSERT INTO erp.goods_issue_line (erp_doc_no, line_no, item_code, qty, wh_code, so_no, so_line_no)
        SELECT m.erp_doc_no,
               l.ord::smallint,
               COALESCE(l.elem->>'ItemCode', l.elem->>'itemCode'),
               COALESCE((l.elem->>'Qty')::integer, (l.elem->>'qty')::integer),
               NULLIF(COALESCE(l.elem->>'WhCode', l.elem->>'whCode'), ''),
               sol.so_no,
               sol.line_no
        FROM erp.mes_document m
        CROSS JOIN LATERAL jsonb_array_elements(COALESCE(m.payload->'Lines', m.payload->'lines', '[]'::jsonb)) WITH ORDINALITY AS l(elem, ord)
        JOIN erp.item i
          ON i.item_code = COALESCE(l.elem->>'ItemCode', l.elem->>'itemCode')
        LEFT JOIN erp.sales_order_line sol
          ON sol.so_no = COALESCE(NULLIF(COALESCE(l.elem->>'RefNo', l.elem->>'refNo'), ''), NULLIF(COALESCE(m.payload->>'Ref', m.payload->>'ref'), ''))
         AND sol.line_no = COALESCE((l.elem->>'RefLineNo')::smallint, (l.elem->>'refLineNo')::smallint)
        WHERE m.doc_type = '출고'
          AND EXISTS (SELECT 1 FROM erp.goods_issue gi WHERE gi.erp_doc_no = m.erp_doc_no)
          AND COALESCE((l.elem->>'Qty')::integer, (l.elem->>'qty')::integer, 0) <> 0
        ON CONFLICT (erp_doc_no, line_no) DO NOTHING;

        INSERT INTO erp.schema_migration (key) VALUES ('20261128_mes_document_to_vouchers');
    END IF;

    -- 기존 발주 · 수주 행의 공급가 · 부가세 · 합계액 1회 채우기
    IF NOT EXISTS (SELECT 1 FROM erp.schema_migration WHERE key = '20261128_order_line_amounts') THEN
        UPDATE erp.purchase_order_line l
        SET supply_amt = trunc(l.qty * l.unit_price)::bigint,
            vat_amt    = CASE WHEN o.order_type::text = '0' THEN trunc(trunc(l.qty * l.unit_price) / 10)::bigint ELSE 0 END,
            total_amt  = trunc(l.qty * l.unit_price)::bigint
                       + CASE WHEN o.order_type::text = '0' THEN trunc(trunc(l.qty * l.unit_price) / 10)::bigint ELSE 0 END
        FROM erp.purchase_order o
        WHERE o.po_no = l.po_no;

        UPDATE erp.sales_order_line l
        SET supply_amt = trunc(l.qty * l.unit_price)::bigint,
            vat_amt    = CASE WHEN o.order_type::text = '0' THEN trunc(trunc(l.qty * l.unit_price) / 10)::bigint ELSE 0 END,
            total_amt  = trunc(l.qty * l.unit_price)::bigint
                       + CASE WHEN o.order_type::text = '0' THEN trunc(trunc(l.qty * l.unit_price) / 10)::bigint ELSE 0 END
        FROM erp.sales_order o
        WHERE o.so_no = l.so_no;

        INSERT INTO erp.schema_migration (key) VALUES ('20261128_order_line_amounts');
    END IF;

    -- 기본 관리내역(공통코드) 1회 초기 등록
    IF NOT EXISTS (SELECT 1 FROM erp.schema_migration WHERE key = '20261129_seed_common_codes') THEN
        INSERT INTO erp.code_group (group_code, group_name, remark, sort_no) VALUES
            ('PO_TYPE',      '발주구분',   '발주등록 과세 · 영세 구분', 1),
            ('SO_TYPE',      '주문구분',   '주문등록 과세 · 영세 구분', 2),
            ('CURRENCY',     '통화',       '거래 통화 코드',           3),
            ('ITEM_TYPE',    '품목구분',   '품목 자산 분류',           4),
            ('PARTNER_TYPE', '거래처구분', '매입 · 매출 거래처 구분',  5),
            ('UNIT',         '단위',       '재고 · 거래 계량 단위',    6),
            ('WH_TYPE',      '창고구분',   '창고 용도 구분',           7)
        ON CONFLICT (group_code) DO NOTHING;

        INSERT INTO erp.common_code (group_code, code, code_name, sort_no, remark) VALUES
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
            ('WH_TYPE',      '일반',   '일반',     4, '일반 창고')
        ON CONFLICT (group_code, code) DO NOTHING;

        INSERT INTO erp.schema_migration (key) VALUES ('20261129_seed_common_codes');
    END IF;
END
$$;
