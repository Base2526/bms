import "server-only";
import SqlConsoleClient from "./SqlConsoleClient";

// gate: อยู่ใน layout.tsx (requirePlatformAdminPage)
export default function SqlConsolePage() {
  return <SqlConsoleClient />;
}
