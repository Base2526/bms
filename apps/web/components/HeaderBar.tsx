"use client";

import { useEffect, useState, useRef, useMemo } from "react";
import {
  Layout,
  Button,
  Tooltip,
  Space,
  Avatar,
  Typography,
  Dropdown,
  message,
  AutoComplete,
  Input,
  Modal,
  Image,
  theme
} from "antd";
import type { InputRef } from "antd";
import {
  UserOutlined,
  SettingOutlined,
  ReloadOutlined,
  LoginOutlined,
  MessageOutlined,
  BellOutlined,
  QuestionCircleOutlined,
  SearchOutlined,
  HistoryOutlined,
  CloseCircleFilled,
  PlusOutlined,
  SafetyOutlined
} from "@ant-design/icons";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import type { MenuProps } from "antd";
import { gql, useQuery } from "@apollo/client";

import { useSession } from "@/lib/useSession";
import { useGlobalChatStore } from "@/store/globalChatStore";
import { useI18n } from "@/lib/i18nContext";
import type { Lang } from "@/i18n";

const { Header } = Layout;
const { Text } = Typography;

const labelOf: Record<Lang, string> = { th: "ไทย", en: "English" };
const flagOf: Record<Lang, string> = { th: "🇹🇭", en: "🇺🇸" };

// ===== GraphQL =====
const Q_ME = gql`
  query {
    me {
      id
      name
      email
      phone
      username
      language
      role
      avatar
      created_at
    }
  }
`;

const Q_UNREAD_NOTIFICATION_COUNT = gql`
  query MyUnreadNotificationCount {
    myUnreadNotificationCount
  }
`;

type HeaderBarProps = {
  initialLang?: Lang;
  isMobile?: boolean; // 👈 รับจาก AppLayout
};

