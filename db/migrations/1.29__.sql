-- 1) รายงานบัญชีธนาคาร (ดิบ)
CREATE TABLE IF NOT EXISTS scam_bank_account_reports (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  bank_name       text NOT NULL,
  account_no      text NOT NULL,
  account_norm    text NOT NULL,  -- normalize เฉพาะตัวเลข
  note            text,
  client_id       text NOT NULL,  -- UUID v4 จาก client กันยิงซ้ำ
  device_model    text,
  os_version      text,
  app_version     text,
  created_at      timestamptz NOT NULL DEFAULT now()
);

-- กัน duplicate report ต่อ client_id (แนะนำ)
CREATE UNIQUE INDEX IF NOT EXISTS scam_bank_account_reports_client_id_ux
ON scam_bank_account_reports (client_id);

-- สำหรับค้นหา prefix/exact เร็ว ๆ
CREATE INDEX IF NOT EXISTS scam_bank_account_reports_norm_idx
ON scam_bank_account_reports (account_norm);

CREATE INDEX IF NOT EXISTS scam_bank_account_reports_bank_idx
ON scam_bank_account_reports (bank_name);


-- 2) summary (aggregate)
CREATE TABLE IF NOT EXISTS scam_bank_accounts_summary (
  bank_name       text NOT NULL,
  account_no      text NOT NULL,      -- เก็บต้นฉบับ (ตัวเลขล้วนหรือมีขีดก็ได้)
  account_norm    text NOT NULL,      -- ตัวเลขล้วน
  report_count    int  NOT NULL DEFAULT 0,
  last_report_at  timestamptz,
  risk_level      int  NOT NULL DEFAULT 10,
  updated_at      timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (bank_name, account_norm)
);

CREATE INDEX IF NOT EXISTS scam_bank_accounts_summary_norm_idx
ON scam_bank_accounts_summary (account_norm);

CREATE INDEX IF NOT EXISTS scam_bank_accounts_summary_updated_idx
ON scam_bank_accounts_summary (updated_at);


-- 3) trigger aggregate (after insert report -> upsert summary)
CREATE OR REPLACE FUNCTION trg_agg_scam_bank_account() RETURNS trigger AS $$
DECLARE
  new_count int;
BEGIN
  INSERT INTO scam_bank_accounts_summary (
    bank_name, account_no, account_norm,
    report_count, last_report_at, risk_level, updated_at
  )
  VALUES (
    NEW.bank_name, NEW.account_no, NEW.account_norm,
    1, NEW.created_at, 10, NEW.created_at
  )
  ON CONFLICT (bank_name, account_norm)
  DO UPDATE SET
    report_count   = scam_bank_accounts_summary.report_count + 1,
    last_report_at = GREATEST(scam_bank_accounts_summary.last_report_at, NEW.created_at),
    updated_at     = GREATEST(scam_bank_accounts_summary.updated_at, NEW.created_at),
    -- risk_level จะให้คุณคุมที่ app ก็ได้ แต่ใส่ logic เบื้องต้นไว้ก่อน
    risk_level     = GREATEST(
      scam_bank_accounts_summary.risk_level,
      CASE
        WHEN (scam_bank_accounts_summary.report_count + 1) >= 20 THEN 90
        WHEN (scam_bank_accounts_summary.report_count + 1) >= 10 THEN 60
        WHEN (scam_bank_accounts_summary.report_count + 1) >= 5  THEN 40
        ELSE 10
      END
    );

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS scam_bank_account_reports_agg_tg ON scam_bank_account_reports;

CREATE TRIGGER scam_bank_account_reports_agg_tg
AFTER INSERT ON scam_bank_account_reports
FOR EACH ROW
EXECUTE FUNCTION trg_agg_scam_bank_account();
