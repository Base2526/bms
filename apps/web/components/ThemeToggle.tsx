"use client";

import React, { memo, useMemo } from "react";
import { Button, Dropdown, type MenuProps, Tooltip } from "antd";
import { LaptopOutlined, MoonOutlined, SunOutlined } from "@ant-design/icons";
import { gql, useMutation } from "@apollo/client";

import { useTheme } from "@/lib/useTheme";
import { useSession } from "@/lib/useSession";
import type { ThemeMode } from "@/lib/theme";

const M_UPDATE_THEME = gql`
  mutation($data: MeInput!) {
    updateMe(data: $data) {
      id
      themePreference
    }
  }
`;

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
  const { isAuthenticated } = useSession();
  const [updateTheme] = useMutation(M_UPDATE_THEME);

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
        if (key === "light" || key === "dark" || key === "system") {
          setTheme(key);
          if (isAuthenticated) {
            void updateTheme({ variables: { data: { themePreference: key } } }).catch(() => {
              // Keep the local preference if saving to the profile fails.
            });
          }
        }
      },
    }),
    [items, setTheme, theme, updateTheme, isAuthenticated]
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
