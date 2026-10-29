ขอจับภาพรวมก่อนแล้วค่อยไล่ทีละ step แบบ practical เลยนะ
(จะโฟกัสกับ stack ที่คุณใช้: **Next.js App Router + React + AntD + GraphQL**)

---

## 0. แนวคิดก่อน – อยากได้ multi-language แบบไหน?

จากโค้ด HeaderBar ที่ให้มา คุณมี state `currentLang` (`th`/`en`) + cookie `lang` แล้ว แปลว่า:

* คุณอยากได้ **switch ภาษาได้จาก UI**
* อยากผูกกับ **cookie / session**
* อนาคตน่าจะอยากมี **JSON แยกไฟล์** + ใช้ key เช่น `"header.title"` แทน hard-code text

สิ่งที่ต้องออกแบบคือ:

1. จะใช้ **library ไหน**:

   * pure `react-intl`, `i18next`, `next-intl`, `next-i18next` ฯลฯ
2. จะใช้ **URL-based locale** ไหม (`/th/...` vs `/en/...`)
   หรือใช้ cookie + UI อย่างเดียว (ไม่เปลี่ยน path)
3. แยกข้อความเป็น **ไฟล์ translation** แล้ว inject เข้า component ยังไง

ผมจะเสนอแบบที่เหมาะกับโปรเจกต์คุณ (app router, มี backend GraphQL, ใช้ cookie อยู่แล้ว):

> **ใช้ pattern ง่าย ๆ ก่อน:**
>
> * เก็บ text ไว้ในไฟล์ JSON / TS object
> * มี **hook `useI18n()`** อ่าน lang จาก cookie + context
> * Component เรียก `t("header.title")` แทน hard-code
>
> ถ้าระบบโตมากแล้วค่อย migrate ไป lib ใหญ่เช่น `next-intl` ก็ยังทัน

---

## 1. โครงสร้างไฟล์ภาษา (แนะนำ)

สร้าง folder เช่น:

```txt
app/
  (admin)...
i18n/
  index.ts
  th.ts
  en.ts
```

`i18n/th.ts`

```ts
const th = {
  header: {
    title: "PROTECT SCAMMER",
    notifications: "แจ้งเตือน",
    messages: "ข้อความ",
    helpCenter: "ศูนย์ช่วยเหลือ",
    login: "เข้าสู่ระบบ",
    logout: "ออกจากระบบ",
    settings: "ตั้งค่า",
  },
  notificationPage: {
    title: "การแจ้งเตือน",
    tabAll: "ทั้งหมด",
    tabUnread: "ยังไม่อ่าน",
    tabChat: "แชท",
    tabPosts: "โพสต์",
    searchPlaceholder: "ค้นหาการแจ้งเตือน...",
    markAllRead: "อ่านทั้งหมด",
    settings: "ตั้งค่า",
    empty: "ยังไม่มีการแจ้งเตือน",
  },
  // ...
} as const;

export default th;
```

`i18n/en.ts`

```ts
const en = {
  header: {
    title: "PROTECT SCAMMER",
    notifications: "Notifications",
    messages: "Messages",
    helpCenter: "Help Center",
    login: "Login",
    logout: "Logout",
    settings: "Settings",
  },
  notificationPage: {
    title: "Notifications",
    tabAll: "All",
    tabUnread: "Unread",
    tabChat: "Chat",
    tabPosts: "Posts",
    searchPlaceholder: "Search notifications...",
    markAllRead: "Mark all as read",
    settings: "Settings",
    empty: "No notifications.",
  },
  // ...
} as const;

export default en;
```

`i18n/index.ts`

```ts
import th from "./th";
import en from "./en";

export type Lang = "th" | "en";

export const messages = {
  th,
  en,
};

export function getMessage(lang: Lang, path: string): string {
  const parts = path.split(".");
  let obj: any = messages[lang];

  for (const p of parts) {
    if (obj && typeof obj === "object" && p in obj) {
      obj = obj[p];
    } else {
      return path; // fallback คืน key เอง
    }
  }

  return typeof obj === "string" ? obj : path;
}
```

---

## 2. สร้าง context / hook `useI18n()`

สร้างที่ `lib/i18nContext.tsx`:

