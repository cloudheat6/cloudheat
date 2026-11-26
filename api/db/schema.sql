-- MES 데모 스키마 (PostgreSQL 16)
-- 여러 번 실행해도 안전하게 IF NOT EXISTS / CREATE OR REPLACE 로 작성
CREATE SCHEMA IF NOT EXISTS mes;
SET search_path = mes;

-- ── 기준정보 ────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS line (
    line_id    smallint    PRIMARY KEY,
    line_name  varchar(30) NOT NULL
);

CREATE TABLE IF NOT EXISTS item (
    item_code  varchar(20) PRIMARY KEY,
    item_name  varchar(50) NOT NULL,
    line_id    smallint    NOT NULL REFERENCES line
);

CREATE TABLE IF NOT EXISTS worker (
    worker_id    smallint    PRIMARY KEY,
    worker_name  varchar(20) NOT NULL
);

CREATE TABLE IF NOT EXISTS routing_step (
    line_id    smallint    NOT NULL REFERENCES line,
    seq        smallint    NOT NULL,
    step_name  varchar(30) NOT NULL,
    PRIMARY KEY (line_id, seq)
);

CREATE TABLE IF NOT EXISTS defect_type (
    defect_type_id  smallint    PRIMARY KEY,
    line_id         smallint    NOT NULL REFERENCES line,
    defect_name     varchar(30) NOT NULL
);

-- ── 작업지시 ────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS work_order (
    wo_id       integer      GENERATED ALWAYS AS IDENTITY PRIMARY KEY,   -- MSSQL: IDENTITY(1,1)
    wo_no       varchar(20)  NOT NULL UNIQUE,
    due_date    date         NOT NULL,
    item_code   varchar(20)  NOT NULL REFERENCES item,
    worker_id   smallint     NOT NULL REFERENCES worker,
    plan_qty    integer      NOT NULL CHECK (plan_qty > 0),
    prod_qty    integer      NOT NULL DEFAULT 0,
    defect_qty  integer      NOT NULL DEFAULT 0,
    remark      varchar(200) NOT NULL DEFAULT '',
    updated_at  timestamptz  NOT NULL DEFAULT now(),                       -- MSSQL: DATETIME + GETDATE()
    CONSTRAINT ck_prod_range   CHECK (prod_qty BETWEEN 0 AND plan_qty * 1.2),
    CONSTRAINT ck_defect_range CHECK (defect_qty BETWEEN 0 AND prod_qty)
);
CREATE INDEX IF NOT EXISTS ix_work_order_due_date ON work_order (due_date);

-- 공정별 손실 / 불량 유형 분배 가중치 (실적이 바뀌어도 상세가 일관되게 다시 계산되도록)
CREATE TABLE IF NOT EXISTS wo_process_weight (
    wo_id   integer      NOT NULL REFERENCES work_order ON DELETE CASCADE,
    seq     smallint     NOT NULL,
    weight  numeric(6,3) NOT NULL CHECK (weight > 0),
    PRIMARY KEY (wo_id, seq)
);

CREATE TABLE IF NOT EXISTS wo_defect_weight (
    wo_id           integer      NOT NULL REFERENCES work_order ON DELETE CASCADE,
    defect_type_id  smallint     NOT NULL REFERENCES defect_type,
    weight          numeric(6,3) NOT NULL CHECK (weight > 0),
    PRIMARY KEY (wo_id, defect_type_id)
);

-- ── 조회용 뷰: 상태는 저장하지 않고 계산 ─────────────────
CREATE OR REPLACE VIEW v_work_order AS
SELECT w.wo_id,
       w.wo_no,
       w.due_date,
       l.line_id,
       l.line_name,
       w.item_code,
       i.item_name,
       wk.worker_name,
       w.plan_qty,
       w.prod_qty,
       w.defect_qty,
       w.remark,
       w.updated_at,
       CASE
           WHEN w.prod_qty >= w.plan_qty    THEN '완료'
           WHEN w.due_date < current_date   THEN '지연'
           WHEN w.prod_qty = 0              THEN '대기'
           ELSE '진행'
       END AS status
FROM work_order w
JOIN item   i  ON i.item_code  = w.item_code
JOIN line   l  ON l.line_id    = i.line_id
JOIN worker wk ON wk.worker_id = w.worker_id;

