# Verified shop owner repair after a live statement timeout

The original `10.121__bms_verified_shop_owner_administrator.sql` could be
canceled by a database session's `statement_timeout` while reading historical
signup and audit evidence. The later `current transaction is aborted` message
only means that the connection is still inside the failed transaction.

## Ordered HeidiSQL rollout

1. In the **same HeidiSQL connection** that failed, execute `ROLLBACK;` as the
   only selected statement. If the transaction already ended, PostgreSQL may
   say there was no transaction to roll back.
2. Confirm the current limit with `SHOW statement_timeout;` and apply the
   current `db/migrations/10.121__bms_verified_shop_owner_administrator.sql`
   at its normal place in the numbered sequence. It sets a two-minute
   `statement_timeout` and five-second `lock_timeout` only inside its
   transaction. It keeps all verified-owner eligibility guards and commits
   the role change with the audit row. No global database setting changes.
3. Continue in numeric order. `10.128__bms_verified_shop_owner_repair_retry.sql`
   repeats the same guarded repair; zero rows is the expected outcome after
   a successful `10.121`. Both scripts serialize retries with a transaction
   advisory lock.
4. Confirm each script reached `COMMIT` without an error. These read-only counts
   show how many owners were changed by each file (zero is valid):

   ```sql
   SELECT actor, count(*) AS repaired
   FROM bms_audit_log
   WHERE actor IN ('migration:10.121', 'migration:10.128')
     AND action = 'shop.signup.owner_role_repaired'
   GROUP BY actor ORDER BY actor;
   ```

If either file ends in a timeout or lock error, execute `ROLLBACK;` separately
again and inspect the **first** error. Investigate the live query plan and
blockers before another retry; never widen the owner criteria or activate
roles to make a migration pass.

## Existing Retail Local installations

Retail Local records the checksum of each applied migration. Its runner accepts
only the two known pre-timeout checksums of `10.121` (LF and CRLF) when that
file was already applied. It preserves that old ledger value and skips the
file; `10.128` then performs the idempotent catch-up. A fresh installation
applies the bounded `10.121` in order, then `10.128` as a no-op. All other SQL
content changes remain a checksum error.
