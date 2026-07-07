// register.server.ts
import { postBus, type PostEventPayload } from "./postBus";
import type { SocialJob } from "@social/types";

const g = globalThis as any;
if (!g.__jachoei_post_listeners__)
  g.__jachoei_post_listeners__ = { started: false, starting: false, bus: null as any };

function absolutizeUrl(u: string | null | undefined) {
  const s = String(u ?? "").trim();
  if (!s) return null;
  if (s.startsWith("http://") || s.startsWith("https://")) return s;

  // ใช้ BASE URL ของเว็บ เพื่อทำให้ /api/files/xxx กลายเป็น absolute
  const base = (process.env.NEXT_PUBLIC_BASE_URL ?? process.env.BASE_URL ?? "").replace(/\/+$/, "");
  if (!base) return s; // ถ้าไม่มี base ก็คืนค่าเดิมไปก่อน (อย่างน้อยไม่พัง)

  if (s.startsWith("/")) return `${base}${s}`;
  return `${base}/${s}`;
}

function mapImages(e: PostEventPayload) {
  const imgs = Array.isArray(e.images) ? e.images : [];
  return imgs
    .map((img: any) => {
      const url = absolutizeUrl(img?.url);
      if (!url) return null;
      return {
        id: img?.id ?? null,
        url,
        relpath: img?.relpath ?? null,
      };
    })
    .filter(Boolean);
}

/**
 * ✅ NEW: map tel_numbers from event payload -> job.post.tel_numbers
 * - ส่ง "final state" (id, tel)
 * - trim/normalize tel
 */
function mapTelNumbers(e: PostEventPayload) {
  const arr: any[] = Array.isArray((e as any)?.tel_numbers) ? ((e as any).tel_numbers as any[]) : [];
  return arr
    .map((t: any) => {
      const tel = String(t?.tel ?? "").trim();
      if (!tel) return null;
      return {
        id: t?.id ?? null,
        tel,
      };
    })
    .filter(Boolean);
}

export async function registerPostEventListeners() {
  console.error(
    "[events] registerPostEventListeners() called. started =",
    g.__jachoei_post_listeners__.started,
    "sameBus=",
    g.__jachoei_post_listeners__.bus === postBus
  );

  if (g.__jachoei_post_listeners__.started && g.__jachoei_post_listeners__.bus === postBus) return;
  if (g.__jachoei_post_listeners__.starting) return;

  g.__jachoei_post_listeners__.starting = true;

  try {
    const { createRedis, enqueueSocialJob, ensureRedis, QUEUE_KEY } = await import("@social/queue.server");
    const redis = createRedis();
    await ensureRedis(redis);

    console.error("[events] redis ping OK, queueKey =", QUEUE_KEY);

    const buildJobs = (action: SocialJob["action"], e: PostEventPayload): SocialJob[] => {
      const images = mapImages(e);
      const tel_numbers = mapTelNumbers(e);

      // ✅ รวม field ตาม post ที่อยากส่งไป worker (เพิ่มได้)
      const postPayload: any = {
        postId: e.postId,
        title: e.title ?? null,
        summary: e.summary ?? null,
        url: e.url ?? null,

        // ✅ support image
        images,

        // ✅ NEW: ส่ง tel_numbers ให้ worker
        tel_numbers,

        // (optional) fields อื่น ๆ ถ้าคุณอยากให้ worker ใช้
        status: e.status ?? null,
        website: e.website ?? null,
        detail: e.detail ?? null,
        auto_publish: e.auto_publish ?? null,
        transfer_amount: e.transfer_amount ?? null,
        transfer_date: e.transfer_date ?? null,
        province_id: e.province_id ?? null,
      };

      return [
        {
          platform: "facebook",
          action,
          eventId: e.eventId,
          post: postPayload,
          meta: { 
            actorId: e.actorId ?? undefined, 
            revisionId: e.revisionId ?? undefined 
          },
          attempts: 0,
          maxAttempts: 8,
        },
        // {
        //   platform: "x",
        //   action,
        //   eventId: e.eventId,
        //   post: postPayload,
        //   meta: { actorId: e.actorId, revisionId: e.revisionId },
        //   attempts: 0,
        //   maxAttempts: 8,
        // },
      ];
    };

    const onEvent =
      (name: string, action: SocialJob["action"]) =>
      async (e: PostEventPayload) => {
        const telCount = Array.isArray((e as any)?.tel_numbers) ? ((e as any).tel_numbers as any[]).length : 0;

        console.error(
          "[events] caught",
          name,
          "eventId=",
          e.eventId,
          "images=",
          e.images?.length ?? 0,
          "tel_numbers=",
          telCount
        );

        for (const j of buildJobs(action, e)) {
          try {
            await enqueueSocialJob(redis, j);

            console.error(
              "[events] enqueued",
              j.platform,
              j.action,
              j.eventId,
              // "images=",
              // j.post?.images?.length ?? 0,
              // "tel_numbers=",
              // j.post?.tel_numbers?.length ?? 0
            );
          } catch (err: any) {
            console.error("[events] enqueue FAILED", j.platform, j.eventId, err?.message ?? err);
          }
        }
      };

    postBus.removeAllListeners("post.created");
    postBus.removeAllListeners("post.updated");
    postBus.removeAllListeners("post.deleted");

    postBus.on("post.created", onEvent("post.created", "create"));
    postBus.on("post.updated", onEvent("post.updated", "update"));
    postBus.on("post.deleted", onEvent("post.deleted", "delete"));

    g.__jachoei_post_listeners__.bus = postBus;
    g.__jachoei_post_listeners__.started = true;

    console.error(
      "[events] post listeners registered OK. counts =",
      postBus.listenerCount("post.created"),
      postBus.listenerCount("post.updated"),
      postBus.listenerCount("post.deleted")
    );
  } catch (err: any) {
    console.error("[events] register FAILED", err?.message ?? err);
    g.__jachoei_post_listeners__.started = false;
    g.__jachoei_post_listeners__.bus = null;
  } finally {
    g.__jachoei_post_listeners__.starting = false;
  }
}