-- ── 공정별 실적: 불량 수량을 가중치대로 공정에 분배 (윈도 함수) ──
-- 누적 반올림 차이 방식이라 공정별 손실 합계가 항상 불량 수량과 정확히 일치
CREATE OR REPLACE FUNCTION fn_wo_process(p_wo_id integer)
RETURNS TABLE (seq smallint, step_name varchar, in_qty integer, out_qty integer, loss_qty integer)
LANGUAGE sql STABLE AS $$
    WITH s AS (
        SELECT r.seq,
               r.step_name,
               w.prod_qty + w.defect_qty                              AS input_qty,
               w.defect_qty,
               pw.weight,
               sum(pw.weight) OVER (ORDER BY r.seq)                   AS cum_w,
               sum(pw.weight) OVER ()                                 AS tot_w
        FROM mes.work_order w
        JOIN mes.item i               ON i.item_code = w.item_code
        JOIN mes.routing_step r       ON r.line_id   = i.line_id
        JOIN mes.wo_process_weight pw ON pw.wo_id    = w.wo_id AND pw.seq = r.seq
        WHERE w.wo_id = p_wo_id
    ), c AS (
        SELECT s.*,
               round(defect_qty * (cum_w - weight) / tot_w)::integer AS loss_before,
               round(defect_qty * cum_w / tot_w)::integer            AS loss_after
        FROM s
    )
    SELECT c.seq,
           c.step_name,
           c.input_qty - c.loss_before,
           c.input_qty - c.loss_after,
           c.loss_after - c.loss_before
    FROM c
    ORDER BY c.seq
$$;

-- ── 불량 유형별 수량: 같은 방식으로 분배 ─────────────────
CREATE OR REPLACE FUNCTION fn_wo_defects(p_wo_id integer)
RETURNS TABLE (defect_name varchar, qty integer)
LANGUAGE sql STABLE AS $$
    WITH d AS (
        SELECT dt.defect_name,
               w.defect_qty,
               dw.weight,
               sum(dw.weight) OVER (ORDER BY dw.weight DESC, dt.defect_type_id) AS cum_w,
               sum(dw.weight) OVER ()                                           AS tot_w
        FROM mes.work_order w
        JOIN mes.wo_defect_weight dw ON dw.wo_id = w.wo_id
        JOIN mes.defect_type dt      ON dt.defect_type_id = dw.defect_type_id
        WHERE w.wo_id = p_wo_id
    ), q AS (
        SELECT d.defect_name,
               d.weight,
               (round(defect_qty * cum_w / tot_w) - round(defect_qty * (cum_w - weight) / tot_w))::integer AS qty
        FROM d
    )
    SELECT q.defect_name, q.qty
    FROM q
    WHERE q.qty > 0
    ORDER BY q.qty DESC, q.defect_name
$$;

-- ════════════════════════════════════════════════════════
-- 1단계: 재고 · ERP 연동
-- ════════════════════════════════════════════════════════

-- 품목 구분 추가 (원자재는 라인이 없음)
ALTER TABLE item ADD COLUMN IF NOT EXISTS item_type varchar(10) NOT NULL DEFAULT '제품';
ALTER TABLE item ADD COLUMN IF NOT EXISTS unit      varchar(10) NOT NULL DEFAULT 'EA';
ALTER TABLE item ALTER COLUMN line_id DROP NOT NULL;

CREATE TABLE IF NOT EXISTS warehouse (
    wh_code  varchar(10) PRIMARY KEY,
    wh_name  varchar(30) NOT NULL
);

-- 현재고 (품목 × 창고)
CREATE TABLE IF NOT EXISTS stock (
    item_code   varchar(20) NOT NULL REFERENCES item,
    wh_code     varchar(10) NOT NULL REFERENCES warehouse,
    qty         integer     NOT NULL DEFAULT 0,
    updated_at  timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (item_code, wh_code)
);

-- 수불 이력: 재고 변동은 모두 여기에 남김 (수량은 부호 포함)
CREATE TABLE IF NOT EXISTS stock_tx (
    tx_id      bigint       GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    tx_at      timestamptz  NOT NULL DEFAULT now(),
    tx_type    varchar(10)  NOT NULL CHECK (tx_type IN ('기초', '입고', '생산입고', '생산투입', '출고', '이동', '조정')),
    item_code  varchar(20)  NOT NULL REFERENCES item,
    wh_code    varchar(10)  NOT NULL REFERENCES warehouse,
    qty        integer      NOT NULL CHECK (qty <> 0),
    ref_type   varchar(20),
    ref_no     varchar(40),
    note       varchar(200) NOT NULL DEFAULT ''
);
CREATE INDEX IF NOT EXISTS ix_stock_tx_at   ON stock_tx (tx_at DESC);
CREATE INDEX IF NOT EXISTS ix_stock_tx_item ON stock_tx (item_code, tx_at DESC);

