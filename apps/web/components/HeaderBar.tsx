"use client";

import { useEffect, useMemo, useRef, useState } from "react";
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
  Badge,
} from "antd";
import type { InputRef } from "antd";
import type { MenuProps } from "antd";
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
  SafetyOutlined,
  GlobalOutlined,
  MoreOutlined,
} from "@ant-design/icons";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { gql, useQuery } from "@apollo/client";

import { useSession } from "@/lib/useSession";
import { useGlobalChatStore } from "@/store/globalChatStore";
import { useI18n } from "@/lib/i18nContext";
import type { Lang } from "@/i18n";

const { Header } = Layout;
const { Text } = Typography;

const labelOf: Record<Lang, string> = { th: "ไทย", en: "English" };
const flagOf: Record<Lang, string> = { th: "🇹🇭", en: "🇺🇸" };

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
  isMobile?: boolean;
};

type ViewMode = "mobile" | "tablet" | "desktop";

function getViewMode(width: number): ViewMode {
  if (width < 768) return "mobile";
  if (width < 1180) return "tablet";
  return "desktop";
}

export default function HeaderBar({
  initialLang = "th",
  isMobile = false,
}: HeaderBarProps) {
  const router = useRouter();
  const { user: userSession, refreshSession } = useSession();
  const { t, lang, setLang } = useI18n();

  const [viewMode, setViewMode] = useState<ViewMode>(isMobile ? "mobile" : "desktop");
  const isMobileView = viewMode === "mobile";
  const isTabletView = viewMode === "tablet";
  const isDesktopView = viewMode === "desktop";

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

  const [currentLang, setCurrentLang] = useState<Lang>(lang ?? initialLang);
  const [searchValue, setSearchValue] = useState("");
  const [searchHistory, setSearchHistory] = useState<string[]>([]);
  const [searchFocused, setSearchFocused] = useState(false);
  const [mobileSearchOpen, setMobileSearchOpen] = useState(false);

  const searchInputRef = useRef<InputRef | null>(null);
  const mobileSearchInputRef = useRef<InputRef | null>(null);

  useEffect(() => {
    const updateMode = () => {
      setViewMode(getViewMode(window.innerWidth));
    };

    updateMode();
    window.addEventListener("resize", updateMode);
    return () => window.removeEventListener("resize", updateMode);
  }, []);

  useEffect(() => {
    setCurrentLang(lang);
  }, [lang]);

  useEffect(() => {
    const m = document.cookie.match(/(?:^|; )lang=([^;]+)/);
    const c = (m ? decodeURIComponent(m[1]) : null) as Lang | null;
    if (c && c !== currentLang) setCurrentLang(c);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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

  useEffect(() => {
    if (!isDesktopView) return;

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
  }, [isDesktopView]);

  useEffect(() => {
    if (!mobileSearchOpen) return;
    const id = window.setTimeout(() => {
      mobileSearchInputRef.current?.focus?.();
    }, 60);
    return () => window.clearTimeout(id);
  }, [mobileSearchOpen]);

  const changeLang = (nextLang: Lang) => {
    if (nextLang === currentLang) return;
    document.cookie = `lang=${nextLang}; path=/; samesite=lax`;
    setCurrentLang(nextLang);
    setLang?.(nextLang);
    router.refresh();
  };

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
    const trimmed = term.trim();
    if (!trimmed) return;
    const next = [trimmed, ...searchHistory.filter((x) => x !== trimmed)].slice(0, 10);
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
    setMobileSearchOpen(false);
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
    mobileSearchInputRef.current?.focus?.();
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
            color: "rgba(15,23,42,0.78)",
          }}
        >
          <span>
            <HistoryOutlined style={{ marginRight: 8, color: "#94a3b8" }} />
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
                    color: "#94a3b8",
                    fontWeight: 500,
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

  const iconButtonStyle: React.CSSProperties = {
    borderRadius: 14,
    width: isMobileView ? 34 : 38,
    height: isMobileView ? 34 : 38,
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    color: "#0f172a",
  };

  const mobileOverflowMenu: MenuProps["items"] = useMemo(() => {
    const items: MenuProps["items"] = [];

    if (userSession) {
      items.push(
        {
          key: "new-post",
          label: "New post",
          icon: <PlusOutlined />,
          onClick: () => router.push("/post/new"),
        },
        {
          key: "blocked",
          label: "Blocked",
          icon: <SafetyOutlined />,
          onClick: () => router.push("/blocked?tab=blocked"),
        },
        { type: "divider" },
        {
          key: "help",
          label: t("header.help") || "Help",
          icon: <QuestionCircleOutlined />,
          onClick: () => router.push("/help"),
        },
        { type: "divider" }
      );
    } else {
      items.push(
        {
          key: "help",
          label: t("header.help") || "Help",
          icon: <QuestionCircleOutlined />,
          onClick: () => router.push("/help"),
        },
        { type: "divider" }
      );
    }

    items.push(
      {
        key: "lang-th",
        disabled: currentLang === "th",
        label: (
          <span style={{ display: "inline-flex", alignItems: "center", gap: 8 }}>
            <span style={{ fontSize: 18 }}>{flagOf.th}</span>
            <span>{labelOf.th}</span>
          </span>
        ),
        icon: <GlobalOutlined />,
        onClick: () => changeLang("th"),
      },
      {
        key: "lang-en",
        disabled: currentLang === "en",
        label: (
          <span style={{ display: "inline-flex", alignItems: "center", gap: 8 }}>
            <span style={{ fontSize: 18 }}>{flagOf.en}</span>
            <span>{labelOf.en}</span>
          </span>
        ),
        icon: <GlobalOutlined />,
        onClick: () => changeLang("en"),
      }
    );

    return items;
  }, [changeLang, currentLang, router, t, userSession]);

  return (
    <>
      <Header
        style={{
          background: "rgba(255,255,255,0.88)",
          backdropFilter: "blur(14px)",
          WebkitBackdropFilter: "blur(14px)",
          padding: 0,
          height: isMobileView ? 58 : 72,
          borderBottom: "1px solid rgba(15,23,42,0.06)",
          position: "sticky",
          top: 0,
          zIndex: 1000,
          lineHeight: 1,
          boxShadow: "0 8px 30px rgba(15,23,42,0.04)",
        }}
      >
        <div className="jachoei-header-shell">
          <div className="jachoei-header-left">
            <Link href="/" aria-label="Go to home" className="jachoei-brand-link">
              <span className="jachoei-brand-icon">
                <img
                  src="/icons/icon.svg"
                  width={46}
                  height={46}
                  alt="จ่าเฉย (JACHOEI)"
                  style={{
                    display: "block",
                    width: "100%",
                    height: "100%",
                    objectFit: "cover",
                    transform: "scale(1.22)",
                    transformOrigin: "center",
                  }}
                  loading="eager"
                  decoding="async"
                />
              </span>

              <div className="jachoei-brand-copy">
                <Text className="jachoei-brand-title">{t("header.title")}</Text>
                {isDesktopView && (
                  <Text className="jachoei-brand-subtitle">
                    Community scam intelligence
                  </Text>
                )}
              </div>
            </Link>
          </div>

          {!isMobileView && (
            <div className="jachoei-header-center">
              <div className="jachoei-search-wrap">
                <AutoComplete
                  value={searchValue}
                  onChange={setSearchValue}
                  onSelect={handleSearchSelect}
                  options={searchOptions}
                  popupMatchSelectWidth
                >
                  <Input
                    ref={searchInputRef}
                    size={isTabletView ? "middle" : "large"}
                    placeholder={t("header.searchPlaceholder")}
                    prefix={
                      <SearchOutlined
                        style={{
                          color: searchFocused ? "#2563eb" : "#94a3b8",
                          transition: "color .18s ease",
                        }}
                      />
                    }
                    suffix={
                      isDesktopView ? (
                        <span
                          style={{
                            display: "inline-flex",
                            alignItems: "center",
                            gap: 6,
                            fontSize: 11,
                            color: "#94a3b8",
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
                                color: "#94a3b8",
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
                            <span className="jachoei-kbd">Ctrl</span>
                            <span style={{ opacity: 0.7 }}>+</span>
                            <span className="jachoei-kbd">K</span>
                          </span>
                        </span>
                      ) : searchValue ? (
                        <CloseCircleFilled
                          onClick={(e) => {
                            e.stopPropagation();
                            e.preventDefault();
                            clearSearchInput();
                          }}
                          style={{
                            fontSize: 14,
                            cursor: "pointer",
                            color: "#94a3b8",
                          }}
                        />
                      ) : null
                    }
                    style={{
                      width: "100%",
                      borderRadius: 999,
                      paddingInline: isTabletView ? 12 : 16,
                      background: searchFocused ? "#ffffff" : "rgba(248,250,252,0.92)",
                      border: searchFocused
                        ? "1px solid rgba(37,99,235,0.34)"
                        : "1px solid rgba(15,23,42,0.06)",
                      boxShadow: searchFocused
                        ? "0 0 0 3px rgba(37,99,235,0.08), 0 10px 24px rgba(15,23,42,0.08)"
                        : "0 4px 16px rgba(15,23,42,0.04), inset 0 1px 0 rgba(255,255,255,0.75)",
                      transition: "all .18s ease",
                    }}
                    onPressEnter={() => handleSearchSubmit()}
                    onFocus={() => setSearchFocused(true)}
                    onBlur={() => setSearchFocused(false)}
                  />
                </AutoComplete>
              </div>
            </div>
          )}

          <div className="jachoei-header-right">
            <Space size={isMobileView ? 4 : 6} align="center">
              {isMobileView && (
                <Tooltip title={t("header.searchPlaceholder")}>
                  <Button
                    type="text"
                    style={iconButtonStyle}
                    onClick={() => setMobileSearchOpen(true)}
                    icon={<SearchOutlined style={{ fontSize: 18 }} />}
                  />
                </Tooltip>
              )}

              {userSession && (
                <>
                  <Tooltip title={t("header.chat") || "ข้อความ"}>
                    <Button
                      type="text"
                      style={iconButtonStyle}
                      onClick={() => router.push("/chat")}
                      icon={
                        <Badge count={totalUnread > 99 ? "99+" : totalUnread} size="small" offset={[-2, 2]}>
                          <MessageOutlined style={{ fontSize: 18, color: "#0f172a" }} />
                        </Badge>
                      }
                    />
                  </Tooltip>

                  <Tooltip title={t("header.notifications") || "แจ้งเตือน"}>
                    <Button
                      type="text"
                      style={iconButtonStyle}
                      onClick={() => router.push("/notification")}
                      icon={
                        <Badge count={notifUnreadCount > 99 ? "99+" : notifUnreadCount} size="small" offset={[-2, 2]}>
                          <BellOutlined style={{ fontSize: 18, color: "#0f172a" }} />
                        </Badge>
                      }
                    />
                  </Tooltip>
                </>
              )}

              {!isMobileView ? (
                <Dropdown
                  menu={{ items: languageMenu }}
                  trigger={["click"]}
                  placement="bottomRight"
                  arrow
                  overlayStyle={{ minWidth: 180 }}
                >
                  <Button
                    type="text"
                    className="jachoei-lang-btn"
                    onClick={(e) => e.preventDefault()}
                    icon={!isMobileView ? <GlobalOutlined /> : undefined}
                  >
                    <span style={{ fontSize: 18, marginRight: isMobileView ? 0 : 6 }}>
                      {flagOf[currentLang]}
                    </span>
                    {!isMobileView && <span>{labelOf[currentLang]}</span>}
                  </Button>
                </Dropdown>
              ) : (
                <Dropdown
                  menu={{ items: mobileOverflowMenu }}
                  trigger={["click"]}
                  placement="bottomRight"
                  arrow
                  overlayStyle={{ minWidth: 200 }}
                >
                  <Tooltip title="More">
                    <Button
                      type="text"
                      style={iconButtonStyle}
                      icon={<MoreOutlined style={{ fontSize: 18 }} />}
                      aria-label="More"
                    />
                  </Tooltip>
                </Dropdown>
              )}

              {isDesktopView && (
                <Tooltip title={t("header.help") || "ศูนย์ช่วยเหลือ"}>
                  <Button
                    type="text"
                    style={iconButtonStyle}
                    onClick={() => router.push("/help")}
                    icon={<QuestionCircleOutlined style={{ fontSize: 18 }} />}
                  />
                </Tooltip>
              )}

              {userSession ? (
                <Dropdown
                  menu={{ items: profileMenu }}
                  trigger={["click"]}
                  placement="bottomRight"
                  arrow
                >
                  <Avatar
                    size={isMobileView ? 34 : 38}
                    src={me?.avatar}
                    style={{
                      background: "linear-gradient(135deg, #64748b 0%, #334155 100%)",
                      cursor: "pointer",
                      boxShadow: "0 8px 18px rgba(15,23,42,0.14)",
                      border: "2px solid rgba(255,255,255,0.9)",
                    }}
                    icon={<UserOutlined />}
                  />
                </Dropdown>
              ) : (
                <Button
                  icon={<LoginOutlined />}
                  size={isMobileView ? "middle" : "large"}
                  onClick={() => router.push("/login")}
                  className="jachoei-login-btn"
                >
                  {!isMobileView && "Login"}
                </Button>
              )}
            </Space>
          </div>
        </div>
      </Header>

      {isMobileView && mobileSearchOpen && (
        <div className="jachoei-mobile-search-backdrop" onClick={() => setMobileSearchOpen(false)}>
          <div
            className="jachoei-mobile-search-card"
            onClick={(e) => e.stopPropagation()}
            role="dialog"
            aria-label="Search"
          >
            <div className="jachoei-mobile-search-top">
              <Text style={{ fontWeight: 700, color: "#0f172a" }}>
                {t("header.searchPlaceholder")}
              </Text>

              <Button
                type="text"
                onClick={() => setMobileSearchOpen(false)}
                icon={<CloseCircleFilled style={{ color: "#94a3b8" }} />}
              />
            </div>

            <AutoComplete
              value={searchValue}
              onChange={setSearchValue}
              onSelect={handleSearchSelect}
              options={searchOptions}
              popupMatchSelectWidth
            >
              <Input
                ref={mobileSearchInputRef}
                size="large"
                placeholder={t("header.searchPlaceholder")}
                prefix={<SearchOutlined style={{ color: "#94a3b8" }} />}
                suffix={
                  searchValue ? (
                    <CloseCircleFilled
                      onClick={(e) => {
                        e.stopPropagation();
                        e.preventDefault();
                        clearSearchInput();
                      }}
                      style={{
                        fontSize: 14,
                        cursor: "pointer",
                        color: "#94a3b8",
                      }}
                    />
                  ) : null
                }
                style={{
                  borderRadius: 16,
                  background: "#fff",
                  border: "1px solid rgba(15,23,42,0.08)",
                  boxShadow: "0 6px 18px rgba(15,23,42,0.06)",
                }}
                onPressEnter={() => handleSearchSubmit()}
              />
            </AutoComplete>
          </div>
        </div>
      )}

      <style>{`
        .jachoei-header-shell {
          max-width: 1400px;
          margin: 0 auto;
          height: 100%;
          display: grid;
          grid-template-columns: minmax(240px, 360px) minmax(500px, 1fr) auto;
          align-items: center;
          gap: 18px;
          padding: 0 18px;
        }

        .jachoei-header-left {
          min-width: 0;
          overflow: hidden;
        }

        .jachoei-brand-link {
          display: inline-flex;
          align-items: center;
          gap: 12px;
          text-decoration: none;
          padding: 6px 4px;
          border-radius: 18px;
          min-width: 0;
          max-width: 100%;
        }

        .jachoei-brand-icon {
          width: 46px;
          height: 46px;
          border-radius: 16px;
          display: inline-flex;
          align-items: center;
          justify-content: center;
          overflow: hidden;
          background: linear-gradient(135deg, #0f172a 0%, #334155 100%);
          // box-shadow: 0 10px 24px rgba(15,23,42,0.14);
          flex-shrink: 0;
        }

        .jachoei-brand-copy {
          min-width: 0;
          display: flex;
          flex-direction: column;
          overflow: hidden;
        }

        .jachoei-brand-title {
          color: #0f172a !important;
          font-size: 20px;
          font-weight: 800;
          letter-spacing: -0.3px;
          line-height: 1.1;
          margin: 0;
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
        }

        .jachoei-brand-subtitle {
          color: rgba(15,23,42,0.48) !important;
          font-size: 12px;
          line-height: 1.2;
          margin-top: 3px;
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
        }

        .jachoei-header-center {
          min-width: 0;
          display: flex;
          justify-content: center;
        }

        .jachoei-search-wrap {
          width: 100%;
          max-width: 100%;
          min-width: 420px;
        }

        .jachoei-kbd {
          padding: 2px 7px;
          border-radius: 8px;
          background: #f8fafc;
          border: 1px solid rgba(15,23,42,0.08);
          box-shadow: inset 0 1px 0 rgba(255,255,255,0.9);
        }

        .jachoei-header-right {
          flex-shrink: 0;
          display: flex;
          align-items: center;
          justify-content: flex-end;
        }

        .jachoei-lang-btn {
          border-radius: 14px !important;
          height: 38px !important;
          padding-inline: 12px !important;
          color: #0f172a !important;
        }

        .jachoei-login-btn {
          border-radius: 999px !important;
          padding-inline: 16px !important;
          height: 40px !important;
          border: 1px solid rgba(15,23,42,0.08) !important;
          box-shadow: 0 8px 18px rgba(15,23,42,0.05) !important;
        }

        .jachoei-mobile-search-backdrop {
          position: fixed;
          inset: 0;
          z-index: 1200;
          background: rgba(15,23,42,0.28);
          backdrop-filter: blur(4px);
          display: flex;
          align-items: flex-start;
          justify-content: center;
          padding: 72px 10px 10px;
        }

        .jachoei-mobile-search-card {
          width: 100%;
          max-width: 640px;
          background: rgba(255,255,255,0.98);
          border: 1px solid rgba(15,23,42,0.08);
          border-radius: 20px;
          padding: 12px;
          box-shadow: 0 20px 50px rgba(15,23,42,0.18);
        }

        .jachoei-mobile-search-top {
          display: flex;
          align-items: center;
          justify-content: space-between;
          margin-bottom: 10px;
        }

        @media (max-width: 1399px) {
          .jachoei-header-shell {
            grid-template-columns: minmax(220px, 320px) minmax(420px, 1fr) auto;
            gap: 16px;
            padding: 0 16px;
          }

          .jachoei-search-wrap {
            min-width: 360px;
          }
        }

        @media (max-width: 1179px) {
          .jachoei-header-shell {
            grid-template-columns: minmax(180px, 260px) minmax(260px, 1fr) auto;
            gap: 12px;
            padding: 0 12px;
          }

          .jachoei-brand-title {
            font-size: 17px;
          }

          .jachoei-search-wrap {
            min-width: 240px;
          }

          .jachoei-lang-btn {
            padding-inline: 10px !important;
          }
        }

        @media (max-width: 767px) {
          .jachoei-header-shell {
            grid-template-columns: minmax(0, 1fr) auto;
            gap: 8px;
            padding: 0 10px;
          }

          .jachoei-header-left {
            min-width: 0;
          }

          .jachoei-brand-link {
            gap: 8px;
            width: 100%;
            min-width: 0;
          }

          .jachoei-brand-icon {
            width: 38px;
            height: 38px;
            border-radius: 14px;
          }

          .jachoei-brand-copy {
            min-width: 0;
            max-width: 100%;
          }

          .jachoei-brand-title {
            font-size: 14px;
          }

          .jachoei-lang-btn {
            height: 34px !important;
            padding-inline: 8px !important;
          }

          .jachoei-login-btn {
            height: 36px !important;
            padding-inline: 12px !important;
          }
        }

        @media (max-width: 359px) {
          .jachoei-brand-copy {
            display: none;
          }
        }
      `}</style>
    </>
  );
}