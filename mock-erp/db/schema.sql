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
    partner_type  varchar(10) NOT NULL CHECK (partner_type IN ('매입처', '매출처'))
);

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
