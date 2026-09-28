-- Audit log is append-only for normal operation (spec §73).
-- Maintenance (e.g. retention purge) must explicitly opt in per transaction:
--   SET LOCAL pcos.allow_history_mutation = 'on';
CREATE OR REPLACE FUNCTION pcos_forbid_history_mutation() RETURNS trigger AS $$
BEGIN
  IF coalesce(current_setting('pcos.allow_history_mutation', true), 'off') = 'on' THEN
    IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
    IF TG_OP = 'TRUNCATE' THEN RETURN NULL; END IF;
    RETURN NEW;
  END IF;
  RAISE EXCEPTION 'table % is append-only (%)', TG_TABLE_NAME, TG_OP USING ERRCODE = 'insufficient_privilege';
END
$$ LANGUAGE plpgsql;
--> statement-breakpoint
CREATE TRIGGER audit_logs_append_only
  BEFORE UPDATE OR DELETE ON audit_logs
  FOR EACH ROW EXECUTE FUNCTION pcos_forbid_history_mutation();
--> statement-breakpoint
CREATE TRIGGER audit_logs_no_truncate
  BEFORE TRUNCATE ON audit_logs
  FOR EACH STATEMENT EXECUTE FUNCTION pcos_forbid_history_mutation();
