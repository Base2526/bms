export type BookmarkAction = "BOOKMARK" | "UNBOOKMARK";

export type BookmarkTargetType = "POST";

// Keep topics stable across services (HTTP publishes, WS subscribes)
export const topicMyBookmarkStatusChanged = (userId: string) => `MY_BOOKMARK_${userId}`;

export type MyBookmarkStatusChangedPayload = {
  user_id: string;
  action: BookmarkAction;
  target_type: BookmarkTargetType;
  target_id: string;
  bookmarked: boolean;
  updated_at: string;
};
