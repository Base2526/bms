# Public product pages

> Entry point: [CLAUDE.md](../../CLAUDE.md) · Product rules: [../business/inventory.md](../business/inventory.md) · Inbox UX: [customer360.md](customer360.md)

The no-login customer URL is:

```text
/shop/{tenantSlug}/products/{sku}
```

`getPublicProduct(tenantSlug, sku)` in `apps/web/lib/bms/products.ts` is the single read service for
this route. It uses parameterized values and returns a result only when both `bms_tenants.active`
and `bms_products.active` are true. Unknown, inactive, and overlong identifiers all resolve as a
normal 404.

## Public fields

The page may show shop name/slug/logo/contact website/phone and these sale-safe product fields:

- name, SKU, selling price, description, brand, and category;
- ordered product gallery with `image_url` retained as the cover fallback;
- available quantity per size, calculated as `current_stock - reserved_stock`.

It must not expose cost price, barcode, reserved-stock quantity, tenant IDs, file-system paths,
admin URLs, or inactive products. The page is dynamically rendered so stock reflects the time the
customer opens it. Product metadata includes canonical/Open Graph/Twitter fields and Product JSON-LD.

## Inbox sharing

The Inbox gets the active tenant slug from `bmsMe.tenant` or `bmsActingTenant` for platform-admin
drill-down. Selecting a product stages an absolute public URL in the editable composer draft:

- **ข้อความ + ลิงก์** sends no attachment;
- **ข้อความ + รูป + ลิงก์** uses only the cover as the existing single attachment;
- **ดูหน้า Public** lets staff preview the customer page in a new tab;
- **เปิดหน้า Products เต็มจอ** remains an internal `/admin/products` link and is never included in
  customer text.

Sending every gallery image automatically is intentionally avoided. Channel media limits differ,
multiple sends make the conversation noisy, and the current cross-channel message contract supports
one attachment. The customer can inspect all images on the public page.

## Stable URL warning

`bms_tenants.slug` is now a public routing handle. The Settings UI keeps it read-only. The mutation
still accepts controlled slug changes, but changing a slug invalidates previously shared product
URLs; any future editable-slug workflow needs redirects or aliases first.
