"use client";

import React, { memo, useMemo } from "react";
import { Button, Dropdown, type MenuProps, Tooltip } from "antd";
import { LaptopOutlined, MoonOutlined, SunOutlined } from "@ant-design/icons";

import { useTheme } from "@/lib/useTheme";
import type { ThemeMode } from "@/lib/theme";

function labelFor(mode: ThemeMode) {
  if (mode === "light") return "Light";
  if (mode === "dark") return "Dark";
  return "System";
}

function iconFor(mode: ThemeMode) {
  if (mode === "light") return <SunOutlined style={{ fontSize: 18 }} />;
  if (mode === "dark") return <MoonOutlined style={{ fontSize: 18 }} />;
  return <LaptopOutlined style={{ fontSize: 18 }} />;
}

function ThemeToggleInner() {
  const { theme, resolvedTheme, setTheme } = useTheme();

  const items: MenuProps["items"] = useMemo(
    () =>
      (["system", "light", "dark"] as ThemeMode[]).map((k) => ({
        key: k,
        label: labelFor(k),
      })),
    []
  );

  const menu = useMemo(
    () => ({
      items,
      selectable: true,
      selectedKeys: [theme],
      onClick: ({ key }: { key: string }) => {
        if (key === "light" || key === "dark" || key === "system") setTheme(key);
      },
    }),
    [items, setTheme, theme]
  );

  const tooltip = theme === "system" ? `Theme: System (${resolvedTheme})` : `Theme: ${labelFor(theme)}`;

  return (
    <Dropdown menu={menu} trigger={["click"]} placement="bottomRight" arrow>
      <Tooltip title={tooltip}>
        <Button
          type="text"
          aria-label={tooltip}
          icon={iconFor(theme)}
          style={{ minWidth: 40, height: 40, display: "inline-flex", alignItems: "center", justifyContent: "center" }}
          onClick={(e) => e.preventDefault()}
        />
      </Tooltip>
    </Dropdown>
  );
}

export default memo(ThemeToggleInner);