-- 재고 반영: 수불 기록 + 현재고 증감을 한 번에. 마이너스 재고는 거부
CREATE OR REPLACE FUNCTION fn_post_stock(
    p_tx_type varchar, p_item_code varchar, p_wh_code varchar, p_qty integer,
    p_ref_type varchar DEFAULT NULL, p_ref_no varchar DEFAULT NULL, p_note varchar DEFAULT '')
RETURNS bigint
LANGUAGE plpgsql AS $$
DECLARE
    v_new integer;
    v_tx  bigint;
BEGIN
    INSERT INTO mes.stock AS s (item_code, wh_code, qty, updated_at)
    VALUES (p_item_code, p_wh_code, p_qty, now())
    ON CONFLICT (item_code, wh_code)
        DO UPDATE SET qty = s.qty + EXCLUDED.qty, updated_at = now()
    RETURNING qty INTO v_new;

    IF v_new < 0 THEN
        RAISE EXCEPTION '재고 부족: % / % (부족 수량 %)', p_item_code, p_wh_code, -v_new
            USING ERRCODE = 'P0001';
    END IF;

    INSERT INTO mes.stock_tx (tx_type, item_code, wh_code, qty, ref_type, ref_no, note)
    VALUES (p_tx_type, p_item_code, p_wh_code, p_qty, p_ref_type, p_ref_no, COALESCE(p_note, ''))
    RETURNING tx_id INTO v_tx;
    RETURN v_tx;
END
$$;

-- 문서 번호용 시퀀스
CREATE SEQUENCE IF NOT EXISTS doc_seq;

