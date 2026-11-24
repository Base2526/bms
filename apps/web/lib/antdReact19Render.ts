"use client";
// =============================================================
// antd v5 static APIs on React 19.
// -------------------------------------------------------------
// message.*, notification.*, Modal.confirm/info/warning/error/success mount through
// rc-util's render(), which uses ReactDOM.createRoot or the legacy ReactDOM.render from the main
// "react-dom" export. React 19 removed both from that export, so after the Next 16 / React 19
// upgrade every static toast and confirmation silently rendered nothing (rc-util's legacy path is
// a no-op when render is missing). Found 2026-11-24 by calling the app bundle's own
// message.success/Modal.confirm on /admin/dashboard: nothing reached the DOM.
//
// antd documents this hook for v5 + React 19 (https://u.ant.design/v5-for-19); it adds no
// dependency. Imported once, first, by app/ClientProviders.tsx.
// =============================================================
import { unstableSetRender } from "antd";
import { createRoot, type Root } from "react-dom/client";

type RootContainer = (Element | DocumentFragment) & { __bmsAntdReactRoot?: Root };

unstableSetRender((node, container) => {
  const target = container as RootContainer;
  target.__bmsAntdReactRoot ??= createRoot(target);
  const root = target.__bmsAntdReactRoot;
  root.render(node);
  return async () => {
    // Let the closing animation's state update finish before unmounting.
    await new Promise((resolve) => setTimeout(resolve, 0));
    root.unmount();
    delete target.__bmsAntdReactRoot;
  };
});
