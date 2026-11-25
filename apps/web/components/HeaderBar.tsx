"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  Layout,
  Button,
  Tooltip,
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
  VideoCameraOutlined,
} from "@ant-design/icons";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { gql, useQuery } from "@apollo/client";

import { useSession } from "@/lib/useSession";
import { useGlobalChatStore } from "@/store/globalChatStore";
import { useI18n } from "@/lib/i18nContext";
import ThemeToggle from "@/components/ThemeToggle";
import type { Lang } from "@/i18n";
import { getLangCookie, setLangCookie } from "@/lib/lang";
import { localeFromPublicPath, localizedPublicPath, stripPublicLocale } from "@/lib/publicSeo";

const { Header } = Layout;
const { Text } = Typography;

// Admin ค้น catalog ตามสิทธิ์; ผู้ใช้ทั่วไปค้นเฉพาะบทเรียนสาธารณะที่ /learn
const SHOW_HEADER_SEARCH = true;
const SHOW_HEADER_HELP = false;
const HEADER_SEARCH_HISTORY_KEY = "bmsKnowledgeSearchHistory";
const PUBLIC_SEARCH_HISTORY_KEY = "bmsPublicLearningSearchHistory";
const SEARCH_HISTORY_LIMIT = 10;

function normalizeSearchHistory(value: unknown): string[] {
  if (!Array.isArray(value)) return [];

  const seen = new Set<string>();
  const normalized: string[] = [];
  for (const item of value) {
    if (typeof item !== "string") continue;
    const term = item.trim();
    if (!term || seen.has(term)) continue;
    seen.add(term);
    normalized.push(term);
    if (normalized.length === SEARCH_HISTORY_LIMIT) break;
  }
  return normalized;
}

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
  const pathname = usePathname() || "/";
  const { user: userSession, admin: adminSession, refreshSession } = useSession();
  const { t, lang, setLang } = useI18n();
  const isAdminSession = Boolean(adminSession);
  const hasSession = Boolean(userSession || adminSession);
  const showHeaderSearch = SHOW_HEADER_SEARCH && isAdminSession;
  const showPublicLearningSearch = SHOW_HEADER_SEARCH && !isAdminSession;
  const searchHistoryKey = isAdminSession
    ? `${HEADER_SEARCH_HISTORY_KEY}:${adminSession?.id ?? "unknown-admin"}`
    : PUBLIC_SEARCH_HISTORY_KEY;

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
  const [isMacKeyboard, setIsMacKeyboard] = useState(false);

  const searchInputRef = useRef<InputRef | null>(null);
  const mobileSearchInputRef = useRef<InputRef | null>(null);

  useEffect(() => {
    setIsMacKeyboard(navigator.platform.toLowerCase().includes("mac"));
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
    const c = getLangCookie();
    if (c && c !== currentLang) setCurrentLang(c);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (typeof window === "undefined") return;
    try {
      const raw = window.localStorage.getItem(searchHistoryKey);
      setSearchHistory([]);
      if (raw) {
        const parsed = JSON.parse(raw);
        const normalized = normalizeSearchHistory(parsed);
        setSearchHistory(normalized);
        if (JSON.stringify(parsed) !== JSON.stringify(normalized)) {
          window.localStorage.setItem(searchHistoryKey, JSON.stringify(normalized));
        }
      }
    } catch (e) {
      console.warn("[Search] load history error", e);
    }
  }, [searchHistoryKey]);

  useEffect(() => {
    if (!isDesktopView) return;

    const handler = (e: KeyboardEvent) => {
      const isMac = navigator.platform.toLowerCase().includes("mac");
      const metaPressed = isMac ? e.metaKey : e.ctrlKey;
      if (metaPressed && e.key.toLowerCase() === "k") {
        e.preventDefault();
        if (showHeaderSearch) searchInputRef.current?.focus?.();
        else if (showPublicLearningSearch) setMobileSearchOpen(true);
      }
    };

    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [isDesktopView, showHeaderSearch, showPublicLearningSearch]);

  useEffect(() => {
    if (!mobileSearchOpen) return;
    const id = window.setTimeout(() => {
      mobileSearchInputRef.current?.focus?.();
    }, 60);
    return () => window.clearTimeout(id);
  }, [mobileSearchOpen]);

  useEffect(() => {
    if (!mobileSearchOpen) return;

    const previousOverflow = document.body.style.overflow;
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setMobileSearchOpen(false);
    };
    document.body.style.overflow = "hidden";
    window.addEventListener("keydown", closeOnEscape);
    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener("keydown", closeOnEscape);
    };
  }, [mobileSearchOpen]);

  const changeLang = (nextLang: Lang) => {
    if (nextLang === currentLang) return;
    setLangCookie(nextLang);
    setCurrentLang(nextLang);
    setLang?.(nextLang);
    if (localeFromPublicPath(pathname)) {
      const nextPath = localizedPublicPath(stripPublicLocale(pathname), nextLang);
      window.location.assign(`${nextPath}${window.location.search}${window.location.hash}`);
      return;
    }
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
      try {
        window.localStorage.setItem(searchHistoryKey, JSON.stringify(list));
      } catch (e) {
        console.warn("[Search] save history error", e);
      }
    }
  };

  const addToHistory = (term: string) => {
    const trimmed = term.trim();
    if (!trimmed) return;
    const next = normalizeSearchHistory([trimmed, ...searchHistory]);
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
    const destination = isAdminSession
      ? "/admin/search"
      : localizedPublicPath("/learn", currentLang);
    router.push(`${destination}?q=${encodeURIComponent(q)}`, { scroll: false });
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
        {
          key: "live-dashboard",
          label: t("header.liveDashboard"),
          icon: <VideoCameraOutlined />,
          onClick: () => router.push("/live-dashboard"),
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
            label: t("header.help"),
            icon: <QuestionCircleOutlined />,
            onClick: () => router.push(localizedPublicPath("/help", currentLang)),
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
          onClick: () => router.push(localizedPublicPath("/demo", currentLang)),
        },
        {
          key: "workflow",
          label: t("header.workflow"),
          icon: <ApiOutlined />,
          onClick: () => router.push(localizedPublicPath("/#workflow", currentLang)),
        },
        {
          key: "security",
          label: t("header.security"),
          icon: <SafetyOutlined />,
          onClick: () => router.push(localizedPublicPath("/#security", currentLang)),
        },
        {
          key: "pricing",
          label: t("header.pricing"),
          icon: <ShopOutlined />,
          onClick: () => router.push(localizedPublicPath("/#pricing", currentLang)),
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
          label: t("header.help"),
          icon: <QuestionCircleOutlined />,
          onClick: () => router.push(localizedPublicPath("/help", currentLang)),
        },
        { type: "divider" }
      );
    }

    items.push(
      {
        key: "learning-center",
        label: t("header.learningCenter"),
        icon: <QuestionCircleOutlined />,
        onClick: () => router.push(localizedPublicPath("/learn", currentLang)),
      },
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
        className="jachoei-header"
        style={{
          background: "rgba(var(--app-surface-rgb),0.88)",
          backdropFilter: "blur(14px)",
          WebkitBackdropFilter: "blur(14px)",
          padding: 0,
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
            <Link href={localizedPublicPath("/", currentLang)} aria-label={t("common.go_home")} className="jachoei-brand-link">
              <span className="jachoei-brand-icon">
                <img
                  src="/icons/icon.svg"
                  width={46}
                  height={46}
                  alt="BMS POS+"
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

          {!isMobileView && showHeaderSearch && (
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
                            <span className="jachoei-kbd">{isMacKeyboard ? "⌘" : "Ctrl"}</span>
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

          {!isMobileView && !hasSession && !showHeaderSearch && (
            <nav className="jachoei-product-nav" aria-label={t("header.productNavigation")}>
              <Link href={localizedPublicPath("/#workflow", currentLang)}>{t("header.workflow")}</Link>
              <Link href={localizedPublicPath("/demo", currentLang)}>{t("header.demo")}</Link>
              <Link href={localizedPublicPath("/#security", currentLang)}>{t("header.security")}</Link>
              <Link href={localizedPublicPath("/#pricing", currentLang)}>{t("header.pricing")}</Link>
              <Link href={localizedPublicPath("/learn", currentLang)}>{t("header.learningCenter")}</Link>
            </nav>
          )}

          <div className="jachoei-header-right">
            <div className="jachoei-header-actions">
              {isMobileView && showHeaderSearch && (
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
                  <Tooltip title={t("header.newPost")}>
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

              {showPublicLearningSearch && (
                <Tooltip title={t("header.searchPlaceholder")}>
                  <Button
                    type="text"
                    data-public-learning-search-trigger
                    style={iconButtonStyle}
                    onClick={() => setMobileSearchOpen(true)}
                    icon={<SearchOutlined style={{ fontSize: 18 }} />}
                    aria-label={t("header.searchPlaceholder")}
                  />
                </Tooltip>
              )}

              <ThemeToggle />

              <span className="jachoei-desktop-language">
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
              </span>
              <span className="jachoei-mobile-menu">
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
              </span>

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
                      <Tooltip title={t("header.liveDashboard")}>
                        <button
                          type="button"
                          onClick={() => router.push("/live-dashboard")}
                          className="jachoei-admin-icon-btn jachoei-admin-live-icon"
                          aria-label={t("header.liveDashboard")}
                        >
                          <VideoCameraOutlined />
                        </button>
                      </Tooltip>

                      {canViewInbox && (
                        <Tooltip title={t("header.inbox")}>
                          <button
                            type="button"
                            onClick={() => router.push("/admin/inbox")}
                            className="jachoei-admin-icon-btn"
                            aria-label={t("header.inbox")}
                          >
                            <MessageOutlined />
                            {inboxUnreadCount > 0 && (
                              <span className="jachoei-admin-inbox-badge">
                                {inboxUnreadCount > 99 ? "99+" : inboxUnreadCount}
                              </span>
                            )}
                          </button>
                        </Tooltip>
                      )}

                      <Tooltip title={t("header.dashboard")}>
                        <button
                          type="button"
                          onClick={() => router.push("/admin/dashboard")}
                          className="jachoei-admin-icon-btn jachoei-admin-icon-btn-primary"
                          aria-label={t("header.dashboard")}
                        >
                          <ShopOutlined />
                        </button>
                      </Tooltip>
                    </div>
                  )}
                  <Dropdown
                    menu={{ items: profileMenu }}
                    trigger={["click"]}
                    placement="bottomRight"
                    arrow
                  >
                    <Avatar
                      data-header-profile-avatar
                      size={isMobileView ? 34 : 38}
                      src={(isAdminSession ? adminSession?.avatar : me?.avatar) || undefined}
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
                  <Button
                    type="primary"
                    icon={<RocketOutlined />}
                    size="large"
                    onClick={() => router.push("/shop-signup")}
                    className="jachoei-signup-btn"
                  >
                    {t("header.startFree")}
                  </Button>
                  <Button
                    icon={<LoginOutlined />}
                    size={isMobileView ? "middle" : "large"}
                    onClick={() => router.push("/admin/login")}
                    className="jachoei-login-btn"
                  >
                    <span className="jachoei-login-label">{t("common.login")}</span>
                  </Button>
                </>
              )}
            </div>
          </div>
        </div>
      </Header>

      {(showPublicLearningSearch || (isMobileView && showHeaderSearch)) && mobileSearchOpen && (
        <div className="jachoei-mobile-search-backdrop" onClick={() => setMobileSearchOpen(false)}>
          <div
            className="jachoei-mobile-search-card"
            onClick={(e) => e.stopPropagation()}
            role="dialog"
            aria-modal="true"
            aria-label={t("common.search")}
          >
            <div className="jachoei-mobile-search-top">
              <Text className="jachoei-mobile-search-title">
                {t("header.searchPlaceholder")}
              </Text>

              <Button
                type="text"
                onClick={() => setMobileSearchOpen(false)}
                icon={<CloseCircleFilled style={{ color: "var(--app-muted)" }} />}
                aria-label={t("header.searchClose")}
              />
            </div>

            <AutoComplete
              value={searchValue}
              onChange={setSearchValue}
              onSelect={handleSearchSelect}
              options={searchOptions}
              popupMatchSelectWidth
              className="jachoei-mobile-search-autocomplete"
              style={{ width: "100%" }}
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

            {searchHistory.length > 0 && (
              <section className="jachoei-search-history" data-search-history>
                <div className="jachoei-search-history-header">
                  <Text className="jachoei-search-history-title">
                    <HistoryOutlined aria-hidden="true" />
                    {t("header.searchRecent")}
                  </Text>
                  <Button
                    type="text"
                    size="small"
                    className="jachoei-search-history-clear"
                    onClick={clearHistory}
                  >
                    {t("header.searchClearHistory")}
                  </Button>
                </div>
                <div className="jachoei-search-history-list">
                  {searchHistory.map((term) => (
                    <button
                      type="button"
                      key={term}
                      className="jachoei-search-history-item"
                      data-search-history-item={term}
                      onClick={() => handleSearchSelect(term)}
                    >
                      <HistoryOutlined aria-hidden="true" />
                      <span>{term}</span>
                    </button>
                  ))}
                </div>
              </section>
            )}
          </div>
        </div>
      )}

    </>
  );
}
