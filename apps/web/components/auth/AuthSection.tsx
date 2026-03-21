"use client";

import React, { memo } from "react";

type Props = {
  children: React.ReactNode;
};

function AuthSectionInner({ children }: Props) {
  return <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>{children}</div>;
}

export default memo(AuthSectionInner);