export default function HeaderBar({ initialLang = "th", isMobile = false }: HeaderBarProps) {
  const router = useRouter();
  const pathname = usePathname();
  const { user: userSession, refreshSession } = useSession();
  const { t, lang, setLang } = useI18n();
  const { token } = theme.useToken();

  const isBlockedActive = pathname.startsWith("/blocked");
  const [blockedHover, setBlockedHover] = useState<boolean>(false);

  // console.log("[HeaderBar] isMobile =", isMobile);

  // ===== User / unread =====
  const { data: meData } = useQuery(Q_ME, {
    skip: !userSession,
    fetchPolicy: "cache-first",
  });
  const me = meData?.me;

  const totalUnread = useGlobalChatStore((s) =>
    Object.values(s.unreadByChat || {}).reduce((sum, n) => sum + (n || 0), 0)
  );

  const { data: notifData } = useQuery(Q_UNREAD_NOTIFICATION_COUNT, {
    skip: !userSession,
    fetchPolicy: "cache-and-network",
  });
  const notifUnreadCount = notifData?.myUnreadNotificationCount ?? 0;

  // ===== Language =====
  const [currentLang, setCurrentLang] = useState<Lang>(lang ?? initialLang);

  useEffect(() => {
    setCurrentLang(lang);
  }, [lang]);

  const changeLang = (nextLang: Lang) => {
    if (nextLang === currentLang) return;
    document.cookie = `lang=${nextLang}; path=/; samesite=lax`;
    setCurrentLang(nextLang);
    setLang?.(nextLang);
    router.refresh();
  };

  // sync cookie หลัง mount
  useEffect(() => {
    const m = document.cookie.match(/(?:^|; )lang=([^;]+)/);
    const c = (m ? decodeURIComponent(m[1]) : null) as Lang | null;
    if (c && c !== currentLang) setCurrentLang(c);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function onLogout() {
    const res = await fetch("/api/auth/logout", { method: "POST" });
    if (res.ok) {
      message.success("Logged out");
      try {
        refreshSession();
      } catch {}
      router.replace("/");
      setTimeout(() => window.location.reload(), 100);
    } else {
      message.error("Logout failed");
    }
  }

  const languageMenu: MenuProps["items"] = (["th", "en"] as Lang[]).map((lng) => ({
    key: lng,
    disabled: lng === currentLang,
    label: (
      <span
        style={{
          display: "flex",
          alignItems: "center",
          gap: 8,
          opacity: lng === currentLang ? 0.45 : 1,
        }}
      >
        <span style={{ fontSize: 18 }}>{flagOf[lng]}</span>
        <span>{labelOf[lng]}</span>
      </span>
    ),
    onClick: () => changeLang(lng),
  }));

  const profileMenu: MenuProps["items"] = [
    {
      key: "settings",
      label: <Link href="/settings">Settings</Link>,
      icon: <SettingOutlined />,
    },
    { type: "divider" },
    {
      key: "logout",
      label: <span onClick={showConfirmLogout}>Logout</span>,
      icon: <ReloadOutlined />,
    },
  ];

  // ====== Search + History ======
  const [searchValue, setSearchValue] = useState("");
  const [searchHistory, setSearchHistory] = useState<string[]>([]);
  const searchInputRef = useRef<InputRef | null>(null);
  const [searchFocused, setSearchFocused] = useState(false);

  // load history จาก localStorage
  useEffect(() => {
    if (typeof window === "undefined") return;
    try {
      const raw = window.localStorage.getItem("globalSearchHistory");
      if (raw) {
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed)) {
          setSearchHistory(parsed.filter((x) => typeof x === "string"));
        }
      }
    } catch (e) {
      console.warn("[Search] load history error", e);
    }
  }, []);

  function showConfirmLogout() {
    Modal.confirm({
      title: "Confirm Logout",
      content: "Are you sure you want to logout?",
      okText: "Logout",
      cancelText: "Cancel",
      okButtonProps: { danger: true },
      centered: true,
      onOk: onLogout,
    });
  }

  const saveHistory = (list: string[]) => {
    setSearchHistory(list);
    if (typeof window !== "undefined") {
      window.localStorage.setItem("globalSearchHistory", JSON.stringify(list));
    }
  };

  const addToHistory = (term: string) => {
    const tVal = term.trim();
    if (!tVal) return;
    const next = [tVal, ...searchHistory.filter((x) => x !== tVal)].slice(0, 10);
    saveHistory(next);
  };

  const clearHistory = () => {
    saveHistory([]);
    setSearchValue("");
  };

  const handleSearchSubmit = (raw?: string) => {
    const q = (raw ?? searchValue).trim();
    if (!q) return;

    addToHistory(q);
    setSearchValue(q);

    router.push(`/search?q=${encodeURIComponent(q)}`, { scroll: false });
  };

  const handleSearchSelect = (value: string) => {
    if (value === "__clear__") {
      clearHistory();
      return;
    }
    setSearchValue(value);
    handleSearchSubmit(value);
  };

  const clearSearchInput = () => {
    setSearchValue("");
    searchInputRef.current?.focus?.();
  };

  const searchOptions = useMemo(() => {
    const historyOptions = searchHistory.map((h) => ({
      value: h,
      label: (
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
          }}
        >
          <span>
            <HistoryOutlined style={{ marginRight: 8, color: "#999" }} />
            {h}
          </span>
        </div>
      ),
    }));

    const clearOption =
      searchHistory.length > 0
        ? [
            {
              value: "__clear__",
              label: (
                <div
                  style={{
                    textAlign: "right",
                    fontSize: 12,
                    color: "#999",
                  }}
                >
                  {t("header.searchClearHistory")}
                </div>
              ),
            },
          ]
        : [];

    return [...historyOptions, ...clearOption];
  }, [searchHistory, t]);

  // Ctrl+K / Cmd+K → focus search (desktop only)
  useEffect(() => {
    if (isMobile) return; // มือถือไม่ต้องสนใจ shortcut
    const handler = (e: KeyboardEvent) => {
      const isMac = navigator.platform.toLowerCase().includes("mac");
      const metaPressed = isMac ? e.metaKey : e.ctrlKey;
      if (metaPressed && e.key.toLowerCase() === "k") {
        e.preventDefault();
        searchInputRef.current?.focus?.();
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [isMobile]);

  return (
    <Header
      style={{
        background: "#fff",
        padding: isMobile ? "0 8px" : "0 16px",
        height: isMobile ? 52 : 64,
        borderBottom: "1px solid #f0f0f0",
        position: "sticky",
        top: 0,
        zIndex: 1000,
      }}
    >
      {/* ชั้นใน: flex row */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: isMobile ? 8 : 16,
          height: "100%",
        }}
      >
        {/* ซ้าย: Logo / Title */}
        <div style={{ flexShrink: 0 }}>
          <Link
            href="/"
            style={{
              display: "flex",
              alignItems: "center",
              gap: 8,
              textDecoration: "none",
            }}
          >
            {isMobile ? (
              // ================================
              // 📱 MOBILE → แสดงเป็น Icon
              // ================================
              <Avatar size={35} shape="circle" alt="จ่าเฉย (JACHOEI)">
                <img
                  src="/icons/icon.svg"
                  width={35}
                  height={35}
                  alt="จ่าเฉย (JACHOEI)"
                  style={{
                    display: "block",
                    width: "100%",
                    height: "100%",
                    // borderRadius: "50%",
                    objectFit: "cover",
                    transform: "scale(1.25)",
                    transformOrigin: "center",
                  }}
                  loading="eager"
                  decoding="async"
                />
              </Avatar>

            ) : (
              // ================================
              // 🖥 DESKTOP → แสดงชื่อ Title
              // ================================
              <Link
      href="/"
      aria-label="Go to home"
      style={{
        display: "flex",
        alignItems: "center",
        gap: 12,
        padding: "6px 8px",
        textDecoration: "none",
        lineHeight: 1,
      }}
    >
      {/* ICON */}
      <Avatar size={50} shape="circle" alt="จ่าเฉย (JACHOEI)">
        <img
          src="/icons/icon.svg"
          width={50}
          height={50}
          alt="จ่าเฉย (JACHOEI)"
          style={{
            display: "block",
            width: "100%",
            height: "100%",
            // borderRadius: "50%",
            objectFit: "cover",
            transform: "scale(1.25)",
            transformOrigin: "center",
          }}
          loading="eager"
          decoding="async"
        />
      </Avatar>

      {/* TITLE */}
      <Text
        style={{
          color: "#000",
          fontSize: 22,
          fontWeight: 700,
          letterSpacing: 1,
          whiteSpace: "nowrap",
          lineHeight: 1,
          margin: 0,
        }}
      >
        {t("header.title")}
      </Text>
    </Link>
            
            )}
          </Link>
        </div>

        {/* กลาง: Search */}
        <div
          style={{
            flex: 1,
            display: "flex",
            justifyContent: "center",
          }}
        >
          <div
            style={{
              width: "100%",
              maxWidth: isMobile ? 360 : 650,
              minWidth: 0,
              display: "flex",
              flexDirection: "column",
              gap: 2,
            }}
          >
            <AutoComplete
              value={searchValue}
              onChange={setSearchValue}
              onSelect={handleSearchSelect}
              options={searchOptions}
              popupMatchSelectWidth={true}
            >
              <Input
                ref={searchInputRef}
                size={isMobile ? "small" : "middle"}
                placeholder={t("header.searchPlaceholder")}
                prefix={
                  <SearchOutlined
                    style={{
                      color: searchFocused ? "#1677ff" : "#999",
                      transition: "color .18s ease",
                    }}
                  />
                }
                suffix={
                  isMobile ? (
                    // มือถือ: แสดงแค่ปุ่มเคลียร์ถ้ามี text
                    searchValue && (
                      <CloseCircleFilled
                        onClick={(e) => {
                          e.stopPropagation();
                          e.preventDefault();
                          clearSearchInput();
                        }}
                        style={{
                          fontSize: 14,
                          cursor: "pointer",
                          color: "#bfbfbf",
                        }}
                      />
                    )
                  ) : (
                    // Desktop: ปุ่มเคลียร์ + Ctrl+K hint
                    <span
                      style={{
                        display: "inline-flex",
                        alignItems: "center",
                        gap: 6,
                        fontSize: 11,
                        color: "#999",
                      }}
                    >
                      {searchValue && (
                        <CloseCircleFilled
                          onClick={(e) => {
                            e.stopPropagation();
                            e.preventDefault();
                            clearSearchInput();
                          }}
                          style={{
                            fontSize: 14,
                            cursor: "pointer",
                            color: "#bfbfbf",
                          }}
                        />
                      )}

                      <span
                        style={{
                          display: "inline-flex",
                          alignItems: "center",
                          gap: 4,
                        }}
                      >
                        <span
                          style={{
                            padding: "1px 6px",
                            borderRadius: 6,
                            background: "#f0f0f0",
                            border: "1px solid #e1e1e1",
                            boxShadow: "0 1px 0 rgba(255,255,255,0.6)",
                          }}
                        >
                          Ctrl
                        </span>
                        <span style={{ opacity: 0.7 }}>+</span>
                        <span
                          style={{
                            padding: "1px 6px",
                            borderRadius: 6,
                            background: "#f0f0f0",
                            border: "1px solid #e1e1e1",
                            boxShadow: "0 1px 0 rgba(255,255,255,0.6)",
                          }}
                        >
                          K
                        </span>
                      </span>
                    </span>
                  )
                }
                style={{
                  width: "100%",
                  borderRadius: 999,
                  paddingInline: isMobile ? 10 : 16,
                  background: searchFocused ? "#ffffff" : "#f5f5f5",
                  border: searchFocused
                    ? "1px solid rgba(22,119,255,0.35)"
                    : "1px solid transparent",
                  boxShadow: searchFocused
                    ? "0 0 0 1px rgba(22,119,255,0.18), 0 6px 18px rgba(15,23,42,0.08)"
                    : "0 2px 6px rgba(15,23,42,0.04)",
                  transition: "all .18s ease",
                }}
                onPressEnter={() => handleSearchSubmit()}
                onFocus={() => setSearchFocused(true)}
                onBlur={() => setSearchFocused(false)}
              />
            </AutoComplete>
          </div>
        </div>

        {/* ขวา: ปุ่มต่าง ๆ */}
        <div style={{ flexShrink: 0 }}>
          <Space size={isMobile ? 4 : 8} align="center">
            {userSession && (
              <>
                <Tooltip title={t("header.chat") || "สร้างโพสใหม่"}>
                  <Button
                    type="text"
                    size={isMobile ? "small" : "middle"}
                    onClick={() => router.push("/post/new")}
                    icon={
                      <span style={{ position: "relative", display: "inline-block" }}>
                        <PlusOutlined style={{ fontSize: isMobile ? 18 : 18, color: "#000" }} />
                      </span>
                    }
                  />
                </Tooltip>
                
                {/* Chat */}
                <Tooltip title={t("header.chat") || "ข้อความ"}>
                  <Button
                    type="text"
                    size={isMobile ? "small" : "middle"}
                    onClick={() => router.push("/chat")}
                    icon={
                      <span style={{ position: "relative", display: "inline-block" }}>
                        <MessageOutlined style={{ fontSize: isMobile ? 18 : 18, color: "#000" }} />
                        {totalUnread > 0 && (
                          <span
                            style={{
                              position: "absolute",
                              top: 10,
                              right: -10,
                              minWidth: 18,
                              height: 18,
                              padding: "0 5px",
                              background: "#ff4d4f",
                              borderRadius: 999,
                              color: "#fff",
                              fontSize: 11,
                              fontWeight: 600,
                              display: "flex",
                              alignItems: "center",
                              justifyContent: "center",
                              boxShadow: "0 0 4px rgba(0, 0, 0, 0.3)",
                            }}
                          >
                            {totalUnread > 99 ? "99+" : totalUnread}
                          </span>
                        )}
                      </span>
                    }
                  />
                </Tooltip>

                {/* Blocked (Jachoei) */}
                <Tooltip title="Blocked">
                  <Button
                    aria-label="Blocked"
                    type="text"
                    icon={<SafetyOutlined style={{ fontSize: isMobile ? 18 : 18, color: "#000" }} />}
                    onClick={() => router.push("/blocked?tab=blocked")}
                    onMouseEnter={() => setBlockedHover(true)}
                    onMouseLeave={() => setBlockedHover(false)}
                  />
                </Tooltip>

                {/* Notifications */}
                <Tooltip title={t("header.notifications") || "แจ้งเตือน"}>
                  <Button
                    type="text"
                    size={isMobile ? "small" : "middle"}
                    onClick={() => router.push("/notification")}
                    icon={
                      <span style={{ position: "relative", display: "inline-block" }}>
                        <BellOutlined style={{ fontSize: isMobile ? 18 : 18, color: "#000" }} />
                        {notifUnreadCount > 0 && (
                          <span
                            style={{
                              position: "absolute",
                              top: 10,
                              right: -10,
                              minWidth: 18,
                              height: 18,
                              padding: "0 5px",
                              background: "#ff4d4f",
                              borderRadius: 999,
                              color: "#fff",
                              fontSize: 11,
                              fontWeight: 600,
                              display: "flex",
                              alignItems: "center",
                              justifyContent: "center",
                              boxShadow: "0 0 4px rgba(0, 0, 0, 0.3)",
                            }}
                          >
                            {notifUnreadCount > 99 ? "99+" : notifUnreadCount}
                          </span>
                        )}
                      </span>
                    }
                  />
                </Tooltip>
              </>
            )}

            {/* Language */}
            <Dropdown
              menu={{ items: languageMenu }}
              trigger={["click"]}
              placement="bottomRight"
              arrow
              overlayStyle={{ minWidth: 180 }}
            >
              <Button
                type="text"
                size={isMobile ? "small" : "middle"}
                onClick={(e) => e.preventDefault()}
              >
                <span style={{ fontSize: 18, marginRight: isMobile ? 0 : 6 }}>
                  {flagOf[currentLang]}
                </span>
                {!isMobile && <span>{labelOf[currentLang]}</span>}
              </Button>
            </Dropdown>

            {/* Help */}
            {!isMobile && (
              <Tooltip title={t("header.help") || "ศูนย์ช่วยเหลือ"}>
                <Button
                  type="text"
                  onClick={() => router.push("/help")}
                  icon={<QuestionCircleOutlined style={{ fontSize: 18, color: "#000" }} />}
                />
              </Tooltip>
            )}

            {/* User Avatar / Login */}
            {userSession ? (
              <Dropdown
                menu={{ items: profileMenu }}
                trigger={["click"]}
                placement="bottomRight"
                arrow
              >
                <Avatar
                  size={isMobile ? 32 : 36}
                  src={me?.avatar}
                  style={{ background: "#666", cursor: "pointer" }}
                  icon={<UserOutlined />}
                />
              </Dropdown>
            ) : (
              <Space>
                <Button
                  icon={<LoginOutlined />}
                  size={isMobile ? "small" : "middle"}
                  onClick={() => router.push("/login")}
                >
                  {!isMobile && "Login"}
                </Button>
              </Space>
            )}
          </Space>
        </div>
      </div>
    </Header>
  );
}
