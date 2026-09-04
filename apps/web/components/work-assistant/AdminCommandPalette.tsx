'use client';

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Input, Modal, type InputRef } from "antd";
import { SearchOutlined } from "@ant-design/icons";
import type { AdminNavItem } from "@/lib/bms/adminNavigation";
import { useAdminNavSearch, type AdminNavSearchContext } from "./adminNavSearch";

type Props = {
  open: boolean;
  onClose: () => void;
  items: readonly AdminNavItem[];
  labelFor: (item: AdminNavItem) => string;
  sectionLabelFor: (item: AdminNavItem) => string;
  iconFor: (item: AdminNavItem) => React.ReactNode;
  searchContext: Omit<AdminNavSearchContext, "labelFor">;
  t: (key: string) => string;
};

/**
 * Keyboard-triggered jump list for the ~60 destinations the Admin sidebar can hold once every
 * group and the platform workspace are counted. Scanning a collapsed accordion for something used
 * once a month does not scale; typing the word a cashier or bookkeeper actually uses does — see
 * `adminNavSearch.ts` for where that word list comes from (the assistant's own verified catalog,
 * not a second alias list written here).
 *
 * Opened from the sidebar's search button or ⌘K / Ctrl+K (wired in AdminSidebar, which owns the
 * global key listener so it keeps working while this component is unmounted).
 */
export default function AdminCommandPalette({
  open, onClose, items, labelFor, sectionLabelFor, iconFor, searchContext, t,
}: Props) {
  const router = useRouter();
  const inputRef = useRef<InputRef>(null);
  const [selected, setSelected] = useState(0);
  const { query, setQuery, results, ensureCatalogLoaded } = useAdminNavSearch(items, {
    ...searchContext,
    labelFor,
  });

  useEffect(() => {
    if (!open) {
      setQuery("");
      return;
    }
    ensureCatalogLoaded();
    setSelected(0);
    // Modal's own mount/animation needs a tick before the input exists to focus.
    const id = setTimeout(() => inputRef.current?.focus({ cursor: "all" }), 30);
    return () => clearTimeout(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  useEffect(() => { setSelected(0); }, [query]);

  function go(item: AdminNavItem) {
    onClose();
    router.push(item.route);
  }

  function onKeyDown(e: React.KeyboardEvent) {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setSelected((i) => (results.length ? (i + 1) % results.length : 0));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setSelected((i) => (results.length ? (i - 1 + results.length) % results.length : 0));
    } else if (e.key === "Enter") {
      e.preventDefault();
      const picked = results[selected];
      if (picked) go(picked.item);
    }
  }

  return (
    <Modal
      open={open}
      onCancel={onClose}
      footer={null}
      closable={false}
      width={560}
      style={{ top: 88 }}
      styles={{ body: { padding: 0 } }}
      destroyOnClose
    >
      <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "12px 16px", borderBottom: "1px solid var(--app-border)" }}>
        <SearchOutlined style={{ color: "var(--text-secondary)" }} />
        <Input
          ref={inputRef}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={onKeyDown}
          variant="borderless"
          placeholder={t("admin_nav.search_placeholder")}
          style={{ fontSize: 15, padding: 0 }}
          autoFocus
        />
        <kbd style={{
          fontSize: 11, color: "var(--text-secondary)", border: "1px solid var(--app-border)",
          borderRadius: 5, padding: "1px 6px", flexShrink: 0,
        }}>Esc</kbd>
      </div>
      <p style={{ margin: 0, padding: "7px 16px", fontSize: 11.5, color: "var(--text-secondary)", borderBottom: "1px solid var(--app-border)" }}>
        {t("admin_nav.search_hint")}
      </p>
      <div role="listbox" aria-label={t("admin_nav.search_placeholder")} style={{ padding: "6px 8px 10px", maxHeight: 360, overflowY: "auto" }}>
        {results.length === 0 ? (
          <p style={{ padding: "26px 16px", textAlign: "center", color: "var(--text-secondary)", fontSize: 13.5, margin: 0 }}>
            {t("admin_nav.search_empty")} &ldquo;{query}&rdquo;
          </p>
        ) : results.map((match, i) => (
          <div
            key={match.item.id}
            role="option"
            aria-selected={i === selected}
            onMouseEnter={() => setSelected(i)}
            onClick={() => go(match.item)}
            style={{
              display: "flex", alignItems: "center", gap: 10, padding: "9px 10px", borderRadius: 8, cursor: "pointer",
              background: i === selected ? "rgba(var(--app-primary-rgb), 0.1)" : "transparent",
            }}
          >
            <span style={{ color: i === selected ? "var(--app-primary)" : "var(--text-secondary)", display: "flex", flexShrink: 0 }}>
              {iconFor(match.item)}
            </span>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 14, color: "var(--app-text)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                {labelFor(match.item)}
              </div>
              {match.matchedVia === "guide" && match.summary ? (
                <div style={{ fontSize: 11.5, color: "var(--text-secondary)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                  {match.summary}
                </div>
              ) : null}
            </div>
            <span style={{
              fontSize: 10.5, color: "var(--text-secondary)", border: "1px solid var(--app-border)",
              borderRadius: 999, padding: "1px 8px", flexShrink: 0, whiteSpace: "nowrap",
            }}>
              {sectionLabelFor(match.item)}
            </span>
          </div>
        ))}
      </div>
    </Modal>
  );
}
