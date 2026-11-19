// ======================
// helper: แทรก comment ใหม่เข้า tree
// ======================
export function insertCommentIntoTree(
  prevComments: any[],
  newComment: any
): any[] {
  // กัน duplicate
  const exists = (comments: any[]): boolean => {
    for (const c of comments) {
      if (c.id === newComment.id) return true;
      if (c.replies && c.replies.length && exists(c.replies)) return true;
    }
    return false;
  };

  if (exists(prevComments)) {
    return prevComments;
  }

  // ถ้าไม่มี parent → เป็น root comment ใหม่
  if (!newComment.parent_id) {
    return [
      ...prevComments,
      {
        ...newComment,
        replies: newComment.replies ?? [],
      },
    ];
  }

  // ถ้ามี parent → หา parent แล้ว push เข้า replies
  const deepInsert = (comments: any[]): any[] => {
    return comments.map((c) => {
      if (c.id === newComment.parent_id) {
        const currentReplies = c.replies ?? [];
        return {
          ...c,
          replies: [
            ...currentReplies,
            {
              ...newComment,
              replies: newComment.replies ?? [],
            },
          ],
        };
      }

      if (c.replies && c.replies.length) {
        return {
          ...c,
          replies: deepInsert(c.replies),
        };
      }

      return c;
    });
  };

  return deepInsert(prevComments);
}

/** Relative operator time; stored timestamps and the comment body remain unchanged. */
export function formatTimeAgo(createdAt: string | number | Date | null | undefined, language: "th" | "en" = "en", now = Date.now()) {
  if (createdAt === null || createdAt === undefined || createdAt === "") return "";
  const timestamp = new Date(createdAt).getTime();
  if (!Number.isFinite(timestamp)) return "";
  const seconds = Math.abs(now - timestamp) / 1000;
  const direction = timestamp > now ? 1 : -1;
  const formatter = new Intl.RelativeTimeFormat(language === "th" ? "th-TH" : "en-GB", { numeric: "auto" });
  if (seconds < 60) return formatter.format(0, "second");
  const units: Array<[number, Intl.RelativeTimeFormatUnit]> = [
    [60, "minute"], [3600, "hour"], [86400, "day"], [2592000, "month"], [31104000, "year"],
  ];
  const index = units.findIndex(([size], i) => i === units.length - 1 || seconds < units[i + 1][0]);
  const [size, unit] = units[index];
  return formatter.format(direction * Math.floor(seconds / size), unit);
}
