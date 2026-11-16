# Verified shop owner repair after a live statement timeout

Migration `10.121__bms_verified_shop_owner_administrator.sql` may be canceled by a
database session's `statement_timeout` while reading historical signup and audit
evidence. The subsequent `current transaction is aborted` message is a consequence
of that timeout, not another eligibility failure.

1. In the **same HeidiSQL connection** that failed, execute `ROLLBACK;` as the only
   selected statement. If the transaction already ended, PostgreSQL may say there
   was no transaction to roll back.
2. Confirm the current limit with `SHOW statement_timeout;`. Do not rerun the old
   file in the failed transaction.
3. Apply `db/migrations/10.128__bms_verified_shop_owner_repair_retry.sql` as one
   migration. It has no dependency on the intervening factory migrations, so it
   can be run by itself on the affected live database. It preserves every
   `10.121` eligibility guard and commits the role
   change with its audit row. Its `SET LOCAL` settings allow two minutes for the
   statement and stop a lock wait after five seconds; they expire at transaction end.
   A transaction advisory lock prevents two copies of this retry from racing.
4. Confirm that the migration reached `COMMIT` without an error. This read-only
   count shows how many owners this retry changed (zero is valid):

   ```sql
   SELECT count(*) AS repaired_by_retry
   FROM bms_audit_log
   WHERE actor = 'migration:10.128'
     AND action = 'shop.signup.owner_role_repaired';
   ```

If the retry ends in a timeout or lock error, execute `ROLLBACK;` separately again
and inspect the **first** error. Do not widen the owner criteria or activate roles
to make the script pass. Investigate the live query plan and blockers before another
retry. Existing `10.121` files must not be changed: the Retail Local migration
ledger rejects a checksum mismatch for a previously applied migration.