```tsx
"use client";

import React, { createContext, useContext, useMemo } from "react";
import { Lang, getMessage } from "@/i18n";

type I18nContextValue = {
  lang: Lang;
  t: (key: string) => string;
  setLang?: (lang: Lang) => void; // ให้ component ข้างในเปลี่ยนได้
};

const I18nContext = createContext<I18nContextValue>({
  lang: "th",
  t: (k) => k,
});

export function I18nProvider({
  lang,
  setLang,
  children,
}: {
  lang: Lang;
  setLang?: (lang: Lang) => void;
  children: React.ReactNode;
}) {
  const value = useMemo(
    () => ({
      lang,
      setLang,
      t: (key: string) => getMessage(lang, key),
    }),
    [lang, setLang]
  );

  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

export function useI18n() {
  return useContext(I18nContext);
}
```

จากนั้นใน layout หลัก (เช่น `app/layout.tsx` หรือ `app/(app)/layout.tsx`)
คุณมี cookie `lang` อยู่แล้ว → อ่านจาก server แล้วส่งลง I18nProvider

ตัวอย่างคร่าว ๆ ใน RootLayout (server component):

```tsx
// app/layout.tsx
import { cookies } from "next/headers";
import { I18nProvider } from "@/lib/i18nContext";
import type { Lang } from "@/i18n";

export default function RootLayout({ children }: { children: React.ReactNode }) {
  const cookieStore = cookies();
  const langCookie = cookieStore.get("lang")?.value as Lang | undefined;
  const lang: Lang = langCookie === "en" ? "en" : "th";

  return (
    <html lang={lang}>
      <body>
        {/* I18nProvider เป็น client component */}
        <I18nProvider lang={lang}>
          {children}
        </I18nProvider>
      </body>
    </html>
  );
}
```

ถ้า I18nProvider เป็น client component ต้องใช้ `dynamic(..., { ssr: false })` หรือ wrapper อีกชั้นก็ได้ แต่หลักการคือ:

* server อ่าน cookie `lang`
* pass เป็น initial lang ให้ I18nProvider

---

## 3. ใช้ใน HeaderBar / NotificationPage

### HeaderBar

ตอนนี้คุณ hard-code:

```tsx
<Text style={{ ... }}>
  PROTECT SCAMMER
</Text>
```

กับ tooltip:

```tsx
<Tooltip title="ข้อความ">
...
<Tooltip title="แจ้งเตือน">
...
<Tooltip title="ศูนย์ช่วยเหลือ">
```

ให้เปลี่ยนเป็นใช้ `useI18n()`:

```tsx
import { useI18n } from "@/lib/i18nContext";
import type { Lang } from "@/i18n";

// ...

export default function HeaderBar({ initialLang = "th" }: { initialLang?: Lang }) {
  const router = useRouter();
  const { user: userSession, refreshSession } = useSession();

  const { t, lang, setLang } = useI18n();

  // ภาษาใน dropdown ยังใช้ currentLang ก็ได้ แต่ควร sync กับ lang จาก context
  const [currentLang, setCurrentLang] = useState<Lang>(lang);

  useEffect(() => {
    setCurrentLang(lang);
  }, [lang]);

  const changeLang = (lang: Lang) => {
    if (lang === currentLang) return;
    document.cookie = `lang=${lang}; path=/; samesite=lax`;
    setCurrentLang(lang);
    setLang?.(lang);      // แจ้ง context ด้วย
    router.refresh();     // reload data ถ้ามี
  };

  // ...

  return (
    <Header ...>
      <Link href="/" ...>
        <Text style={{ ... }}>
          {t("header.title")}
        </Text>
      </Link>

      {/* ... */}

      {userSession && (
        <>
          <Tooltip title={t("header.messages")}>
            {/* ปุ่ม Messages */}
          </Tooltip>

          <Tooltip title={t("header.notifications")}>
            {/* ปุ่ม Notifications */}
          </Tooltip>
        </>
      )}

      {/* ... */}

      <Tooltip title={t("header.helpCenter")}>
        {/* ปุ่ม Help */}
      </Tooltip>
    </Header>
  );
}
```

### NotificationPage

เปลี่ยน text ที่ hard-code เช่น `"Notifications"`, `"Unread"`, `"Search notifications..."` ให้ใช้ `t`:

