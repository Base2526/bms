import type { FlowIconName } from "./flowTypes";

type FlowIconProps = {
  name: FlowIconName;
  size?: number;
  className?: string;
  x?: number;
  y?: number;
};

function IconPaths({ name }: { name: FlowIconName }) {
  switch (name) {
    case "chat": return <path d="M21 12a8 8 0 0 1-11.6 7.1L4 20l1-4.6A8 8 0 1 1 21 12z" />;
    case "phone": return <><rect x="7" y="2.5" width="10" height="19" rx="2" /><path d="M11 18h2" /></>;
    case "globe": return <><circle cx="12" cy="12" r="9" /><path d="M3 12h18M12 3c3 3.5 3 14.5 0 18M12 3c-3 3.5-3 14.5 0 18" /></>;
    case "store": return <><path d="M3.5 9 5 4h14l1.5 5" /><path d="M3.5 9h17v1.5a2.8 2.8 0 0 1-5.6 0 2.8 2.8 0 0 1-5.8 0 2.8 2.8 0 0 1-5.6 0z" /><path d="M5 13v7h14v-7M10 20v-4h4v4" /></>;
    case "spark": return <><path d="M12 3l2 5.5L19.5 11 14 13l-2 5.5L10 13 4.5 11 10 8.5z" /><path d="M19 3v3M17.5 4.5h3" /></>;
    case "users": return <><circle cx="9" cy="8" r="3.5" /><path d="M2.5 20a6.5 6.5 0 0 1 13 0M16 4.6a3.5 3.5 0 0 1 0 6.8M18 14.2A6.5 6.5 0 0 1 21.5 20" /></>;
    case "box": return <><path d="M21 8 12 3 3 8l9 5 9-5z" /><path d="M3 8v8l9 5 9-5V8M12 13v8" /></>;
    case "card": return <><rect x="2.5" y="5" width="19" height="14" rx="2" /><path d="M2.5 10h19M6 15h4" /></>;
    case "doc": return <><path d="M6 3h9l4 4v14H6z" /><path d="M15 3v4h4M9 12h6M9 16h6" /></>;
    case "truck": return <><path d="M2.5 7h11v9h-11zM13.5 10h4l3 3v3h-7" /><circle cx="7" cy="18" r="2" /><circle cx="17" cy="18" r="2" /></>;
    case "chart": return <path d="M4 20V11M10 20V5M16 20v-7M21.5 20h-19" />;
    case "target": return <><circle cx="12" cy="12" r="9" /><circle cx="12" cy="12" r="5" /><circle cx="12" cy="12" r="1" /></>;
    case "ucheck": return <><circle cx="10" cy="8" r="4" /><path d="M3 21a7 7 0 0 1 11-5.7M15.5 18l2 2 4-4" /></>;
    case "lock": return <><rect x="5" y="11" width="14" height="10" rx="2" /><path d="M8 11V7a4 4 0 0 1 8 0v4" /></>;
    case "hist": return <><path d="M3.5 12a8.5 8.5 0 1 0 2.5-6" /><path d="M3.5 4v5h5M12 7.5V12l3 2" /></>;
    case "monitor": return <><rect x="3" y="4" width="18" height="12" rx="2" /><path d="M8 20h8M12 16v4" /></>;
    case "server": return <><rect x="3.5" y="3.5" width="17" height="7" rx="1.5" /><rect x="3.5" y="13.5" width="17" height="7" rx="1.5" /><path d="M7 7h.01M7 17h.01M11 7h6M11 17h6" /></>;
    case "pulse": return <path d="M2.5 12h4l2.5-6 4 12 3-9 1.5 3h4" />;
    case "shield": return <><path d="M12 3l8 3v6c0 5-3.5 8-8 9-4.5-1-8-4-8-9V6z" /><path d="M9 12l2 2 4-4" /></>;
    case "qr": return <><rect x="3.5" y="3.5" width="6.5" height="6.5" rx="1" /><rect x="14" y="3.5" width="6.5" height="6.5" rx="1" /><rect x="3.5" y="14" width="6.5" height="6.5" rx="1" /><path d="M14 14h3v3h-3zM20.5 14v6.5M14 20.5h3" /></>;
    case "gift": return <><rect x="3.5" y="8" width="17" height="4" rx="1" /><path d="M5 12v8.5h14V12M12 8v12.5M12 8C10 4 6.5 4.5 7.5 7c.6 1 4.5 1 4.5 1zM12 8c2-4 5.5-3.5 4.5-1-.6 1-4.5 1-4.5 1z" /></>;
    case "cart": return <><path d="M3 4h2.5l2 11h10.5l2-8H6.5" /><circle cx="9" cy="19" r="1.5" /><circle cx="17" cy="19" r="1.5" /></>;
    case "chef": return <><path d="M7 14.5a4 4 0 0 1-.8-7.9 5 5 0 0 1 9.6 0A4 4 0 0 1 17 14.5V20H7z" /><path d="M7 17h10" /></>;
    case "loop": return <><path d="M4 12a8 8 0 0 1 14-5.3M20 12a8 8 0 0 1-14 5.3" /><path d="M18.5 3v4h-4M5.5 21v-4h4" /></>;
    case "bag": return <><path d="M5 8h14l-1 12H6z" /><path d="M9 8V6a3 3 0 0 1 6 0v2" /></>;
  }
}
export function FlowIcon({ name, size = 24, className, x, y }: FlowIconProps) {
  return (
    <svg
      aria-hidden="true"
      className={className}
      fill="none"
      height={size}
      viewBox="0 0 24 24"
      width={size}
      x={x}
      y={y}
    >
      <g stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="2">
        <IconPaths name={name} />
      </g>
    </svg>
  );
}
