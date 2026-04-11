export type ContactSpamMarkAction = "MARK" | "UNMARK";

export const topicMyContactSpamMarkChanged = (userId: string) => `MY_CONTACT_SPAM_MARK_${userId}`;
export const topicMyContactSpamSettingsChanged = (userId: string) => `MY_CONTACT_SPAM_SETTINGS_${userId}`;

export type MyContactSpamMarkChangedPayload = {
  user_id: string;
  action: ContactSpamMarkAction;
  phone_normalized: string;
  contact_name?: string | null;
  source?: string | null;
  active: boolean;
  updated_at: string;
};

export type MyContactSpamSettingsChangedPayload = {
  user_id: string;
  mode: string;
  risk_threshold: number;
  sync_enabled: boolean;
  auto_mark_enabled: boolean;
  updated_at: string;
};