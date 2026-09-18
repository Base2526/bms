# POS client core

Dependency-free client behaviour shared by the native iOS/Android POS and the desktop renderer.
It contains navigation transitions, operation timeout/idempotency helpers, and payment-form maths.

This package is not a business-rules layer. Prices, permissions, inventory, shifts, tenders, and
settlement remain authoritative in the BMS backend. Client calculations exist only to present and
validate the cashier form before the server recomputes and commits the transaction.
