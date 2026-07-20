'use client';
import { usePathname } from "next/navigation";
import { gql, useQuery, useMutation } from "@apollo/client";
import { Button, Layout } from "antd";
import { LogoutOutlined, EyeOutlined } from "@ant-design/icons";
import AdminSidebar from "@/components/AdminSidebar";

const { Content } = Layout;

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
      padding: "8px 16px", margin: "0 0 16px", borderRadius: 8, fontWeight: 500,
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

  if (hideHeader) return <main style={{ padding: 24 }}>{children}</main>;

  return (
    <Layout style={{ minHeight: '100vh' }}>
      <AdminSidebar />
      <Layout style={{ minWidth: 0 }}>
        <Content style={{ padding: "clamp(12px, 4vw, 24px)", minWidth: 0, overflowX: "auto" }}>
          <ImpersonationBanner />
          {children}
        </Content>
      </Layout>
    </Layout>
  );
}
