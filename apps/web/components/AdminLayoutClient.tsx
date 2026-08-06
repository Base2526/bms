'use client';
import { usePathname } from "next/navigation";
import { gql, useQuery, useMutation } from "@apollo/client";
import { Button, Layout } from "antd";
import { LogoutOutlined, EyeOutlined } from "@ant-design/icons";
import AdminSidebar from "@/components/AdminSidebar";
import { useI18n } from "@/lib/i18nContext";

const { Content } = Layout;

const Q_ACTING = gql`query { bmsActingTenant { id name slug } }`;
const M_EXIT = gql`mutation { bmsExitTenant }`;

function ImpersonationBanner() {
  const { t: tr } = useI18n();
  const { data } = useQuery(Q_ACTING, { fetchPolicy: "cache-first" });
  const [exit, { loading }] = useMutation(M_EXIT, {
    onCompleted: () => { window.location.href = "/admin/tenants"; },
  });
  const actingTenant = data?.bmsActingTenant;
  if (!actingTenant) return null;
  return (
    <div style={{
      display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap",
      background: "#faad14", color: "#1f1f1f",
      padding: "8px 16px", margin: "0 0 16px", borderRadius: 8, fontWeight: 500,
    }}>
      <EyeOutlined />
      <span>
        {tr("admin.impersonation_banner_prefix")} <b>{actingTenant.name}</b>{" "}
        <span style={{ opacity: 0.75 }}>/{actingTenant.slug}</span> — {tr("admin.impersonation_banner_suffix")}
      </span>
      <Button size="small" icon={<LogoutOutlined />} loading={loading}
        onClick={() => exit()} style={{ marginLeft: "auto" }}>
        {tr("admin.exit_impersonation")}
      </Button>
    </div>
  );
}

export default function AdminLayoutClient({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const hideHeader = pathname === "/admin/login";

  if (hideHeader) return <main>{children}</main>;

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
