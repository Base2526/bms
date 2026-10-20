DROP TRIGGER IF EXISTS ledger_journals_immutable ON fleet_delivery.ledger_journals;
DROP TRIGGER IF EXISTS ledger_entries_immutable ON fleet_delivery.ledger_entries;
DROP TRIGGER IF EXISTS ledger_entries_balance_check ON fleet_delivery.ledger_entries;
DROP TRIGGER IF EXISTS ledger_journals_balance_check ON fleet_delivery.ledger_journals;

CREATE OR REPLACE FUNCTION fleet_delivery.protect_posted_journal()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' OR OLD.status = 'POSTED' THEN
    RAISE EXCEPTION 'posted journal is immutable' USING ERRCODE = '55000';
  END IF;
  RETURN NEW;
END
$$;

CREATE OR REPLACE FUNCTION fleet_delivery.protect_posted_ledger_entry()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE parent_status text;
BEGIN
  SELECT status INTO parent_status
    FROM fleet_delivery.ledger_journals
   WHERE id = OLD.journal_id;
  IF parent_status = 'POSTED' THEN
    RAISE EXCEPTION 'posted ledger entry is immutable' USING ERRCODE = '55000';
  END IF;
  RETURN COALESCE(NEW, OLD);
END
$$;

CREATE TRIGGER ledger_journals_immutable
  BEFORE UPDATE OR DELETE ON fleet_delivery.ledger_journals
  FOR EACH ROW EXECUTE FUNCTION fleet_delivery.protect_posted_journal();
CREATE TRIGGER ledger_entries_immutable
  BEFORE UPDATE OR DELETE ON fleet_delivery.ledger_entries
  FOR EACH ROW EXECUTE FUNCTION fleet_delivery.protect_posted_ledger_entry();

CREATE OR REPLACE FUNCTION fleet_delivery.assert_journal_balanced(p_journal_id uuid)
RETURNS void LANGUAGE plpgsql AS $$
DECLARE journal_status text;
DECLARE declared_debit bigint;
DECLARE declared_credit bigint;
DECLARE actual_debit bigint;
DECLARE actual_credit bigint;
BEGIN
  SELECT status, declared_debit_satang, declared_credit_satang
    INTO journal_status, declared_debit, declared_credit
    FROM fleet_delivery.ledger_journals
   WHERE id = p_journal_id;
  IF journal_status = 'POSTED' THEN
    SELECT COALESCE(sum(amount_satang) FILTER (WHERE side = 'DEBIT'), 0),
           COALESCE(sum(amount_satang) FILTER (WHERE side = 'CREDIT'), 0)
      INTO actual_debit, actual_credit
      FROM fleet_delivery.ledger_entries
     WHERE journal_id = p_journal_id;
    IF actual_debit <> declared_debit OR actual_credit <> declared_credit OR actual_debit <> actual_credit THEN
      RAISE EXCEPTION 'posted journal % is not balanced', p_journal_id USING ERRCODE = '23514';
    END IF;
  END IF;
END
$$;

CREATE OR REPLACE FUNCTION fleet_delivery.validate_journal_row_balance()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  PERFORM fleet_delivery.assert_journal_balanced(NEW.id);
  RETURN NULL;
END
$$;

CREATE OR REPLACE FUNCTION fleet_delivery.validate_entry_journal_balance()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  PERFORM fleet_delivery.assert_journal_balanced(COALESCE(NEW.journal_id, OLD.journal_id));
  RETURN NULL;
END
$$;

CREATE CONSTRAINT TRIGGER ledger_entries_balance_check
  AFTER INSERT OR UPDATE OR DELETE ON fleet_delivery.ledger_entries
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION fleet_delivery.validate_entry_journal_balance();
CREATE CONSTRAINT TRIGGER ledger_journals_balance_check
  AFTER INSERT OR UPDATE ON fleet_delivery.ledger_journals
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION fleet_delivery.validate_journal_row_balance();

DROP FUNCTION IF EXISTS fleet_delivery.protect_posted_ledger();
DROP FUNCTION IF EXISTS fleet_delivery.validate_posted_journal();
