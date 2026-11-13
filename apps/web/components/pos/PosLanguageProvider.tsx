"use client";

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { ConfigProvider } from "antd";
import enGB from "antd/locale/en_GB";
import thTH from "antd/locale/th_TH";
import { I18nProvider, useI18n } from "@/lib/i18nContext";
import { setLangCookie } from "@/lib/lang";
import type { Lang } from "@/i18n";
import "@/lib/pos/deviceTokenClient";

/** Device-local operator preference. Never reload/remount a register with an active bill. */
export function PosLanguageProvider({ children }: { children: ReactNode }) {
  const inherited = useI18n();
  const [lang, setLanguage] = useState<Lang>(inherited.lang);
  const revision = useRef(0);
  const pendingSaves = useRef(0);
  const channel = useRef<BroadcastChannel | null>(null);
  const [saveError, setSaveError] = useState(false);
  const apply = useCallback((next: Lang, broadcast = true) => {
    setLanguage(next);
    setLangCookie(next, 365 * 24 * 60 * 60);
    document.documentElement.lang = next;
    if (broadcast) channel.current?.postMessage({ language: next });
  }, []);
  useEffect(() => {
    let active = true;
    const startedAt = revision.current;
    const bridge = window.bmsDesktop;
    // Customer displays deliberately have no credential bridge. Share only presentation state
    // over the same-origin channel, including a handshake for already-open windows.
    const isRegister = ["/pos", "/pos/app", "/pos/restaurant"].includes(window.location.pathname);
    const languageChannel = typeof BroadcastChannel === "undefined"
      ? null : new BroadcastChannel("bms.pos.language");
    channel.current = languageChannel;
    if (languageChannel) {
      languageChannel.onmessage = ({ data }) => {
        if (data?.request === true && isRegister) {
          languageChannel.postMessage({ language: document.documentElement.lang });
        } else if (!pendingSaves.current && (data?.language === "th" || data?.language === "en")) {
          revision.current += 1;
          apply(data.language, false);
        }
      };
      languageChannel.postMessage({ request: true });
    }
    void bridge
      ?.getLanguage?.()
      .then((value) => {
        if (
          active &&
          revision.current === startedAt &&
          (value === "th" || value === "en")
        )
          apply(value);
      })
      .catch(() => undefined);
    const stop = bridge?.onLanguageChanged?.((value) => {
      if (!pendingSaves.current && (value === "th" || value === "en")) {
        revision.current += 1;
        setSaveError(false);
        apply(value);
      }
    });
    return () => {
      active = false;
      stop?.();
      languageChannel?.close();
      channel.current = null;
    };
  }, [apply]);
  const setLang = useCallback(
    (next: Lang) => {
      const selectedRevision = ++revision.current;
      apply(next);
      setSaveError(false);
      const save = window.bmsDesktop?.setLanguage;
      if (!save) return;
      pendingSaves.current += 1;
      void save(next)
        .then((result) => {
          if (revision.current === selectedRevision) setSaveError(!result?.ok);
        })
        .catch(() => {
          if (revision.current === selectedRevision) setSaveError(true);
        })
        .finally(() => { pendingSaves.current -= 1; });
    },
    [apply]
  );
  return (
    <I18nProvider lang={lang} setLang={setLang}>
      <ConfigProvider locale={lang === "en" ? enGB : thTH}>
        {saveError && (
          <div role="status">
            {lang === "en"
              ? "Language changed for this session, but could not be saved in the desktop app."
              : "เปลี่ยนภาษาในรอบนี้แล้ว แต่บันทึกในแอปเดสก์ท็อปไม่สำเร็จ"}
          </div>
        )}
        {children}
      </ConfigProvider>
    </I18nProvider>
  );
}

export function PosLanguageSelector() {
  const { lang, setLang } = useI18n();
  return (
    <select
      aria-label="Language / ภาษา"
      value={lang}
      onChange={(event) => setLang?.(event.target.value === "en" ? "en" : "th")}
      style={{
        minHeight: 40,
        maxWidth: 112,
        padding: "6px 10px",
        border: "1px solid #d0d5dd",
        borderRadius: 8,
        background: "#fff",
        color: "#101828",
      }}
    >
      <option value="th">ไทย</option>
      <option value="en">English</option>
    </select>
  );
}
