-- Synthetic dependencies ONLY. Run on the disposable bms_operations_test database.
DO $$ BEGIN IF current_database()<>'bms_operations_test' THEN RAISE EXCEPTION 'Disposable database required'; END IF; END $$;
CREATE EXTENSION IF NOT EXISTS pgcrypto;
DO $$ BEGIN CREATE ROLE bms_app NOLOGIN; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
CREATE TABLE IF NOT EXISTS bms_tenants(id uuid PRIMARY KEY,name text,slug text);
CREATE TABLE IF NOT EXISTS roles(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),name text UNIQUE);
INSERT INTO roles(name) VALUES('Administrator'),('Manager'),('Warehouse') ON CONFLICT DO NOTHING;
CREATE TABLE IF NOT EXISTS users(id uuid PRIMARY KEY,tenant_id uuid REFERENCES bms_tenants(id),name text,role_id uuid REFERENCES roles(id),pos_only boolean DEFAULT false);
CREATE TABLE IF NOT EXISTS bms_locations(id uuid PRIMARY KEY,tenant_id uuid REFERENCES bms_tenants(id),name text,code text,active boolean DEFAULT true,UNIQUE(tenant_id,id));
CREATE TABLE IF NOT EXISTS bms_kitchen_stations(id uuid PRIMARY KEY,tenant_id uuid REFERENCES bms_tenants(id),name text,location_id uuid,active boolean DEFAULT true);
CREATE TABLE IF NOT EXISTS bms_user_allowed_locations(tenant_id uuid,user_id uuid,location_id uuid);
CREATE TABLE IF NOT EXISTS bms_role_permissions(tenant_id uuid,role_id uuid,permission text,UNIQUE(tenant_id,role_id,permission));
CREATE TABLE IF NOT EXISTS bms_audit_log(id bigserial PRIMARY KEY,tenant_id uuid,actor text,action text,target text,meta jsonb);
CREATE TABLE IF NOT EXISTS files(id serial PRIMARY KEY,tenant_id uuid,filename text,original_name text,mimetype text,size bigint,checksum text,relpath text,visibility text,deleted_at timestamptz,created_at timestamptz DEFAULT now(),updated_at timestamptz DEFAULT now());
GRANT SELECT ON bms_tenants,roles,users,bms_locations,bms_kitchen_stations,bms_user_allowed_locations,bms_role_permissions TO bms_app;
-- Mirror 9.28: synthetic fixtures must not hide the real files permission boundary.
REVOKE SELECT ON files FROM bms_app;
GRANT SELECT,INSERT ON bms_audit_log TO bms_app;
GRANT USAGE,SELECT ON ALL SEQUENCES IN SCHEMA public TO bms_app;
