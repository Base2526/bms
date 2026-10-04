# Product Barcode Lookup

The admin product form uses its existing Barcode field, above images and SKU. A scan or Enter
looks up the code; Enter never submits the product form. Typing pauses for 650 ms before lookup.
The search button explicitly retries. Lookup itself never writes a product.

## Shop Catalog

`GET /api/bms/products/barcode-lookup?code=...` requires `product.edit` through
`authorizeAdminRoute`. Tenant identity comes only from the authenticated session. The service
uses `beginTenantTx` and explicit tenant predicates on both products and packs. It includes
inactive products and searches the database, not just the currently loaded catalog page.

Exact product and pack barcodes are checked first, including equivalent zero-padded GTIN
representations. A case-level GTIN is never converted into its unit barcode. Opening an existing
product asks before discarding the current draft. Product saves also check other products/pack
barcodes under the existing tenant lock. This is not a replacement for barcode constraints or
a change to POS pack resolution.

## External Lookup

The adapter implements [Barcode Lookup API v3](https://www.barcodelookup.com/api-documentation).
Set the **server-only** `BMS_BARCODE_LOOKUP_API_KEY` in the deployment secret configuration and
restart the web service to enable it. Do not use a `NEXT_PUBLIC_` variable. No account is created,
subscription purchased, secret populated, or external service enabled by this change. Confirm
the provider plan, permitted reuse of data/images, and coverage with real shop products before
enabling it. No paid live-provider verification is claimed without configured credentials.

Without the key, local lookup works and the UI explicitly reports that external lookup is not
connected. It does not misleadingly report that an external database found no match.

Only checksum-valid GTIN-8/12/13/14 identifiers are sent, never tenant/customer details. In-store
EAN-13 restricted-circulation codes (20-29), including their zero-padded form, stay local. GS1
Digital Link QR paths beginning `/01/<GTIN-14>` are parsed locally; scanned URLs are **never
fetched**, and lot/serial data is not saved as a product barcode. Other QR content is unsupported.
Zero-padded unit identifiers from Digital Link are stored in their ordinary EAN/UPC spelling so
the existing POS exact scan can find them. Nonzero case indicators remain GTIN-14; no pack ratio
is inferred. The browser sends only the parsed identifier, never the scanned URL, to lookup.

The API endpoint is fixed, redirects are refused, responses are limited to 256 KiB, and requests
time out after five seconds. Provider errors/URLs are not exposed or logged because the provider
uses a query-string API key. Lookups are limited per acting shop/admin, with a separate global
provider ceiling (30/minute each). No provider payload is cached or written to the database by
lookup. Only an exact, unambiguous returned GTIN is accepted; related products are not guesses.
Only HTTPS images hosted on `images.barcodelookup.com` are offered.

## Applying Suggestions

The result shows the source link, name, brand, size and image when available. **Fill empty fields**
fills name, brand and description only when blank, and a picture only when no picture/upload is
present. On a new product only, a suggested size can replace the untouched initial `STD` option;
existing or edited variants are preserved. Size is a catalog option, not a pack conversion.

SKU, price, cost, inventory, shipping weight, tax, stock policy, base units and pack ratios are
never inferred. The user must review and use the normal Save action. Changing the barcode cancels
pending lookup and clears the suggestion; late responses and modal close cannot fill another
draft. Operator-edited fields are not silently replaced by another scan.
When the barcode changes, unchanged fields/pictures supplied by the previous lookup are removed
(and the previous default size is restored). Operator edits and other uploaded pictures remain.
Delayed code-generation and product-open responses cannot overwrite a newer/closed draft.
The in-store code generator checks both product and pack barcodes, including padded codes.

No migration or desktop-shell rebuild is required; deploy the updated web service. Automated
provider tests use fixtures, not billed live calls.
