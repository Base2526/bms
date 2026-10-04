"use client";

import { useMemo, useState } from "react";
import { Select } from "antd";
import { SearchOutlined } from "@ant-design/icons";
import { gameCopyOptions, matchesGameSearch, normalizeGameSearch, type SearchableGame } from "@/lib/pos/boardGameLibrarySearch";
import styles from "./BoardGameCopyPicker.module.css";

export default function BoardGameCopyPicker({ titles, value, onChange, disabled, placeholder, emptyText, statusLabel }: {
  titles: SearchableGame[];
  value: string;
  onChange: (id: string) => void;
  disabled?: boolean;
  placeholder: string;
  emptyText: string;
  statusLabel: (status: string) => string;
}) {
  const [search, setSearch] = useState("");
  const options = useMemo(() => gameCopyOptions(titles), [titles]);
  return <Select
    className={styles.picker}
    aria-label={placeholder}
    showSearch allowClear virtual
    disabled={disabled}
    value={value || undefined}
    placeholder={placeholder}
    suffixIcon={<SearchOutlined />}
    searchValue={search}
    onSearch={(query) => { setSearch(query); if (value) onChange(""); }}
    onChange={(id) => { onChange(id ?? ""); setSearch(""); }}
    onClear={() => setSearch("")}
    options={options}
    filterOption={(query, option) => Boolean(option && matchesGameSearch(query, option.title, option.copyCode))}
    notFoundContent={emptyText}
    listHeight={280}
    listItemHeight={56}
    onInputKeyDown={(event) => {
      if (event.key !== "Enter" || event.nativeEvent.isComposing) return;
      // A focused HID scan selects an exact copy; it never submits a loan or a parent form.
      event.preventDefault();
      if (!search.trim()) return;
      const exact = options.filter((option) => normalizeGameSearch(option.copyCode) === normalizeGameSearch(search));
      if (exact.length) {
        event.stopPropagation();
        if (exact.length === 1 && !exact[0].disabled) {
          onChange(exact[0].value);
          setSearch("");
        }
      }
    }}
    optionRender={({ data }) => <div className={styles.option} title={`${data.label} · ${statusLabel(data.status)}`}>
      <strong>{data.title}</strong>
      <span>{data.copyCode} · {statusLabel(data.status)}</span>
    </div>}
  />;
}
