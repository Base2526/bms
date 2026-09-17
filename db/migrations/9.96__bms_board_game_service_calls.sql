-- Board-game guest service bell. A request is operational work only: it never changes
-- play time, a bill, stock, or a game-copy condition by itself.

CREATE TABLE IF NOT EXISTS bms_board_game_guest_tokens (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES bms_tenants(id) ON DELETE CASCADE,
  location_id UUID NOT NULL,
  session_id UUID NOT NULL,
  public_token TEXT NOT NULL,
  public_token_hash TEXT NOT NULL,
  active BOOLEAN NOT NULL DEFAULT TRUE,
  created_by UUID REFERENCES users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  revoked_at TIMESTAMPTZ,
  UNIQUE (tenant_id, id),
  UNIQUE (public_token_hash),
  FOREIGN KEY (tenant_id, session_id)
    REFERENCES bms_board_game_sessions(tenant_id, id) ON DELETE CASCADE
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_bms_board_game_guest_tokens_active_session
  ON bms_board_game_guest_tokens (tenant_id, session_id) WHERE active;

CREATE TABLE IF NOT EXISTS bms_board_game_service_calls (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES bms_tenants(id) ON DELETE CASCADE,
  location_id UUID NOT NULL,
  session_id UUID NOT NULL,
  guest_token_id UUID NOT NULL,
  table_id_at_request UUID NOT NULL,
  request_code TEXT NOT NULL CHECK (request_code IN (
    'GAME_HELP', 'GAME_ISSUE', 'FOOD_DRINK', 'BILL', 'EXTEND_TIME', 'CLEANUP', 'OTHER'
  )),
  request_note TEXT CHECK (request_note IS NULL OR length(btrim(request_note)) BETWEEN 3 AND 200),
  status TEXT NOT NULL DEFAULT 'PENDING' CHECK (status IN (
    'PENDING', 'ACKNOWLEDGED', 'COMPLETED', 'EXPIRED'
  )),
  idempotency_key TEXT NOT NULL CHECK (length(idempotency_key) BETWEEN 8 AND 120),
  acknowledged_by UUID REFERENCES users(id),
  acknowledged_at TIMESTAMPTZ,
  completed_by UUID REFERENCES users(id),
  completed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, id),
  UNIQUE (tenant_id, guest_token_id, idempotency_key),
  FOREIGN KEY (tenant_id, session_id)
    REFERENCES bms_board_game_sessions(tenant_id, id) ON DELETE CASCADE,
  FOREIGN KEY (tenant_id, guest_token_id)
    REFERENCES bms_board_game_guest_tokens(tenant_id, id) ON DELETE CASCADE,
  FOREIGN KEY (tenant_id, table_id_at_request)
    REFERENCES bms_board_game_tables(tenant_id, id),
  CHECK (request_code <> 'OTHER' OR request_note IS NOT NULL),
  CHECK (
    (status = 'PENDING' AND acknowledged_at IS NULL AND acknowledged_by IS NULL)
    OR (status IN ('ACKNOWLEDGED', 'COMPLETED') AND acknowledged_at IS NOT NULL AND acknowledged_by IS NOT NULL)
    OR status = 'EXPIRED'
  ),
  CHECK (
    (status = 'COMPLETED' AND completed_at IS NOT NULL AND completed_by IS NOT NULL)
    OR (status IN ('PENDING', 'ACKNOWLEDGED') AND completed_at IS NULL)
    OR status = 'EXPIRED'
  )
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_bms_board_game_service_calls_active_session
  ON bms_board_game_service_calls (tenant_id, session_id)
  WHERE status IN ('PENDING', 'ACKNOWLEDGED');
CREATE INDEX IF NOT EXISTS idx_bms_board_game_service_calls_board
  ON bms_board_game_service_calls (tenant_id, location_id, status, created_at)
  WHERE status IN ('PENDING', 'ACKNOWLEDGED');

ALTER TABLE bms_board_game_guest_tokens ENABLE ROW LEVEL SECURITY;
ALTER TABLE bms_board_game_guest_tokens FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS bms_board_game_guest_tokens_tenant_isolation ON bms_board_game_guest_tokens;
CREATE POLICY bms_board_game_guest_tokens_tenant_isolation ON bms_board_game_guest_tokens
  USING (tenant_id = COALESCE(NULLIF(current_setting('bms.tenant_id', true), '')::uuid, tenant_id))
  WITH CHECK (tenant_id = COALESCE(NULLIF(current_setting('bms.tenant_id', true), '')::uuid, tenant_id));
ALTER TABLE bms_board_game_service_calls ENABLE ROW LEVEL SECURITY;
ALTER TABLE bms_board_game_service_calls FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS bms_board_game_service_calls_tenant_isolation ON bms_board_game_service_calls;
CREATE POLICY bms_board_game_service_calls_tenant_isolation ON bms_board_game_service_calls
  USING (tenant_id = COALESCE(NULLIF(current_setting('bms.tenant_id', true), '')::uuid, tenant_id))
  WITH CHECK (tenant_id = COALESCE(NULLIF(current_setting('bms.tenant_id', true), '')::uuid, tenant_id));

GRANT SELECT, INSERT, UPDATE ON bms_board_game_guest_tokens TO bms_app;
GRANT SELECT, INSERT, UPDATE ON bms_board_game_service_calls TO bms_app;
SELECT public.create_revision_trigger('bms_board_game_guest_tokens');
SELECT public.create_revision_trigger('bms_board_game_service_calls');

CREATE OR REPLACE FUNCTION public.bms_board_game_expire_guest_calls()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.status IN ('PAID', 'CANCELLED') AND OLD.status IS DISTINCT FROM NEW.status THEN
    UPDATE bms_board_game_guest_tokens
       SET active = FALSE, revoked_at = COALESCE(revoked_at, now())
     WHERE tenant_id = NEW.tenant_id AND session_id = NEW.id AND active;
    UPDATE bms_board_game_service_calls
       SET status = 'EXPIRED', completed_at = now(), updated_at = now()
     WHERE tenant_id = NEW.tenant_id AND session_id = NEW.id
       AND status IN ('PENDING', 'ACKNOWLEDGED');
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_bms_board_game_expire_guest_calls ON bms_board_game_sessions;
CREATE TRIGGER trg_bms_board_game_expire_guest_calls
AFTER UPDATE OF status ON bms_board_game_sessions
FOR EACH ROW EXECUTE FUNCTION public.bms_board_game_expire_guest_calls();

CREATE OR REPLACE FUNCTION public.bms_realtime_board_game_service_call_trigger()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
BEGIN
  PERFORM public.bms_emit_realtime_event(
    CASE WHEN TG_OP = 'INSERT' THEN 'board_game.table_call.created' ELSE 'board_game.table_call.status_changed' END,
    NEW.tenant_id, NEW.location_id, NULL, 'board_game_table_call', NEW.id::text, NULL, NEW.updated_at,
    jsonb_strip_nulls(jsonb_build_object('status', NEW.status,
      'previousStatus', CASE WHEN TG_OP = 'UPDATE' THEN OLD.status ELSE NULL END)));
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_bms_realtime_board_game_service_call ON bms_board_game_service_calls;
CREATE TRIGGER trg_bms_realtime_board_game_service_call
AFTER INSERT OR UPDATE OF status ON bms_board_game_service_calls
FOR EACH ROW EXECUTE FUNCTION public.bms_realtime_board_game_service_call_trigger();

ALTER FUNCTION public.bms_realtime_board_game_service_call_trigger() OWNER TO bms_realtime_dispatcher;
