import { JWT } from "google-auth-library";

export type FcmSendOptions = {
  projectId: string;
  clientEmail: string;
  privateKey: string;
};

export type ChatPushPayload = {
  type: "chat_message";
  conversationId: string; // chat_id
  messageId: string;
  senderId: string;
  senderName?: string | null;
  preview?: string | null;
  unreadCount?: number | null;
  deepLink: string;
  webUrl: string;
  timestamp: string;
};

function normalizePrivateKey(raw: string) {
  // env often stores newlines as \n
  return raw.replace(/\\n/g, "\n");
}

export async function sendFcmChatPush(
  opts: FcmSendOptions,
  params: {
    token: string;
    notification: { title: string; body?: string };
    data: ChatPushPayload;
    android?: { channelId?: string; collapseKey?: string; tag?: string; ttlSeconds?: number };
  }
): Promise<{ ok: true } | { ok: false; status: number; body: any } | { ok: false; error: any }> {
  try {
    const auth = new JWT({
      email: opts.clientEmail,
      key: normalizePrivateKey(opts.privateKey),
      scopes: ["https://www.googleapis.com/auth/firebase.messaging"],
    });

    const accessToken = await auth.getAccessToken();
    const bearer = accessToken?.token;
    if (!bearer) {
      return { ok: false, error: { message: "Missing FCM access token" } };
    }

    const url = `https://fcm.googleapis.com/v1/projects/${opts.projectId}/messages:send`;

    const ttlSeconds = params.android?.ttlSeconds ?? 60 * 60; // 1h

    const res = await fetch(url, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${bearer}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        message: {
          token: params.token,
          notification: {
            title: params.notification.title,
            body: params.notification.body ?? "",
          },
          data: {
            ...params.data,
            unreadCount:
              params.data.unreadCount == null ? "" : String(params.data.unreadCount),
          } as any,
          android: {
            collapse_key: params.android?.collapseKey ?? "chat_message",
            notification: {
              channel_id: params.android?.channelId ?? "chat_messages",
              tag: params.android?.tag ?? params.data.conversationId,
              // shows number badge in supported launchers
              notification_count:
                params.data.unreadCount == null
                  ? undefined
                  : Math.max(0, Number(params.data.unreadCount) || 0),
            },
            ttl: `${ttlSeconds}s`,
          },
        },
      }),
    });

    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      return { ok: false, status: res.status, body };
    }

    return { ok: true };
  } catch (error) {
    return { ok: false, error };
  }
}