-- ── ERP → MES 수신 (발주 · 주문 사본) ─────────────────────
CREATE TABLE IF NOT EXISTS purchase_order (
    po_no        varchar(20)  PRIMARY KEY,
    po_date      date         NOT NULL,
    vendor_name  varchar(50)  NOT NULL,
    due_date     date         NOT NULL,
    erp_status   varchar(10)  NOT NULL,
    synced_at    timestamptz  NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS purchase_order_line (
    po_no         varchar(20) NOT NULL REFERENCES purchase_order ON DELETE CASCADE,
    line_no       smallint    NOT NULL,
    item_code     varchar(20) NOT NULL REFERENCES item,
    order_qty     integer     NOT NULL CHECK (order_qty > 0),
    received_qty  integer     NOT NULL DEFAULT 0,
    PRIMARY KEY (po_no, line_no)
);

CREATE TABLE IF NOT EXISTS sales_order (
    so_no          varchar(20)  PRIMARY KEY,
    so_date        date         NOT NULL,
    customer_name  varchar(50)  NOT NULL,
    due_date       date         NOT NULL,
    erp_status     varchar(10)  NOT NULL,
    synced_at      timestamptz  NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS sales_order_line (
    so_no        varchar(20) NOT NULL REFERENCES sales_order ON DELETE CASCADE,
    line_no      smallint    NOT NULL,
    item_code    varchar(20) NOT NULL REFERENCES item,
    order_qty    integer     NOT NULL CHECK (order_qty > 0),
    shipped_qty  integer     NOT NULL DEFAULT 0,
    PRIMARY KEY (so_no, line_no)
);

-- 증분 수신 기준 시각 (ERP updated_at 기준)
CREATE TABLE IF NOT EXISTS erp_sync_cursor (
    kind             varchar(10) PRIMARY KEY,     -- '발주' | '주문'
    last_updated_at  timestamptz
);

-- 수신 이력
CREATE TABLE IF NOT EXISTS erp_sync_log (
    sync_id      bigint       GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    kind         varchar(10)  NOT NULL,
    trigger_by   varchar(10)  NOT NULL,           -- '자동' | '수동'
    started_at   timestamptz  NOT NULL DEFAULT now(),
    finished_at  timestamptz,
    fetched      integer      NOT NULL DEFAULT 0,
    applied      integer      NOT NULL DEFAULT 0,
    skipped      integer      NOT NULL DEFAULT 0,
    status       varchar(10)  NOT NULL,           -- '성공' | '부분성공' | '실패'
    message      varchar(500) NOT NULL DEFAULT ''
);
CREATE INDEX IF NOT EXISTS ix_erp_sync_log_started ON erp_sync_log (started_at DESC);

-- ── MES → ERP 송신 대기열 (Transactional Outbox) ──────────
-- 업무 처리와 같은 트랜잭션에서 INSERT → 백그라운드 작업이 ERP 로 전송 · 재시도
CREATE TABLE IF NOT EXISTS erp_outbox (
    outbox_id        bigint       GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    doc_type         varchar(20)  NOT NULL,       -- '생산실적' | '입고' | '출고'
    doc_no           varchar(40)  NOT NULL UNIQUE,
    payload          jsonb        NOT NULL,
    status           varchar(10)  NOT NULL DEFAULT '대기' CHECK (status IN ('대기', '성공', '실패')),
    attempts         integer      NOT NULL DEFAULT 0,
    last_error       varchar(300),
    erp_doc_no       varchar(40),
    next_attempt_at  timestamptz  NOT NULL DEFAULT now(),
    created_at       timestamptz  NOT NULL DEFAULT now(),
    sent_at          timestamptz
);
CREATE INDEX IF NOT EXISTS ix_erp_outbox_pending ON erp_outbox (next_attempt_at) WHERE status = '대기';
CREATE INDEX IF NOT EXISTS ix_erp_outbox_created ON erp_outbox (created_at DESC);

-- ════════════════════════════════════════════════════════
-- 수신 상태: 새 데이터가 없어 로그를 남기지 않은 성공도 '마지막 확인' 으로 기록
-- ════════════════════════════════════════════════════════
ALTER TABLE erp_sync_cursor ADD COLUMN IF NOT EXISTS last_checked_at timestamptz;
ALTER TABLE erp_sync_cursor ADD COLUMN IF NOT EXISTS last_status     varchar(10);
ALTER TABLE erp_sync_cursor ADD COLUMN IF NOT EXISTS last_message    varchar(500);

-- ════════════════════════════════════════════════════════
-- 기준정보: 품목 · 거래처는 ERP 기준(수신), 공정 · 창고 · 라인 · 라우팅 · BOM 은 MES 관리
-- ════════════════════════════════════════════════════════

-- 품목: 이름 · 구분 · 단위는 ERP 값, 아래는 MES 전용 속성
ALTER TABLE item ADD COLUMN IF NOT EXISTS default_wh_code varchar(10) REFERENCES warehouse;
ALTER TABLE item ADD COLUMN IF NOT EXISTS safety_qty      integer     NOT NULL DEFAULT 0;
ALTER TABLE item ADD COLUMN IF NOT EXISTS use_yn          boolean     NOT NULL DEFAULT true;
ALTER TABLE item ADD COLUMN IF NOT EXISTS erp_synced_at   timestamptz;
ALTER TABLE item ADD COLUMN IF NOT EXISTS updated_at      timestamptz NOT NULL DEFAULT now();

ALTER TABLE warehouse ADD COLUMN IF NOT EXISTS wh_type varchar(10) NOT NULL DEFAULT '일반';
ALTER TABLE warehouse ADD COLUMN IF NOT EXISTS use_yn  boolean     NOT NULL DEFAULT true;
ALTER TABLE line      ADD COLUMN IF NOT EXISTS use_yn  boolean     NOT NULL DEFAULT true;

-- 처음 한 번: 기존 창고 구분 · 품목 기본 창고 채우기
UPDATE warehouse
SET wh_type = CASE wh_code WHEN 'WH-RM' THEN '원자재' WHEN 'WH-WIP' THEN '현장' WHEN 'WH-FG' THEN '제품' ELSE wh_type END
WHERE wh_type = '일반' AND wh_code IN ('WH-RM', 'WH-WIP', 'WH-FG');
UPDATE item
SET default_wh_code = CASE WHEN item_type = '원자재' THEN 'WH-RM' ELSE 'WH-FG' END
WHERE default_wh_code IS NULL AND erp_synced_at IS NULL
  AND EXISTS (SELECT 1 FROM warehouse WHERE wh_code = 'WH-RM')
  AND EXISTS (SELECT 1 FROM warehouse WHERE wh_code = 'WH-FG');

-- 거래처 (ERP 에서 수신)
CREATE TABLE IF NOT EXISTS partner (
    partner_code   varchar(10) PRIMARY KEY,
    partner_name   varchar(50) NOT NULL,
    partner_type   varchar(10) NOT NULL,
    erp_synced_at  timestamptz NOT NULL DEFAULT now()
);

-- 공정
CREATE TABLE IF NOT EXISTS process (
    process_code  varchar(10) PRIMARY KEY,
    process_name  varchar(30) NOT NULL,
    sort_no       smallint    NOT NULL DEFAULT 0,
    use_yn        boolean     NOT NULL DEFAULT true
);

-- 라우팅: 품목별 공정 순서 (예전 라인별 routing_step 을 대체)
CREATE TABLE IF NOT EXISTS routing (
    item_code     varchar(20) NOT NULL REFERENCES item ON DELETE CASCADE,
    seq           smallint    NOT NULL,
    process_code  varchar(10) NOT NULL REFERENCES process,
    line_id       smallint    REFERENCES line,
    PRIMARY KEY (item_code, seq)
);

-- BOM: 모품목 1개를 만드는 데 드는 자품목 수량 (단단계)
CREATE TABLE IF NOT EXISTS bom (
    parent_code  varchar(20)   NOT NULL REFERENCES item ON DELETE CASCADE,
    child_code   varchar(20)   NOT NULL REFERENCES item,
    qty_per      numeric(12,4) NOT NULL CHECK (qty_per > 0),
    seq          smallint      NOT NULL DEFAULT 0,
    PRIMARY KEY (parent_code, child_code),
    CONSTRAINT ck_bom_self CHECK (parent_code <> child_code)
);

-- 처음 한 번: 라인별 공정(routing_step) → 공정 마스터 + 품목별 라우팅
INSERT INTO process (process_code, process_name, sort_no)
SELECT 'P' || lpad(n::text, 2, '0'), step_name, n::smallint
FROM (
    SELECT step_name, row_number() OVER (ORDER BY min(line_id), min(seq), step_name) AS n
    FROM routing_step GROUP BY step_name
) s
WHERE NOT EXISTS (SELECT 1 FROM process);

INSERT INTO routing (item_code, seq, process_code, line_id)
SELECT i.item_code, rs.seq, p.process_code, rs.line_id
FROM item i
JOIN routing_step rs ON rs.line_id = i.line_id
JOIN process p       ON p.process_name = rs.step_name
WHERE i.item_type = '제품' AND NOT EXISTS (SELECT 1 FROM routing);

-- 공정별 실적을 품목 라우팅 기준으로 (위의 라인 기준 정의를 대체)
-- 라우팅을 바꿔 가중치가 없는 공정은 가중치 1 로 계산
CREATE OR REPLACE FUNCTION fn_wo_process(p_wo_id integer)
RETURNS TABLE (seq smallint, step_name varchar, in_qty integer, out_qty integer, loss_qty integer)
LANGUAGE sql STABLE AS $$
    WITH s AS (
        SELECT r.seq,
               p.process_name::varchar                                   AS step_name,
               w.prod_qty + w.defect_qty                                 AS input_qty,
               w.defect_qty,
               COALESCE(pw.weight, 1)                                    AS weight,
               sum(COALESCE(pw.weight, 1)) OVER (ORDER BY r.seq)         AS cum_w,
               sum(COALESCE(pw.weight, 1)) OVER ()                       AS tot_w
        FROM mes.work_order w
        JOIN mes.routing r                 ON r.item_code    = w.item_code
        JOIN mes.process p                 ON p.process_code = r.process_code
        LEFT JOIN mes.wo_process_weight pw ON pw.wo_id = w.wo_id AND pw.seq = r.seq
        WHERE w.wo_id = p_wo_id
    ), c AS (
        SELECT s.*,
               round(defect_qty * (cum_w - weight) / tot_w)::integer AS loss_before,
               round(defect_qty * cum_w / tot_w)::integer            AS loss_after
        FROM s
    )
    SELECT c.seq, c.step_name,
           c.input_qty - c.loss_before,
           c.input_qty - c.loss_after,
           c.loss_after - c.loss_before
    FROM c
    ORDER BY c.seq
$$;
