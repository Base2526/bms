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
  ApiOutlined,
  RocketOutlined,
  ShopOutlined,
} from "@ant-design/icons";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { gql, useQuery } from "@apollo/client";

import { useSession } from "@/lib/useSession";
import { useGlobalChatStore } from "@/store/globalChatStore";
import { useI18n } from "@/lib/i18nContext";
import ThemeToggle from "@/components/ThemeToggle";
import type { Lang } from "@/i18n";

const { Header } = Layout;
const { Text } = Typography;

// ปิดไว้ก่อน — ค้นหา/ศูนย์ช่วยเหลือยังเป็นของ project เดิม (ไม่เกี่ยว BMS) เปิดใหม่เมื่อมีของจริงให้ผูก
const SHOW_HEADER_SEARCH = false;
const SHOW_HEADER_HELP = false;

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

const Q_MY_BMS_PERMISSIONS = gql`
  query HeaderMyBmsPermissions {
    myBmsPermissions
  }
`;

const Q_INBOX_UNREAD_COUNT = gql`
  query HeaderInboxUnreadCount {
    bmsInboxUnreadCount
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
  const { user: userSession, admin: adminSession, refreshSession } = useSession();
  const { t, lang, setLang } = useI18n();
  const isAdminSession = Boolean(adminSession);
  const hasSession = Boolean(userSession || adminSession);

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

  const { data: bmsPermsData } = useQuery(Q_MY_BMS_PERMISSIONS, {
    skip: !isAdminSession,
    fetchPolicy: "cache-and-network",
  });
  const canViewInbox = isAdminSession && (bmsPermsData?.myBmsPermissions ?? []).includes("inbox.view");

  const { data: inboxUnreadData } = useQuery(Q_INBOX_UNREAD_COUNT, {
    skip: !canViewInbox,
    fetchPolicy: "cache-and-network",
    pollInterval: 15000,
  });
  const inboxUnreadCount = inboxUnreadData?.bmsInboxUnreadCount ?? 0;

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
    const res = await fetch(isAdminSession ? "/api/auth/logout-admin" : "/api/auth/logout", { method: "POST" });
    if (res.ok) {
      message.success(t("common.logged_out"));
      try {
        refreshSession();
      } catch {}
      router.replace("/");
      setTimeout(() => window.location.reload(), 100);
    } else {
      message.error(t("common.logout_failed"));
    }
  }

  function showConfirmLogout() {
    Modal.confirm({
      title: t("common.confirm_logout_title"),
      content: t("common.confirm_logout_content"),
      okText: t("common.logout"),
      cancelText: t("common.cancel"),
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
            color: "rgba(var(--app-text-rgb),0.78)",
          }}
        >
          <span>
            <HistoryOutlined style={{ marginRight: 8, color: "var(--text-muted)" }} />
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
                    color: "var(--text-muted)",
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

  const profileMenu: MenuProps["items"] = isAdminSession
    ? [
        // ปุ่ม Dashboard แยกออกมาโชว์บน header เองแล้วตอน isDesktopView (jachoei-signup-btn ด้านล่าง)
        // เก็บไว้ในนี้เฉพาะ tablet/mobile ที่ไม่มีปุ่มแยกให้กด
        ...(!isDesktopView
          ? [
              {
                key: "dashboard",
                label: <Link href="/admin/dashboard">{t("header.dashboard")}</Link>,
                icon: <ShopOutlined />,
              },
            ]
          : []),
        {
          key: "settings",
          label: <Link href="/admin/settings">{t("common.settings")}</Link>,
          icon: <SettingOutlined />,
        },
        { type: "divider" },
        {
          key: "logout",
          label: <span onClick={showConfirmLogout}>{t("common.logout")}</span>,
          icon: <ReloadOutlined />,
        },
      ]
    : [
        {
          key: "settings",
          label: <Link href="/settings">{t("common.settings")}</Link>,
          icon: <SettingOutlined />,
        },
        { type: "divider" },
        {
          key: "logout",
          label: <span onClick={showConfirmLogout}>{t("common.logout")}</span>,
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
    color: "var(--app-text)",
  };

  const mobileOverflowMenu: MenuProps["items"] = useMemo(() => {
    const items: MenuProps["items"] = [];

    if (isAdminSession) {
      items.push(
        {
          key: "dashboard",
          label: t("header.dashboard"),
          icon: <ShopOutlined />,
          onClick: () => router.push("/admin/dashboard"),
        },
        ...(canViewInbox
          ? [
              {
                key: "inbox",
                label:
                  inboxUnreadCount > 0
                    ? `${t("header.inbox")} (${inboxUnreadCount > 99 ? "99+" : inboxUnreadCount})`
                    : t("header.inbox"),
                icon: <MessageOutlined />,
                onClick: () => router.push("/admin/inbox"),
              } as NonNullable<MenuProps["items"]>[number],
            ]
          : []),
        {
          key: "settings",
          label: t("common.settings"),
          icon: <SettingOutlined />,
          onClick: () => router.push("/admin/settings"),
        },
        { type: "divider" }
      );
    } else if (userSession) {
      items.push(
        // {
        //   key: "new-post",
        //   label: "New post",
        //   icon: <PlusOutlined />,
        //   onClick: () => router.push("/post/new"),
        // },
        {
          key: "blocked",
          label: t("header.blocked"),
          icon: <SafetyOutlined />,
          onClick: () => router.push("/blocked?tab=blocked"),
        },
        { type: "divider" }
      );
      if (SHOW_HEADER_HELP) {
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
    } else {
      items.push(
        {
          key: "demo",
          label: t("header.demo"),
          icon: <MessageOutlined />,
          onClick: () => router.push("/demo"),
        },
        {
          key: "workflow",
          label: t("header.workflow"),
          icon: <ApiOutlined />,
          onClick: () => router.push("/#workflow"),
        },
        {
          key: "security",
          label: t("header.security"),
          icon: <SafetyOutlined />,
          onClick: () => router.push("/#security"),
        },
        {
          key: "pricing",
          label: t("header.pricing"),
          icon: <ShopOutlined />,
          onClick: () => router.push("/#pricing"),
        },
        {
          key: "signup",
          label: t("header.startFree"),
          icon: <RocketOutlined />,
          onClick: () => router.push("/shop-signup"),
        },
        { type: "divider" }
      );

      if (SHOW_HEADER_HELP) items.push(
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
  }, [canViewInbox, changeLang, currentLang, inboxUnreadCount, isAdminSession, router, t, userSession]);

  return (
    <>
      <Header
        style={{
          background: "rgba(var(--app-surface-rgb),0.88)",
          backdropFilter: "blur(14px)",
          WebkitBackdropFilter: "blur(14px)",
          padding: 0,
          height: isMobileView ? 58 : 72,
          borderBottom: "1px solid var(--app-border)",
          position: "sticky",
          top: 0,
          zIndex: 1000,
          lineHeight: 1,
          boxShadow: "0 8px 30px rgba(15,23,42,0.04)",
        }}
      >
        <div className="jachoei-header-shell">
          <div className="jachoei-header-left">
            <Link href="/" aria-label={t("common.go_home")} className="jachoei-brand-link">
              <span className="jachoei-brand-icon">
                <img
                  src="/icons/icon.svg"
                  width={46}
                  height={46}
                  alt="BMS"
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
                    {t("header.subtitle")}
                  </Text>
                )}
              </div>
            </Link>
          </div>

          {!isMobileView && SHOW_HEADER_SEARCH && (
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
                          color: searchFocused ? "var(--app-primary)" : "var(--app-muted)",
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
                            color: "var(--app-muted)",
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
                                color: "var(--app-muted)",
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
                            color: "var(--app-muted)",
                          }}
                        />
                      ) : null
                    }
                    style={{
                      width: "100%",
                      borderRadius: 999,
                      paddingInline: isTabletView ? 12 : 16,
                      background: searchFocused
                        ? "rgba(var(--app-surface-rgb),1)"
                        : "rgba(var(--app-bg-rgb),0.92)",
                      border: searchFocused
                        ? "1px solid rgba(var(--app-primary-rgb),0.34)"
                        : "1px solid var(--app-border)",
                      boxShadow: searchFocused
                        ? "0 0 0 3px rgba(var(--app-primary-rgb),0.10), 0 10px 24px rgba(var(--app-shadow-rgb),0.10)"
                        : "0 4px 16px rgba(var(--app-shadow-rgb),0.04), inset 0 1px 0 rgba(var(--app-surface-rgb),0.75)",
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

          {!isMobileView && !hasSession && !SHOW_HEADER_SEARCH && (
            <nav className="jachoei-product-nav" aria-label={t("header.productNavigation")}>
              <Link href="/#workflow">{t("header.workflow")}</Link>
              <Link href="/demo">{t("header.demo")}</Link>
              <Link href="/#security">{t("header.security")}</Link>
              <Link href="/#pricing">{t("header.pricing")}</Link>
            </nav>
          )}

          <div className="jachoei-header-right">
            <Space size={isMobileView ? 4 : 6} align="center">
              {isMobileView && SHOW_HEADER_SEARCH && (
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
                  <Tooltip title={t("header.newPost") || "New post"}>
                    <Button
                      type="text"
                      style={iconButtonStyle}
                      onClick={() => router.push("/post/new")}
                      icon={<PlusOutlined style={{ fontSize: 18, color: "var(--app-text)" }} />}
                      aria-label={t("header.newPost")}
                    />
                  </Tooltip>

                  <Tooltip title={t("header.chat")}>
                    <Button
                      type="text"
                      style={iconButtonStyle}
                      onClick={() => router.push("/chat")}
                      icon={
                        <Badge count={totalUnread > 99 ? "99+" : totalUnread} size="small" offset={[-2, 2]}>
                          <MessageOutlined style={{ fontSize: 18, color: "var(--app-text)" }} />
                        </Badge>
                      }
                    />
                  </Tooltip>

                  <Tooltip title={t("header.notifications")}>
                    <Button
                      type="text"
                      style={iconButtonStyle}
                      onClick={() => router.push("/notification")}
                      icon={
                        <Badge count={notifUnreadCount > 99 ? "99+" : notifUnreadCount} size="small" offset={[-2, 2]}>
                          <BellOutlined style={{ fontSize: 18, color: "var(--app-text)" }} />
                        </Badge>
                      }
                    />
                  </Tooltip>
                </>
              )}

              <ThemeToggle />

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
                  >
                    <span className="jachoei-lang-content">
                      <span className="jachoei-lang-globe" aria-hidden="true">
                        <GlobalOutlined />
                      </span>
                      <span className="jachoei-lang-flag" aria-hidden="true">
                        {flagOf[currentLang]}
                      </span>
                      <span className="jachoei-lang-label">{labelOf[currentLang]}</span>
                    </span>
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
                  <Tooltip title={t("common.more")}>
                    <Button
                      type="text"
                      style={iconButtonStyle}
                      icon={<MoreOutlined style={{ fontSize: 18 }} />}
                      aria-label={t("common.more")}
                    />
                  </Tooltip>
                </Dropdown>
              )}

              {isDesktopView && SHOW_HEADER_HELP && (
                <Tooltip title={t("header.help")}>
                  <Button
                    type="text"
                    style={iconButtonStyle}
                    onClick={() => router.push("/help")}
                    icon={<QuestionCircleOutlined style={{ fontSize: 18 }} />}
                  />
                </Tooltip>
              )}

              {hasSession ? (
                <>
                  {isAdminSession && isDesktopView && (
                    <div className="jachoei-admin-quick-actions">
                      {canViewInbox && (
                        <Button
                          type="default"
                          icon={<MessageOutlined />}
                          size="large"
                          onClick={() => router.push("/admin/inbox")}
                          className="jachoei-admin-inbox-btn"
                        >
                          <span>{t("header.inbox")}</span>
                          {inboxUnreadCount > 0 && (
                            <span className="jachoei-admin-inbox-badge">
                              {inboxUnreadCount > 99 ? "99+" : inboxUnreadCount}
                            </span>
                          )}
                        </Button>
                      )}

                      <Button
                        type="primary"
                        icon={<ShopOutlined />}
                        size="large"
                        onClick={() => router.push("/admin/dashboard")}
                        className="jachoei-signup-btn"
                      >
                        {t("header.dashboard")}
                      </Button>
                    </div>
                  )}
                  <Dropdown
                    menu={{ items: profileMenu }}
                    trigger={["click"]}
                    placement="bottomRight"
                    arrow
                  >
                    <Avatar
                      size={isMobileView ? 34 : 38}
                      src={isAdminSession ? undefined : me?.avatar}
                      style={{
                        background: "linear-gradient(135deg, #64748b 0%, #334155 100%)",
                        cursor: "pointer",
                        boxShadow: "0 8px 18px rgba(15,23,42,0.14)",
                        border: "2px solid rgba(var(--app-surface-rgb),0.9)",
                      }}
                      icon={<UserOutlined />}
                    />
                  </Dropdown>
                </>
              ) : (
                <>
                  {isDesktopView && (
                    <Button
                      type="primary"
                      icon={<RocketOutlined />}
                      size="large"
                      onClick={() => router.push("/shop-signup")}
                      className="jachoei-signup-btn"
                    >
                      {t("header.startFree")}
                    </Button>
                  )}
                  <Button
                    icon={<LoginOutlined />}
                    size={isMobileView ? "middle" : "large"}
                    onClick={() => router.push("/admin/login")}
                    className="jachoei-login-btn"
                  >
                    {!isMobileView && t("common.login")}
                  </Button>
                </>
              )}
            </Space>
          </div>
        </div>
      </Header>

      {isMobileView && SHOW_HEADER_SEARCH && mobileSearchOpen && (
        <div className="jachoei-mobile-search-backdrop" onClick={() => setMobileSearchOpen(false)}>
          <div
            className="jachoei-mobile-search-card"
            onClick={(e) => e.stopPropagation()}
            role="dialog"
            aria-label={t("common.search")}
          >
            <div className="jachoei-mobile-search-top">
              <Text style={{ fontWeight: 700, color: "var(--app-text)" }}>
                {t("header.searchPlaceholder")}
              </Text>

              <Button
                type="text"
                onClick={() => setMobileSearchOpen(false)}
                icon={<CloseCircleFilled style={{ color: "var(--app-muted)" }} />}
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
                prefix={<SearchOutlined style={{ color: "var(--app-muted)" }} />}
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
                        color: "var(--app-muted)",
                      }}
                    />
                  ) : null
                }
                style={{
                  borderRadius: 16,
                  background: "var(--app-surface)",
                  border: "1px solid var(--app-border)",
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
          // background: linear-gradient(135deg, #0f172a 0%, #334155 100%);
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
          color: var(--app-text) !important;
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
          color: rgba(var(--app-text-rgb),0.52) !important;
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

        .jachoei-product-nav {
          min-width: 0;
          display: flex;
          align-items: center;
          justify-content: center;
          gap: 26px;
        }

        .jachoei-product-nav a {
          color: rgba(var(--app-text-rgb),0.66);
          font-size: 14px;
          font-weight: 600;
          text-decoration: none;
          transition: color .18s ease;
          white-space: nowrap;
        }

        .jachoei-product-nav a:hover {
          color: var(--app-primary);
        }

        .jachoei-search-wrap {
          width: 100%;
          max-width: 100%;
          min-width: 420px;
        }

        .jachoei-kbd {
          padding: 2px 7px;
          border-radius: 8px;
          background: rgba(var(--app-surface-rgb),0.86);
          border: 1px solid var(--app-border);
          box-shadow: inset 0 1px 0 rgba(var(--app-surface-rgb),0.9);
        }

        .jachoei-header-right {
          grid-column: 3;
          flex-shrink: 0;
          display: flex;
          align-items: center;
          justify-content: flex-end;
        }

        .jachoei-lang-btn {
          border-radius: 14px !important;
          height: 38px !important;
          padding-inline: 12px !important;
          color: var(--app-text) !important;
        }

        .jachoei-lang-content {
          display: inline-flex;
          align-items: center;
          gap: 8px;
          line-height: 1;
        }

        .jachoei-lang-globe {
          display: inline-flex;
          align-items: center;
          justify-content: center;
          line-height: 1;
        }

        .jachoei-lang-flag {
          display: inline-flex;
          align-items: center;
          justify-content: center;
          font-size: 18px;
          line-height: 1;
        }

        .jachoei-lang-label {
          display: inline-flex;
          align-items: center;
          line-height: 1;
        }

        .jachoei-lang-btn .anticon {
          display: inline-flex;
          align-items: center;
          justify-content: center;
          line-height: 1;
          vertical-align: 0;
        }

        .jachoei-login-btn {
          border-radius: 999px !important;
          padding-inline: 16px !important;
          height: 40px !important;
          border: 1px solid var(--app-border) !important;
          box-shadow: 0 8px 18px rgba(var(--app-shadow-rgb),0.05) !important;
        }

        .jachoei-admin-quick-actions {
          display: inline-flex;
          align-items: center;
          gap: 10px;
          margin-right: 2px;
        }

        .jachoei-signup-btn {
          border-radius: 999px !important;
          padding-inline: 16px !important;
          height: 40px !important;
          box-shadow: 0 10px 24px rgba(var(--app-primary-rgb),0.18) !important;
        }

        .jachoei-admin-inbox-btn {
          display: inline-flex !important;
          align-items: center !important;
          gap: 8px !important;
          border-radius: 999px !important;
          height: 40px !important;
          padding-inline: 14px !important;
          background: rgba(var(--app-primary-rgb),0.12) !important;
          border: 1px solid rgba(var(--app-primary-rgb),0.22) !important;
          color: var(--app-primary) !important;
          font-weight: 700 !important;
          box-shadow: 0 8px 18px rgba(var(--app-primary-rgb),0.10) !important;
        }

        .jachoei-admin-inbox-btn:hover {
          background: rgba(var(--app-primary-rgb),0.18) !important;
          color: var(--app-primary) !important;
          border-color: rgba(var(--app-primary-rgb),0.32) !important;
        }

        .jachoei-admin-inbox-badge {
          display: inline-flex;
          align-items: center;
          justify-content: center;
          min-width: 18px;
          height: 18px;
          padding: 0 5px;
          border-radius: 999px;
          background: #e5484d;
          color: #fff;
          font-size: 11px;
          font-weight: 800;
          line-height: 1;
        }

        .jachoei-mobile-search-backdrop {
          position: fixed;
          inset: 0;
          z-index: 1200;
          background: var(--app-overlay);
          backdrop-filter: blur(4px);
          display: flex;
          align-items: flex-start;
          justify-content: center;
          padding: 72px 10px 10px;
        }

        .jachoei-mobile-search-card {
          width: 100%;
          max-width: 640px;
          background: rgba(var(--app-surface-rgb),0.98);
          border: 1px solid var(--app-border);
          border-radius: 20px;
          padding: 12px;
          box-shadow: 0 20px 50px rgba(var(--app-shadow-rgb),0.18);
        }

        html.dark .jachoei-kbd {
          background: rgba(var(--app-text-rgb),0.06);
          border-color: var(--app-border);
          box-shadow: none;
          color: var(--app-text);
        }

        html.dark .jachoei-login-btn {
          border-color: var(--app-border) !important;
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

          .jachoei-product-nav {
            gap: 16px;
          }

          .jachoei-admin-quick-actions {
            gap: 8px;
          }
        }

        @media (max-width: 939px) {
          .jachoei-product-nav {
            display: none;
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

          .jachoei-header-right {
            grid-column: 2;
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
