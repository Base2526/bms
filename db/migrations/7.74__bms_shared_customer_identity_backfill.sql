-- Keep commerce and pharmacy records on the same canonical CRM customer.
-- Runtime linking in customers.ts repairs each identity when it is used; this
-- migration repairs historical rows immediately after deployment.

CREATE INDEX IF NOT EXISTS idx_bms_orders_customer_identity
  ON bms_orders (tenant_id, channel, customer_ref, created_at DESC);

UPDATE bms_orders orders
   SET customer_id = identity.customer_id,
       updated_at = now()
  FROM bms_customer_identities identity
 WHERE orders.tenant_id = identity.tenant_id
   AND orders.channel = identity.channel
   AND orders.customer_ref = identity.external_ref
   AND orders.customer_id IS NULL;

UPDATE bms_conversations conversation
   SET customer_id = identity.customer_id,
       updated_at = now()
  FROM bms_customer_identities identity
 WHERE conversation.tenant_id = identity.tenant_id
   AND conversation.channel = identity.channel
   AND conversation.customer_ref = identity.external_ref
   AND conversation.customer_id IS NULL;

UPDATE bms_restock_subscriptions subscription
   SET customer_id = identity.customer_id,
       updated_at = now()
  FROM bms_customer_identities identity
 WHERE subscription.tenant_id = identity.tenant_id
   AND subscription.channel = identity.channel
   AND subscription.customer_ref = identity.external_ref
   AND subscription.customer_id IS NULL;

UPDATE bms_pharmacy_assessments assessment
   SET customer_id = conversation.customer_id,
       updated_at = now()
  FROM bms_conversations conversation
 WHERE assessment.tenant_id = conversation.tenant_id
   AND assessment.conversation_id = conversation.id
   AND assessment.customer_id IS NULL
   AND conversation.customer_id IS NOT NULL;
