'use client';

// Thin wrapper: the manual's content/rendering lives in lib/pos/posManualContent.tsx,
// shared with /pos/manual (see that file's header comment for why there are two
// page wrappers for one manual — a pos_only cashier account can't reach /admin at
// all, so this admin-gated copy is only reachable by Manager/Sales/non-pos_only-
// Cashier logins).
import { Alert, Card } from "antd";
import { ShopOutlined } from "@ant-design/icons";
import { useBmsPermissions } from "@/app/hooks/useBmsPermissions";
import { useI18n } from "@/lib/i18nContext";
import { COPY_EN, COPY_TH, PosManualBody } from "@/lib/pos/posManualContent";

export default function PosManualPage() {
  const { lang } = useI18n();
  const { can, loading: permissionsLoading } = useBmsPermissions();
  const canView = can("pos.sell");
  const copy = lang === "th" ? COPY_TH : COPY_EN;

  if (permissionsLoading) return <Card loading />;
  if (!canView) {
    return <Alert closable type="error" showIcon message={copy.noPermTitle} description={copy.noPermDesc} />;
  }

  return <PosManualBody lang={lang === "th" ? "th" : "en"} heroIcon={<ShopOutlined />} />;
}
