'use client';

import { gql, useMutation, useQuery } from "@apollo/client";
import { Alert, Button, Empty, Segmented, Space, Spin, Typography, message } from "antd";
import { CheckOutlined, RobotOutlined, DownOutlined, ArrowRightOutlined } from "@ant-design/icons";
import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import { useBmsPermissions } from "@/app/hooks/useBmsPermissions";
import styles from "./mentions.module.css";

const Q_MENTIONS = gql`
  query ($unreadOnly: Boolean) {
    bmsMyMentions(unreadOnly: $unreadOnly, limit: 100) {
      id conversationId channel customerName author body createdAt readAt
    }
  }
`;
const M_MARK_READ = gql`mutation ($id: ID!) { bmsMarkMentionRead(id: $id) }`;
const M_MARK_ALL_READ = gql`mutation { bmsMarkAllMentionsRead }`;

type Mention = {
  id: string; conversationId: string; channel: string; customerName: string | null;
  author: string | null; body: string; createdAt: string; readAt: string | null;
};

type Group = {
  key: string;
  conversationId: string;
  channel: string;
  customerName: string | null;
  author: string | null;
  body: string;
  items: Mention[]; // เรียงใหม่→เก่า, items[0] = ล่าสุด
};

// ---- วันที่/เวลา (Asia/Bangkok) — คัดลอกจาก app/(admin)/admin/inbox/page.tsx (client component
// ดึงตรงจาก lib/bms/inbox.ts ไม่ได้เพราะไฟล์นั้น import @/lib/db) ----
const BKK = "Asia/Bangkok";
const dayKey = (iso: string) =>
  new Intl.DateTimeFormat("en-CA", { timeZone: BKK, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(iso));
const timeLabel = (iso: string) =>
  new Intl.DateTimeFormat("th-TH", { timeZone: BKK, hour: "2-digit", minute: "2-digit" }).format(new Date(iso));
function dayLabel(iso: string) {
  const key = dayKey(iso);
  const now = new Date();
  const todayKey = dayKey(now.toISOString());
  const y = new Date(now); y.setDate(y.getDate() - 1);
  if (key === todayKey) return "วันนี้";
  if (key === dayKey(y.toISOString())) return "เมื่อวาน";
  return new Intl.DateTimeFormat("th-TH", { timeZone: BKK, day: "numeric", month: "short", year: "numeric" }).format(new Date(iso));
}

const isAiAuthor = (author: string | null) => author === "AI";
const initialsOf = (author: string | null) => (author || "?").split("@")[0].slice(0, 2).toUpperCase();

// จัดกลุ่มการแจ้งเตือนที่เนื้อหาซ้ำกันเป๊ะ (เดียวกันทั้ง conversation/ผู้ส่ง/ข้อความ — เคสหลักคือ
// AI ส่ง note "ถามซ้ำ/ไม่คืบหน้า" ซ้ำๆ ต่อบทสนทนาเดียวกันหลายรอบ) ให้เหลือการ์ดเดียวพร้อมนับจำนวน
// แทนที่จะเรียงเป็นแถวซ้ำเดิมยาวเป็นหน้ากระดาษ — จัดกลุ่มแยกตามวันเสมอ (ไม่ปนข้าม dayLabel)
function groupByDay(list: Mention[]): { day: string; groups: Group[] }[] {
  const dayOrder: string[] = [];
  const perDay = new Map<string, Map<string, Group>>();
  for (const m of list) {
    const d = dayKey(m.createdAt);
    if (!perDay.has(d)) { perDay.set(d, new Map()); dayOrder.push(d); }
    const groups = perDay.get(d)!;
    const gKey = `${m.conversationId}|${m.author ?? ""}|${m.body}`;
    const existing = groups.get(gKey);
    if (existing) existing.items.push(m);
    else groups.set(gKey, {
      key: gKey, conversationId: m.conversationId, channel: m.channel,
      customerName: m.customerName, author: m.author, body: m.body, items: [m],
    });
  }
  return dayOrder.map((d) => ({ day: d, groups: Array.from(perDay.get(d)!.values()) }));
}

export default function MyMentionsPage() {
  const router = useRouter();
  const { can, loading: permsLoading } = useBmsPermissions();
  const [filter, setFilter] = useState<"unread" | "all">("unread");
  const [typeFilter, setTypeFilter] = useState<string>("all"); // "all" | "ai" | "human" | "ch:<channel>"
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  const { data, loading, refetch } = useQuery(Q_MENTIONS, {
    variables: { unreadOnly: filter === "unread" },
    skip: permsLoading || !can("inbox.view"),
    fetchPolicy: "cache-and-network",
  });
  const [markRead] = useMutation(M_MARK_READ);
  const [markAllRead, { loading: markingAll }] = useMutation(M_MARK_ALL_READ, {
    onCompleted: () => { message.success("อ่านทั้งหมดแล้ว"); refetch(); },
  });

  const mentions: Mention[] = data?.bmsMyMentions || [];

  const channels = useMemo(
    () => Array.from(new Set(mentions.map((m) => m.channel))).sort(),
    [mentions]
  );

  const filteredMentions = useMemo(() => {
    if (typeFilter === "all") return mentions;
    if (typeFilter === "ai") return mentions.filter((m) => isAiAuthor(m.author));
    if (typeFilter === "human") return mentions.filter((m) => !isAiAuthor(m.author));
    const ch = typeFilter.replace(/^ch:/, "");
    return mentions.filter((m) => m.channel === ch);
  }, [mentions, typeFilter]);

  const dayGroups = useMemo(() => groupByDay(filteredMentions), [filteredMentions]);

  // insight ฝั่งขวา — คำนวณจากข้อมูลทั้งหมดที่โหลดมา (ไม่ผูกกับ typeFilter ที่กำลังเลือกอยู่)
  const insights = useMemo(() => {
    const unreadTotal = mentions.filter((m) => !m.readAt).length;
    const aiByConversation = new Map<string, { count: number; channel: string; customerName: string | null; conversationId: string }>();
    for (const m of mentions) {
      if (!isAiAuthor(m.author)) continue;
      const cur = aiByConversation.get(m.conversationId) || { count: 0, channel: m.channel, customerName: m.customerName, conversationId: m.conversationId };
      cur.count += 1;
      aiByConversation.set(m.conversationId, cur);
    }
    const topRepeated = Array.from(aiByConversation.values()).sort((a, b) => b.count - a.count)[0];
    const humanMentions = mentions.filter((m) => !isAiAuthor(m.author));
    return {
      unreadTotal,
      total: mentions.length,
      topRepeated: topRepeated && topRepeated.count > 1 ? topRepeated : null,
      humanCount: humanMentions.length,
      latestHuman: humanMentions[0] ?? null,
    };
  }, [mentions]);

  const markGroupRead = async (g: Group) => {
    const unreadIds = g.items.filter((i) => !i.readAt).map((i) => i.id);
    if (!unreadIds.length) return;
    await Promise.all(unreadIds.map((id) => markRead({ variables: { id } }).catch(() => {})));
    refetch();
  };

  const openGroup = async (g: Group) => {
    await markGroupRead(g);
    router.push(`/admin/inbox?c=${g.conversationId}&tab=notes`);
  };

  const markInstanceRead = async (id: string) => {
    await markRead({ variables: { id } }).catch(() => {});
    refetch();
  };

  const toggleExpand = (groupUid: string) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(groupUid)) next.delete(groupUid); else next.add(groupUid);
      return next;
    });
  };

  if (!permsLoading && !can("inbox.view")) {
    return <Alert type="warning" message="ไม่มีสิทธิ์ดูหน้านี้" showIcon />;
  }

  return (
    <div style={{ maxWidth: 980 }}>
      <Space style={{ marginBottom: 16, width: "100%", justifyContent: "space-between" }} wrap>
        <Typography.Title level={4} style={{ margin: 0 }}>เมนชันของฉัน</Typography.Title>
        <Space>
          <Segmented
            value={filter}
            onChange={(v) => setFilter(v as "unread" | "all")}
            options={[{ label: "ยังไม่อ่าน", value: "unread" }, { label: "ทั้งหมด", value: "all" }]}
          />
          <Button icon={<CheckOutlined />} loading={markingAll} onClick={() => markAllRead()}>
            อ่านทั้งหมดแล้ว
          </Button>
        </Space>
      </Space>

      <div className={styles.layout}>
        <div className={styles.feed}>
          {loading && dayGroups.length === 0 && (
            <div style={{ textAlign: "center", padding: "40px 0" }}><Spin /></div>
          )}
          {!loading && dayGroups.length === 0 && (
            <Empty description={filter === "unread" ? "ไม่มีเมนชันที่ยังไม่อ่าน" : "ยังไม่มีใคร mention คุณ"} />
          )}

          {dayGroups.map(({ day, groups }) => (
            <section key={day} className={styles.dayGroup}>
              <div className={styles.dayLabel}>{dayLabel(groups[0].items[0].createdAt)}</div>
              {groups.map((g) => {
                const latest = g.items[0];
                const unreadCount = g.items.filter((i) => !i.readAt).length;
                const isUnread = unreadCount > 0;
                const groupUid = `${day}:${g.key}`;
                const isOpen = expanded.has(groupUid);
                const ai = isAiAuthor(g.author);
                return (
                  <div key={groupUid} className={styles.card}>
                    <div
                      className={`${styles.mentionRow} ${isUnread ? styles.unread : ""}`}
                      onClick={() => openGroup(g)}
                    >
                      <div className={styles.stripe} />
                      <div className={`${styles.avatar} ${ai ? styles.avatarAi : styles.avatarHuman}`}>
                        {ai ? <RobotOutlined /> : initialsOf(g.author)}
                      </div>
                      <div className={styles.body}>
                        <div className={styles.top}>
                          <span className={styles.name}>{ai ? "AI ผู้ช่วย" : (g.author || g.customerName || g.channel)}</span>
                          <span className={styles.chip}>{g.channel}</span>
                          {g.items.length > 1 && <span className={`${styles.chip} ${styles.chipRepeat}`}>×{g.items.length} ครั้ง</span>}
                        </div>
                        <div className={styles.preview}>{g.body}</div>
                      </div>
                      <div className={styles.side}>
                        {isUnread && <span className={styles.unreadDot} />}
                        <span className={styles.time}>{timeLabel(latest.createdAt)}</span>
                        <div className={styles.actions}>
                          <button
                            type="button"
                            className={styles.iconBtn}
                            title="ทำเครื่องหมายว่าอ่านแล้ว"
                            aria-label="ทำเครื่องหมายว่าอ่านแล้ว"
                            onClick={(e) => { e.stopPropagation(); markGroupRead(g); }}
                          >
                            <CheckOutlined style={{ fontSize: 12 }} />
                          </button>
                          <button
                            type="button"
                            className={styles.iconBtn}
                            title="เปิดบทสนทนา"
                            aria-label="เปิดบทสนทนา"
                            onClick={(e) => { e.stopPropagation(); openGroup(g); }}
                          >
                            <ArrowRightOutlined style={{ fontSize: 12 }} />
                          </button>
                        </div>
                      </div>
                    </div>

                    {g.items.length > 1 && (
                      <>
                        <button
                          type="button"
                          className={`${styles.expandToggle} ${isOpen ? styles.expandToggleOpen : ""}`}
                          onClick={(e) => { e.stopPropagation(); toggleExpand(groupUid); }}
                        >
                          {isOpen ? "ซ่อน" : "ดูทั้งหมด"} ({g.items.length} ครั้ง)
                          <DownOutlined className={styles.expandToggleIcon} style={{ fontSize: 10 }} />
                        </button>
                        {isOpen && (
                          <div className={styles.instances}>
                            {g.items.map((i) => (
                              <div
                                key={i.id}
                                className={`${styles.instanceRow} ${!i.readAt ? styles.unread : ""}`}
                                onClick={(e) => { e.stopPropagation(); if (!i.readAt) markInstanceRead(i.id); }}
                              >
                                {!i.readAt && <span className={styles.unreadDot} />}
                                <span>เตือนซ้ำ — บทสนทนานี้</span>
                                <span className={styles.instanceTime}>{timeLabel(i.createdAt)}</span>
                              </div>
                            ))}
                          </div>
                        )}
                      </>
                    )}
                  </div>
                );
              })}
            </section>
          ))}
        </div>

        <aside className={styles.rail}>
          <div className={styles.railCard}>
            <p className={styles.railTitle}>สรุป</p>
            <div className={styles.statBig}>
              <span className={styles.statNum}>{insights.unreadTotal}</span>
              <span className={styles.statLabel}>ยังไม่อ่าน</span>
            </div>
            <p className={styles.statSub}>จากทั้งหมด {insights.total} เมนชันที่โหลดมา</p>
          </div>

          {(insights.topRepeated || insights.humanCount > 0) && (
            <div className={styles.railCard}>
              <p className={styles.railTitle}>สิ่งที่ควรรู้</p>
              {insights.topRepeated && (
                <div
                  className={styles.insight}
                  onClick={() => router.push(`/admin/inbox?c=${insights.topRepeated!.conversationId}&tab=notes`)}
                >
                  <span className={`${styles.insightDot} ${styles.insightWarn}`} />
                  <div className={styles.insightText}>
                    บทสนทนาช่องทาง <b>{insights.topRepeated.channel}</b>
                    {insights.topRepeated.customerName ? ` (${insights.topRepeated.customerName})` : ""} ถูก AI แจ้งเตือนซ้ำ{" "}
                    <b>{insights.topRepeated.count} ครั้ง</b> — ลูกค้าอาจรอคำตอบอยู่
                    <br /><span className={styles.insightLink}>เปิดบทสนทนานี้ →</span>
                  </div>
                </div>
              )}
              {insights.humanCount > 0 && insights.latestHuman && (
                <div
                  className={styles.insight}
                  onClick={() => router.push(`/admin/inbox?c=${insights.latestHuman!.conversationId}&tab=notes`)}
                >
                  <span className={`${styles.insightDot} ${styles.insightGood}`} />
                  <div className={styles.insightText}>
                    มีเพื่อนร่วมทีมแท็กคุณ <b>{insights.humanCount} ครั้ง</b>
                    {insights.humanCount === 1 ? ` — จาก ${insights.latestHuman.author}` : ""}
                    <br /><span className={styles.insightLink}>ไปที่ข้อความล่าสุด →</span>
                  </div>
                </div>
              )}
            </div>
          )}

          <div className={styles.railCard}>
            <p className={styles.railTitle}>กรองตามประเภท</p>
            <div className={styles.filterChips}>
              <button
                type="button"
                className={`${styles.filterChip} ${typeFilter === "all" ? styles.filterChipActive : ""}`}
                onClick={() => setTypeFilter("all")}
              >
                ทั้งหมด
              </button>
              <button
                type="button"
                className={`${styles.filterChip} ${typeFilter === "ai" ? styles.filterChipActive : ""}`}
                onClick={() => setTypeFilter("ai")}
              >
                AI แจ้งเตือน
              </button>
              <button
                type="button"
                className={`${styles.filterChip} ${typeFilter === "human" ? styles.filterChipActive : ""}`}
                onClick={() => setTypeFilter("human")}
              >
                มีคนแท็กฉัน
              </button>
              {channels.map((ch) => (
                <button
                  key={ch}
                  type="button"
                  className={`${styles.filterChip} ${typeFilter === `ch:${ch}` ? styles.filterChipActive : ""}`}
                  onClick={() => setTypeFilter(`ch:${ch}`)}
                >
                  {ch}
                </button>
              ))}
            </div>
          </div>
        </aside>
      </div>
    </div>
  );
}
