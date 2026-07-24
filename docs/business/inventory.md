# Inventory & Purchase

> Entry point: [CLAUDE.md](../../CLAUDE.md) · Tools: [../ai/tools.md](../ai/tools.md) · Data: `bms_inventory`, `bms_stock_movements`, `bms_purchase_orders` ([../architecture/database.md](../architecture/database.md))

Inventory is the source of truth. Never update stock directly — always go through the Inventory
Service (`lib/bms/stock.ts`, `lib/bms/movements.ts`).

```
Current Stock = Available Stock + Reserved Stock
Available Stock = Current Stock − Reserved Stock
```

Every stock change **must** generate a Stock Movement record. Never update inventory without
logging movement.

## Movement types (`bms_stock_movements.type`)

| Type | Meaning |
| --- | --- |
| `STOCK_IN` | Manual adjustment increase, or receiving a Purchase Order |
| `STOCK_OUT` | Manual adjustment decrease |
| `RESERVE` | Order created (reserve stock) |
| `RELEASE` | Order cancelled or auto-released (return reservation) |
| `SHIP` | Order shipped (permanent deduction: current −= qty, reserved −= qty) |
| `RETURN` | Goods returned (stock re-added) |

`TRANSFER` / `ADJUSTMENT` / `DAMAGED` are roadmap types — adjustments are currently recorded as
plain `STOCK_IN`/`STOCK_OUT`.

## Product rules

- SKU must be unique; barcode should be unique.
- Inactive products cannot be sold.
- Price cannot be negative; stock cannot go negative unless `AllowNegativeStock` is enabled.
- **Implemented product detail** (`bms_products`, migration `5.9`): `image_url` (upload via
  `/api/bms/products/upload`, ≤10MB, images only), `description`, `cost_price` (used to compute
  `price − cost_price` margin in the Products page — not yet rolled into Reports), free-text
  `category`/`brand` with autocomplete from prior values used in the shop.
- **Implemented product gallery** (`bms_product_images`, migration `6.5`): one product can now
  store multiple uploaded images in display order. `image_url` still acts as the primary cover
  image for backward compatibility; the current Products UI sends both `image_url` and
  `image_urls[]`.
- Categories are a managed list (`bms_product_categories`, migration `6.0`) that the shop can edit
  from a dropdown; renaming a category syncs to products referencing the old name in one
  transaction. Deleting a category does not delete products, only removes it from the dropdown.

## Bulk product import (CSV/XLSX)

**Implemented** — `/admin/products` "นำเข้า" button opens `ImportModal.tsx`, which parses the file
entirely client-side (`xlsx`/SheetJS, handles both `.csv` and `.xlsx`) and drives a two-step
preview-then-commit flow over a single GraphQL mutation:

```
Mutation.bmsImportProducts(items: [BmsProductImportRowInput!]!, commit: Boolean = false): BmsProductImportResult!
```

- `commit: false` (preview, the default) validates every row and returns a per-row
  `CREATE` / `UPDATE` / `ERROR` verdict **without writing to the database**.
- `commit: true` re-runs the identical validation, then writes only the non-error rows by looping
  the existing `upsertProduct()` (`lib/bms/products.ts`) once per row — bulk import does not
  duplicate product-write logic, it wraps the same single-item path used by the manual product form.
- Both modes share one validator, `validateProductFields()` (extracted out of `upsertProduct` for
  this purpose), so preview and commit can never drift apart.

**Rules enforced by `lib/bms/productImport.ts` (`runImport()`):**

- **Row limit**: 500 rows per import (`PRODUCT_IMPORT_MAX_ROWS`), enforced both client-side (before
  ever calling the mutation) and again in the resolver (defense in depth against a direct GraphQL
  call). A 5MB file-size gate on the client protects against parsing a huge file before the row
  count can even be checked.
- **Images are never imported.** The template has no image column; if a hand-edited file includes
  one anyway it is silently ignored rather than rejecting the whole file. Add images afterward from
  the normal product edit form.
- **Duplicate SKUs within the same file**: first occurrence wins; every later row with the same SKU
  is flagged as an `ERROR` row ("SKU ซ้ำกับแถวที่ N ในไฟล์นี้") rather than silently skipped or
  silently overwritten.
- **CREATE vs UPDATE** is decided with one batched `sku = ANY($2)` lookup against the tenant's
  existing products (not one query per row).
- **Quota is all-or-nothing, not first-N-rows-win.** If `current product count + new-SKU count`
  would exceed the plan's `max_products`, the entire commit is blocked (`quotaExceeded: true` +
  a Thai summary message) rather than silently importing only as many new SKUs as fit. The preview's
  quota check is advisory (point-in-time); commit remains authoritative because it still calls the
  real `upsertProduct()` per row, which still calls `enforceProductQuota()` fresh — a late-arriving
  over-quota row (e.g. a race with another admin) still surfaces as a per-row commit error even if
  the preview looked fine a moment earlier.
- **Permission**: reuses `product.edit` (the same permission that gates the single-item
  `bmsUpsertProduct`) — no separate import permission was added.
- **Revision grouping**: one `revisionId` (UUID) is generated per import call and threaded through
  every `upsertProduct()` call during commit, so an update-heavy import's revision snapshots share
  one `revision_id` and can be queried as a batch. Revision triggers only fire on `UPDATE`, not
  `INSERT` (`db/migrations/7.0__bms_revision_helpers.sql`), so a 100%-new-SKU import produces zero
  revision rows.
- **Audit**: one `audit(ctx, "product.import", ...)` call per commit with row-count summaries in
  `meta`, not one row per imported product — only logged on `commit:true`, never on preview.

Template columns (Thai headers, matched by trimmed/case-insensitive text so a reordered or
hand-edited sheet still parses): `SKU` / `บาร์โค้ด` / `ชื่อสินค้า` / `รายละเอียด` / `ราคาขาย` /
`ต้นทุน` / `หมวดหมู่` / `ยี่ห้อ` / `คีย์เวิร์ด` (`|` or `,` separated) / `เปิดขาย` (`TRUE`/`FALSE`,
blank defaults to `true`). `SKU`/`ชื่อสินค้า`/`ราคาขาย` are required; if any is missing from the
header row the whole file is rejected up front with a message to re-download the template.

## Purchase Orders (supplier replenishment)

**Implemented** (`bms_purchase_orders.status`):

```
OPEN → PARTIAL → RECEIVED
     ↘ CANCELLED
```

Receiving goods automatically increases inventory (`STOCK_IN` movement) and recalculates PO status
to `PARTIAL` or `RECEIVED` depending on how much of the ordered quantity has arrived. A cancelled PO
cannot receive further — and cancelling never claws back stock already received (standard inventory
accounting: what's received stays received).

Permissions: `purchase.view` / `purchase.edit` / `purchase.receive` / `purchase.cancel`.
