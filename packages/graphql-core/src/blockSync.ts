export type BlockAction = "BLOCK" | "UNBLOCK";

// Keep topics stable across services (HTTP publishes, WS subscribes)
export const topicMyPhoneBlockStatusChanged = (userId: string) => `MY_PHONE_BLOCK_${userId}`;
export const topicMyBankBlockStatusChanged = (userId: string) => `MY_BANK_BLOCK_${userId}`;

export type MyPhoneBlockStatusChangedPayload = {
  user_id: string;
  action: BlockAction;
  phone: string;
  phone_normalized: string;
  blocked: boolean;
  updated_at: string;
};

export type MyBankBlockStatusChangedPayload = {
  user_id: string;
  action: BlockAction;
  bank_name: string;
  account_norm: string;
  blocked: boolean;
  updated_at: string;
};
