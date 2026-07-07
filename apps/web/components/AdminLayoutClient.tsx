'use client';
import { usePathname } from "next/navigation";
import { gql, useQuery, useMutation } from "@apollo/client";
import { Button } from "antd";
import { LogoutOutlined, EyeOutlined } from "@ant-design/icons";
import AdminHeader from "@/components/AdminHeader";

const Q_ACTING = gql`query { bmsActingTenant { id name slug } }`;
const M_EXIT = gql`mutation { bmsExitTenant }`;

function ImpersonationBanner() {
  const { data } = useQuery(Q_ACTING, { fetchPolicy: "cache-and-network" });
  const [exit, { loading }] = useMutation(M_EXIT, {
    onCompleted: () => { window.location.href = "/admin/tenants"; },
  });
  const t = data?.bmsActingTenant;
  if (!t) return null;
  return (
    <div style={{
      display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap",
      background: "#faad14", color: "#1f1f1f",
      padding: "8px 16px", margin: "0 24px", borderRadius: 8, fontWeight: 500,
    }}>
      <EyeOutlined />
      <span>กำลังดูในมุมของร้าน: <b>{t.name}</b> <span style={{ opacity: 0.75 }}>/{t.slug}</span> — ข้อมูลทั้งหมดในหน้าจอเป็นของร้านนี้</span>
      <Button size="small" icon={<LogoutOutlined />} loading={loading}
        onClick={() => exit()} style={{ marginLeft: "auto" }}>
        ออกจากมุมร้าน
      </Button>
    </div>
  );
}

export default function AdminLayoutClient({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const hideHeader = pathname === "/admin/login";

  return (
    <>
      {!hideHeader && (
        <header style={{ padding: 24, paddingBottom: 0 }}>
          <AdminHeader />
        </header>
      )}
      {!hideHeader && <ImpersonationBanner />}
      <main style={{ padding: 24 }}>{children}</main>
    </>
  );
}
