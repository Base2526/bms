import { query, runInTransaction } from "@/lib/db";
import { publishRealtimeHint } from "@/lib/pubsub";
import { v4 as uuidv4 } from 'uuid';

const NOTI_TOPIC = 'NOTIFICATION_CREATED';

type CreateNotificationInput = {
  user_id: string;
  type: string;
  title: string;
  message: string;
  entity_type: string; // 'chat' | 'post' | ...
  entity_id: string;
  data?: any;
};

export async function createNotification(input: CreateNotificationInput) {
  const id = uuidv4();

  const { rows } = await query(
    `
    INSERT INTO notifications (
      id,
      user_id,
      type,
      title,
      message,
      entity_type,
      entity_id,
      data
    )
    VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
    RETURNING
      id,
      user_id,
      type,
      title,
      message,
      entity_type,
      entity_id,
      data,
      is_read,
      created_at
    `,
    [
      id,
      input.user_id,
      input.type,
      input.title,
      input.message,
      input.entity_type,
      input.entity_id,
      input.data ?? null,
    ]
  );

  const notification = rows[0];

  // broadcast ไป subscription
  await publishRealtimeHint(NOTI_TOPIC, {
    notificationCreated: notification,
  });

  return notification;
}
