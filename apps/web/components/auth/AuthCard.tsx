"use client";

import React, { memo, useMemo } from "react";
import { Card } from "antd";

const AUTH_CARD_CSS = `
  .auth-card .ant-card-head {
    flex-wrap: wrap;
    row-gap: 8px;
  }

  .auth-card .ant-card-extra {
    margin-left: auto;
  }

  @media (max-width: 480px) {
    .auth-card .ant-card-extra {
      width: 100%;
      margin-left: 0;
    }

    .auth-card-actions {
      width: 100%;
      display: flex;
      justify-content: space-between;
    }
  }
`;

const AUTH_CARD_STYLE_INNER_HTML = { __html: AUTH_CARD_CSS };

type Props = {
  title: React.ReactNode;
  extra?: React.ReactNode;
  children: React.ReactNode;
  maxWidth?: number;
};

function AuthCardInner({ title, extra, children, maxWidth = 420 }: Props) {
  const style = useMemo(() => ({ width: "100%", maxWidth, margin: "0 auto" as const }), [maxWidth]);

  return (
    <>
      <Card title={title} className="auth-card" extra={extra} style={style}>
        {children}
      </Card>

      <style dangerouslySetInnerHTML={AUTH_CARD_STYLE_INNER_HTML} />
    </>
  );
}

export default memo(AuthCardInner);
