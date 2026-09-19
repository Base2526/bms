'use client';

import { useState, type CSSProperties, type ReactNode } from 'react';

type Props = {
  children: ReactNode;
  className?: string;
  style?: CSSProperties;
  role?: 'alert' | 'status';
  onClose?: () => void;
};

/**
 * Common close behaviour for the hand-built POS banners that do not use Ant Design Alert.
 * Closing changes presentation only; the server-derived blocker or business state is untouched.
 * A caller can use a content-derived React key when a new message must show again.
 */
export default function PosDismissibleAlert({
  children,
  className,
  style,
  role = 'alert',
  onClose,
}: Props) {
  const [visible, setVisible] = useState(true);

  if (!visible) return null;

  return (
    <div
      className={className}
      role={role}
      style={{ ...style, position: 'relative', paddingRight: style?.paddingRight ?? 42 }}
    >
      {children}
      <button
        type="button"
        className="pos-alert-close"
        aria-label="ปิดการแจ้งเตือน"
        title="ปิด"
        onClick={() => {
          setVisible(false);
          onClose?.();
        }}
        style={{
          position: 'absolute',
          top: 6,
          right: 6,
          width: 28,
          height: 28,
          minWidth: 28,
          minHeight: 28,
          padding: 0,
          display: 'grid',
          placeItems: 'center',
          border: 0,
          borderRadius: 6,
          background: 'transparent',
          color: 'currentColor',
          fontSize: 18,
          lineHeight: 1,
          cursor: 'pointer',
          opacity: 0.72,
          boxShadow: 'none',
        }}
      >
        <span aria-hidden="true">×</span>
      </button>
    </div>
  );
}