```tsx
import { useI18n } from "@/lib/i18nContext";

// ...

export default function NotificationPage() {
  const { t } = useI18n();

  // ...

  return (
    <div style={{ margin: '0 auto', padding: '24px' }}>
      <Space style={{ ... }}>
        <Space>
          <Title level={3} style={{ margin: 0 }}>
            {t("notificationPage.title")}
          </Title>
          {backendUnreadCount > 0 && <Badge count={backendUnreadCount} />}
        </Space>
        <Space>
          <Button type="link" icon={<SettingOutlined />}>
            {t("notificationPage.settings")}
          </Button>
          <Button onClick={onMarkAllRead} disabled={backendUnreadCount === 0}>
            {t("notificationPage.markAllRead")}
          </Button>
        </Space>
      </Space>

      <Space direction="vertical" style={{ width: '100%', marginBottom: 16 }}>
        <Tabs activeKey={tab} onChange={setTab}>
          <TabPane tab={t("notificationPage.tabAll")} key="all" />
          <TabPane tab={`${t("notificationPage.tabUnread")} (${backendUnreadCount})`} key="unread" />
          <TabPane tab={t("notificationPage.tabChat")} key="chat" />
          <TabPane tab={t("notificationPage.tabPosts")} key="post" />
        </Tabs>
        <Search
          placeholder={t("notificationPage.searchPlaceholder")}
          allowClear
          onChange={(e) => setSearch(e.target.value)}
        />
      </Space>

      {/* ... */}
      {!loading && !error && Object.keys(groups).length === 0 ? (
        <Text type="secondary">{t("notificationPage.empty")}</Text>
      ) : (
        // ...
      )}
    </div>
  );
}
```

---

## 4. URL สาธารณะ `/th/...` / `/en/...`

หน้าการตลาดและศูนย์เรียนรู้มี URL ภาษาคงที่แล้ว เช่น `/th/restaurant`, `/en/restaurant`,
`/th/learn/**` และ `/en/learn/**` โดย `middleware.ts` rewrite เข้า page implementation เดิมและ
กำหนด `lang` ให้ request นั้นก่อน RootLayout อ่านค่า จึงไม่ต้องทำสำเนา page/component สองชุด

* เพิ่มหน้าสาธารณะที่ต้อง index ใน `lib/publicSeo.ts` เท่านั้น ห้ามใส่ Admin, POS, checkout,
  signed-token หรือ tenant-shop URL ลง catalog นี้
* URL เดิมที่ไม่มีภาษา redirect 307 ตาม cookie และใช้ภาษาไทยเมื่อยังไม่มี cookie พร้อม `Cache-Control: private, no-store` เพื่อไม่ให้ cache ปลายทางภาษาของผู้ใช้
* metadata ต้องใช้ `publicAlternates()` เพื่อให้ self-canonical, `th-TH`, `en-US` และ
  `x-default` ตรงกัน
* link ระหว่างหน้าสาธารณะใช้ `localizedPublicPath()` เพื่อไม่สร้าง redirect hop
* `robots.ts` และ root `sitemap.ts` เป็น contract หลัก; sitemap ใส่เฉพาะ URL ที่เปิดเผยจริง
* `OAI-SearchBot` ใช้กับ ChatGPT Search ส่วนการอนุญาต GPTBot สำหรับ training เป็นนโยบายแยกกัน

---

## 5. สรุป roadmap ทำ i18n ในโปรเจกต์นี้

1. **แยกข้อความ** ไปไว้ใน `i18n/th.ts`, `i18n/en.ts` (ตามตัวอย่าง)
2. สร้าง helper `getMessage(lang, key)` + `useI18n()` context
3. อ่าน cookie `lang` ที่ RootLayout → ส่งเข้า I18nProvider
4. ค่อย ๆ เปลี่ยน component ให้ใช้ `t("...")` แทน hard-code
5. ปุ่มเปลี่ยนภาษาที่ Header:

   * เซ็ต cookie `lang=...`
   * ถ้าอยู่ public localized URL ให้เปลี่ยน prefix และคง query/hash ไว้
   * route อื่นเรียก `router.refresh()` เพื่อ sync server components

---

ถ้าคุณอยากได้ **เวอร์ชัน code เต็ม ๆ** ของ:

* `I18nProvider` ที่เป็น client component + ใช้ใน layout ของคุณตอนนี้เลย
* ตัวอย่าง i18n อีกสัก 2–3 page (เช่น `/settings`, `/chat`)

บอกผมได้เลย ผมจะปรับให้เข้ากับโครงสร้างโฟลเดอร์ปัจจุบันของโปรเจกต์คุณให้แบบ plug-and-play ครับ 🚀
