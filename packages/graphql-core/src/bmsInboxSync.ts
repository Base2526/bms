export type BmsInboxChangedPayload = {
  tenantId: string;
  conversationId: string;
  kind: "MESSAGES_CHANGED" | "CONVERSATION_CHANGED";
  occurredAt: string;
};

/**
 * One Redis topic per tenant keeps inbox traffic isolated and avoids waking
 * operators from unrelated shops. Authorization is still enforced by the
 * subscription resolver before this topic is opened.
 */
export function topicBmsInboxChanged(tenantId: string): string {
  return `BMS_INBOX_CHANGED:${tenantId}`;
}
