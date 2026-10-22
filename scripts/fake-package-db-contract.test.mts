import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';
import pg from '../apps/web/node_modules/pg/lib/index.js';

test('fake seeders obey the real package in disposable PostgreSQL', async t => {
  assert.ok(['localhost', '127.0.0.1'].includes(process.env.POSTGRES_HOST ?? ''));
  assert.equal(process.env.POSTGRES_DB, 'bms_freemium_test');
  const schema = `fake_package_${randomUUID().replaceAll('-', '')}`;
  const pool = new pg.Pool({ host: process.env.POSTGRES_HOST, port: Number(process.env.POSTGRES_PORT),
    database: process.env.POSTGRES_DB, user: process.env.POSTGRES_USER, password: process.env.POSTGRES_PASSWORD,
    options: `-c search_path=${schema},public` });
  const globals = globalThis as any, previous = globals.__bmsPostgresPool;
  globals.__bmsPostgresPool = pool;
  try {
    await pool.query(`CREATE SCHEMA ${schema}; GRANT USAGE ON SCHEMA ${schema} TO bms_app;
      CREATE TABLE bms_plans(code text PRIMARY KEY,name text,price_monthly numeric,max_products int,max_users int,
        max_channels int,max_branches int,max_devices int,max_orders_month int,max_ai_messages_month int,sort int);
      INSERT INTO bms_plans VALUES ('free','Free',0,100,2,1,1,1,-1,100,1),
        ('pro','Pro',599,-1,5,3,1,3,-1,1000,2),('business','Business',1990,-1,20,-1,5,10,-1,5000,3);
      CREATE TABLE bms_tenants(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),name text,slug text,plan text,
        capacity_policy_version int DEFAULT 2,feature_policy_version int DEFAULT 2);
      CREATE TABLE bms_store_profile(tenant_id uuid,business_type text,business_archetype text);
      CREATE TABLE bms_role_permissions(tenant_id uuid,role_id uuid,permission text);
      CREATE TABLE roles(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),name text);
      INSERT INTO roles(name) VALUES ('Administrator'),('Manager'),('Sales'),('Warehouse'),('Cashier'),('Pharmacist');
      CREATE TABLE users(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),tenant_id uuid,name text,username text,email text,phone text,
        role text,role_id uuid,password_hash text,meta jsonb,fake_test boolean,is_licensed_pharmacist boolean,
        pharmacist_license_no text,pos_pin_hash text,pos_pin_set_at timestamptz,pos_only boolean,created_at timestamptz);
      CREATE TABLE bms_locations(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),tenant_id uuid,code text,name text,
        branch_code text,is_head_office boolean,active boolean DEFAULT true,created_at timestamptz DEFAULT now());
      CREATE TABLE bms_products(tenant_id uuid,sku text,name text,active boolean,price numeric,keywords text[],image_url text,
        description text,cost_price numeric,category text,brand text,barcode text,PRIMARY KEY(tenant_id,sku));
      CREATE TABLE bms_product_sales_surfaces(tenant_id uuid,product_sku text,surface text,enabled boolean,
        updated_at timestamptz,PRIMARY KEY(tenant_id,product_sku,surface));
      CREATE TABLE bms_inventory(tenant_id uuid,location_id uuid,product_sku text,size text,current_stock int,reserved_stock int,reorder_point int);
      CREATE TABLE bms_product_packs(tenant_id uuid,product_sku text,size text,pack_code text,unit_name text,base_qty int,
        barcode text,price numeric,is_base boolean,active boolean);
      CREATE TABLE bms_pos_devices(tenant_id uuid,code text);
      CREATE TABLE bms_tenant_channels(tenant_id uuid,channel text);
      CREATE TABLE bms_orders(tenant_id uuid,created_at timestamptz);
      CREATE TABLE bms_report_subscriptions(tenant_id uuid);
      CREATE TABLE bms_audit_log(tenant_id uuid,actor text,action text,target text,meta jsonb);
      GRANT SELECT,INSERT,UPDATE ON ALL TABLES IN SCHEMA ${schema} TO bms_app;
      REVOKE INSERT,UPDATE ON users FROM bms_app;
      ALTER TABLE bms_products ENABLE ROW LEVEL SECURITY;
      CREATE POLICY tenant ON bms_products TO bms_app USING (tenant_id=current_setting('bms.tenant_id')::uuid)
        WITH CHECK (tenant_id=current_setting('bms.tenant_id')::uuid);`);
    const { provisionTestShop } = await import('../apps/web/lib/bms/testShop');
    const { seedFakeProducts, seedFakeStaff } = await import('../apps/web/lib/bms/devSeed');
    const { getFakeSeedPackage, fitFakeSeedCounts, missingFakeRecipeIngredients } = await import('../apps/web/lib/bms/devSeedPackage');
    const shops = new Map<string, any>();
    await t.test('new shops validate package, audit it, and reserve the owner slot', async () => {
      for (const code of ['free', 'pro', 'business']) {
        const shop = await provisionTestShop({ planCode: code, generatedBy: 'fixture-actor' });
        shops.set(code, shop);
        const budget = await getFakeSeedPackage(shop.tenantId);
        assert.equal(budget.plan.code, code);
        assert.equal(budget.users.used, 1);
        assert.equal(budget.users.remaining, { free: 1, pro: 4, business: 19 }[code]);
        assert.equal((await pool.query('SELECT meta FROM bms_audit_log WHERE tenant_id=$1', [shop.tenantId])).rows[0].meta.planCode, code);
      }
      await assert.rejects(provisionTestShop({ planCode: 'missing' }), /Unknown package/);
      assert.equal((await pool.query('SELECT count(*)::int n FROM bms_tenants')).rows[0].n, 3);
    });
    await t.test('full-shop counts fit every plan; restaurant reserves only missing ingredients', async () => {
      for (const [code, expected] of [['free',[1,100,1]], ['pro',[4,1000,3]], ['business',[19,1000,8]]] as const) {
        const shop = shops.get(code), budget = await getFakeSeedPackage(shop.tenantId);
        const fit = fitFakeSeedCounts({ staff: 49, products: 1000, posDevices: 8, orders: 10000 }, budget);
        assert.deepEqual([fit.staff, fit.products, fit.posDevices], expected);
        assert.equal(fit.orders, 10000);
      }
      const id = shops.get('free').tenantId;
      const ingredients = await missingFakeRecipeIngredients(id);
      assert.ok(ingredients > 0);
      const fit = fitFakeSeedCounts({ staff: 22, products: 500, posDevices: 3 }, await getFakeSeedPackage(id), ingredients);
      assert.equal(fit.products + ingredients, 100);
      await assert.rejects(seedFakeProducts(id, 100, 'restaurant', 'recipe'), /โควตา/);
      assert.equal((await getFakeSeedPackage(id)).products.used, 0);
    });
    await t.test('all product entry points deny over-limit batches without partial writes', async () => {
      const id = shops.get('free').tenantId;
      for (const archetype of [undefined, 'fashion', 'restaurant'] as const) {
        await assert.rejects(seedFakeProducts(id, 101, archetype), /โควตา/);
        assert.equal((await getFakeSeedPackage(id)).products.used, 0);
      }
      assert.equal((await seedFakeProducts(id, 98)).length, 98);
      const attempts = await Promise.allSettled([seedFakeProducts(id, 2), seedFakeProducts(id, 2, 'fashion')]);
      assert.equal(attempts.filter(result => result.status === 'fulfilled').length, 1);
      assert.equal((await getFakeSeedPackage(id)).products.used, 100);
      assert.equal((await getFakeSeedPackage(shops.get('pro').tenantId)).products.used, 0);
      assert.equal((await seedFakeProducts(shops.get('pro').tenantId, 101)).length, 101);
    });
    await t.test('staff batches include owner; parallel creation cannot exceed capacity', async () => {
      const id = shops.get('free').tenantId;
      await assert.rejects(seedFakeStaff(id, 2), /โควตา/);
      assert.equal((await getFakeSeedPackage(id)).users.used, 1);
      const attempts = await Promise.allSettled([seedFakeStaff(id, 1), seedFakeStaff(id, 1)]);
      assert.equal(attempts.filter(result => result.status === 'fulfilled').length, 1);
      assert.equal((await getFakeSeedPackage(id)).users.used, 2);
      assert.equal((await seedFakeStaff(shops.get('pro').tenantId, 4)).length, 4);
      await assert.rejects(seedFakeStaff(shops.get('pro').tenantId, 1), /โควตา/);
      await pool.query('UPDATE bms_tenants SET plan=$2 WHERE id=$1', [shops.get('pro').tenantId, 'free']);
      await assert.rejects(seedFakeStaff(shops.get('pro').tenantId, 1), /โควตา/);
      assert.equal((await getFakeSeedPackage(shops.get('pro').tenantId)).users.used, 5);
    });
    await t.test('Local and legacy preserve their exemptions; invalid counts never insert', async () => {
      const id = shops.get('free').tenantId;
      await pool.query('UPDATE bms_tenants SET capacity_policy_version=1 WHERE id=$1', [id]);
      assert.equal((await getFakeSeedPackage(id)).devices.limit, -1);
      await assert.rejects(seedFakeStaff(id, 1), /โควตา/);
      const saved = process.env.BMS_DEPLOYMENT_MODE;
      process.env.BMS_DEPLOYMENT_MODE = 'retail-local';
      try {
        assert.equal((await seedFakeProducts(id, 1)).length, 1);
        assert.equal((await seedFakeStaff(id, 1)).length, 1);
        assert.equal((await getFakeSeedPackage(id)).products.limit, -1);
      } finally { if (saved == null) delete process.env.BMS_DEPLOYMENT_MODE; else process.env.BMS_DEPLOYMENT_MODE = saved; }
      for (const count of [-1, 1.5, NaN]) {
        await assert.rejects(seedFakeProducts(id, count), /Invalid product count/);
        await assert.rejects(seedFakeStaff(id, count), /Invalid user count/);
      }
      assert.deepEqual(await seedFakeProducts(id, 0), []);
      assert.deepEqual(await seedFakeStaff(id, 0), []);
    });
  } finally {
    globals.__bmsPostgresPool = previous;
    assert.match(schema, /^fake_package_[a-f0-9]{32}$/);
    await pool.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);
    await pool.end();
  }
});
