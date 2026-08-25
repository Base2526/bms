'use client';
// หน้าจัดการสมาชิก + แต้มสะสม (migration 7.96)
// ⚠️ ทุกอย่างในหน้านี้อิงร้านที่ยืนอยู่ (getTenantId) — ต้อง drill-down เข้าร้าน
//    เป้าหมายก่อนแก้ ไม่งั้นจะไปแก้ร้าน default โดยไม่มี error เตือน
import { gql, useQuery, useMutation } from "@apollo/client";
import {
  Table, Tag, Button, Space, Alert, message, Modal, Form, Input, InputNumber,
  Select, Switch, Popconfirm, Typography, Card, Row, Col, Statistic, Divider, Empty, Drawer,
} from "antd";
import { PlusOutlined, EditOutlined, DeleteOutlined, HistoryOutlined, ReadOutlined, UserAddOutlined, ClockCircleOutlined } from "@ant-design/icons";
import Link from "next/link";
import { useState } from "react";
import { useBmsPermissions } from "@/app/hooks/useBmsPermissions";
import { useIsMobile, panelWidth } from "@/app/hooks/useMediaQuery";
import AdminPageHeader from "@/components/admin/AdminPageHeader";
import { useI18n } from "@/lib/i18nContext";

const { Text, Title } = Typography;

const Q = gql`
  query {
    bmsLoyaltySettings {
      enabled earnMode earnPointsPerBaht visitPoints earnMinSpend earnBase
      redeemPointsPerUnit redeemBahtPerUnit redeemMinPoints maxDiscountPct pointsExpireMonths
    }
    bmsMembershipTiers {
      id code name discountType discountValue qualifySpend12m qualifyPoints sortOrder active
    }
    bmsLoyaltyOutstanding {
      members outstandingPoints outstandingValue expiringIn30Days balanceMismatchCount
    }
    bmsLoyaltyActivity(months: 6) {
      month earned redeemed expired reversedNet adjustedNet
    }
    bmsSalesByTier {
      tierCode tierName members orders revenue averageBasket
    }
    bmsMembersExpiringPoints(days: 30, limit: 50) {
      customerId name phone memberNo expiringPoints firstExpiresAt
    }
  }
`;
const Q_MEMBERS = gql`
  query ($search: String, $limit: Int, $offset: Int) {
    bmsMembers(search: $search, limit: $limit, offset: $offset) {
      total
      members {
        customerId name phone memberNo memberSince pointsBalance pointsUsable
        tier { code name discountType discountValue }
      }
    }
  }
`;
const Q_LEDGER = gql`
  query ($customerId: ID!) {
    bmsLoyaltyLedger(customerId: $customerId, limit: 200) {
      id kind points orderId expiresAt note createdAt
    }
  }
`;
const M_SETTINGS = gql`
  mutation ($input: BmsLoyaltySettingsInput!) {
    bmsUpdateLoyaltySettings(input: $input) { enabled }
  }
`;
const M_TIER = gql`
  mutation ($input: BmsMembershipTierInput!) {
    bmsUpsertMembershipTier(input: $input) { id }
  }
`;
const M_TIER_DELETE = gql`mutation ($id: ID!) { bmsDeleteMembershipTier(id: $id) { deleted deactivated } }`;
const M_ENROLL = gql`
  mutation ($phone: String!, $name: String) {
    bmsEnrollMember(phone: $phone, name: $name) { status reason member { customerId memberNo name } }
  }
`;
const M_ADJUST = gql`
  mutation ($customerId: ID!, $points: Int!, $note: String!) {
    bmsAdjustLoyaltyPoints(customerId: $customerId, points: $points, note: $note) { balance }
  }
`;
const M_EXPIRE = gql`mutation { bmsExpireLoyaltyPoints { customers points } }`;
const M_REVIEW = gql`mutation { bmsReviewMemberTier { reviewed changed } }`;

const money = (n: number | null | undefined) => (n == null ? "—" : `${Number(n).toLocaleString()} ฿`);

const LEDGER_COLOR: Record<string, string> = {
  EARN: "green", REDEEM: "blue", REVERSE: "orange", EXPIRE: "default", ADJUST: "purple",
};

function tierDiscountLabel(tier: any, t: (k: string) => string) {
  if (!tier || tier.discountType === "NONE") return t("admin_loyalty.tier_no_discount");
  return tier.discountType === "PERCENT" ? `−${tier.discountValue}%` : `−${money(tier.discountValue)}`;
}

// ---- ประวัติแต้มของสมาชิก 1 คน ----
function LedgerDrawer({ member, onClose, canAdjust, onAdjusted }: {
  member: any | null; onClose: () => void; canAdjust: boolean; onAdjusted: () => void;
}) {
  const { t } = useI18n();
  const isMobile = useIsMobile();
  const [form] = Form.useForm();
  const [adjustOpen, setAdjustOpen] = useState(false);
  const { data, loading, refetch } = useQuery(Q_LEDGER, {
    variables: { customerId: member?.customerId },
    skip: !member,
    fetchPolicy: "network-only",
  });
  const [adjust, { loading: adjusting }] = useMutation(M_ADJUST, {
    onCompleted: () => {
      message.success(t("admin_loyalty.adjust_success"));
      setAdjustOpen(false);
      form.resetFields();
      refetch();
      onAdjusted();
    },
    onError: (e) => message.error(e?.message || t("admin_loyalty.adjust_failed")),
  });

  return (
    <Drawer
      open={!!member}
      onClose={onClose}
      width={panelWidth(isMobile, 640)}
      title={member ? `${member.name} · ${member.memberNo ?? "—"}` : ""}
      extra={canAdjust && <Button size="small" onClick={() => setAdjustOpen(true)}>{t("admin_loyalty.btn_adjust")}</Button>}
    >
      {member && (
        <>
          <Row gutter={[16, 8]}>
            <Col xs={12}><Statistic title={t("admin_loyalty.stat_balance")} value={member.pointsBalance} /></Col>
            <Col xs={12}><Statistic title={t("admin_loyalty.stat_usable")} value={member.pointsUsable} /></Col>
          </Row>
          {member.pointsBalance < 0 && (
            <Alert closable
              type="warning" showIcon style={{ marginTop: 12 }}
              message={t("admin_loyalty.negative_balance")}
            />
          )}
          <Divider style={{ margin: "12px 0" }} />
          <Table
            rowKey="id"
            size="small"
            loading={loading}
            dataSource={data?.bmsLoyaltyLedger || []}
            locale={{ emptyText: <Empty description={t("admin_loyalty.ledger_empty")} /> }}
            pagination={{ pageSize: 20 }}
            scroll={{ x: "max-content" }}
            columns={[
              {
                title: t("admin_loyalty.col_kind"), dataIndex: "kind", width: 100,
                render: (v: string) => <Tag color={LEDGER_COLOR[v] || "default"}>{v}</Tag>,
              },
              {
                title: t("admin_loyalty.col_points"), dataIndex: "points", width: 90, align: "right" as const,
                render: (v: number) => (
                  <Text strong type={v > 0 ? "success" : "danger"}>{v > 0 ? `+${v}` : v}</Text>
                ),
              },
              { title: t("admin_loyalty.col_note"), dataIndex: "note", render: (v: string | null) => v || "—" },
              {
                title: t("admin_loyalty.col_expires"), dataIndex: "expiresAt", width: 120,
                render: (v: string | null) => (v ? new Date(v).toLocaleDateString() : "—"),
              },
              {
                title: t("admin_loyalty.col_when"), dataIndex: "createdAt", width: 150,
                render: (v: string) => new Date(v).toLocaleString(),
              },
            ]}
          />
        </>
      )}

      <Modal
        title={t("admin_loyalty.adjust_title")}
        open={adjustOpen}
        onCancel={() => setAdjustOpen(false)}
        onOk={() => form.submit()}
        confirmLoading={adjusting}
        destroyOnClose
      >
        <Alert closable type="info" showIcon style={{ marginBottom: 12 }} message={t("admin_loyalty.adjust_hint")} />
        <Form
          form={form}
          layout="vertical"
          onFinish={(v) => adjust({ variables: { customerId: member.customerId, points: v.points, note: v.note } })}
        >
          <Form.Item name="points" label={t("admin_loyalty.form_adjust_points")} rules={[{ required: true }]}>
            <InputNumber style={{ width: "100%" }} placeholder="+100 / -50" />
          </Form.Item>
          <Form.Item
            name="note"
            label={t("admin_loyalty.form_adjust_note")}
            rules={[{ required: true, message: t("admin_loyalty.form_adjust_note_required") }]}
          >
            <Input.TextArea rows={2} />
          </Form.Item>
        </Form>
      </Modal>
    </Drawer>
  );
}

export default function LoyaltyPage() {
  const { t } = useI18n();
  const { can, loading: permsLoading } = useBmsPermissions();
  const isMobile = useIsMobile();
  const canSettings = can("loyalty.settings");
  const canManage = can("member.manage");
  const canAdjust = can("loyalty.adjust");

  const { data, loading, error, refetch } = useQuery(Q, {
    skip: permsLoading || !can("member.view"),
    fetchPolicy: "cache-and-network",
  });
  // รายชื่อสมาชิกต้องขึ้นทันทีที่เปิดหน้า — การ์ด "สมาชิกทั้งหมด" บอกจำนวนได้
  // แต่ถ้าตารางบังคับให้ค้นก่อน คนดูจะไม่มีทางรู้ว่า 2 คนนั้นเป็นใคร
  const MEMBER_PAGE_SIZE = 25;
  const [memberSearch, setMemberSearch] = useState("");
  const [memberPage, setMemberPage] = useState(1);
  const { data: memberData, loading: searching, refetch: refetchMembers } = useQuery(Q_MEMBERS, {
    variables: { search: memberSearch, limit: MEMBER_PAGE_SIZE, offset: (memberPage - 1) * MEMBER_PAGE_SIZE },
    skip: permsLoading || !can("member.view"),
    fetchPolicy: "cache-and-network",
  });

  const [settingsForm] = Form.useForm();
  const [tierForm] = Form.useForm();
  const [enrollForm] = Form.useForm();
  const [tierModal, setTierModal] = useState<{ open: boolean; editing: any | null }>({ open: false, editing: null });
  const [enrollOpen, setEnrollOpen] = useState(false);
  const [viewing, setViewing] = useState<any | null>(null);

  const [saveSettings, { loading: savingSettings }] = useMutation(M_SETTINGS, {
    onCompleted: () => { message.success(t("admin_loyalty.settings_saved")); refetch(); },
    onError: (e) => message.error(e?.message || t("admin_loyalty.settings_save_failed")),
  });
  const [saveTier, { loading: savingTier }] = useMutation(M_TIER, {
    onCompleted: () => { message.success(t("admin_loyalty.tier_saved")); setTierModal({ open: false, editing: null }); refetch(); },
    onError: (e) => message.error(e?.message || t("admin_loyalty.tier_save_failed")),
  });
  const [deleteTier] = useMutation(M_TIER_DELETE, {
    onCompleted: (d) => {
      message.success(d?.bmsDeleteMembershipTier?.deactivated
        ? t("admin_loyalty.tier_deactivated")
        : t("admin_loyalty.tier_deleted"));
      refetch();
    },
    onError: (e) => message.error(e?.message || t("admin_loyalty.tier_delete_failed")),
  });
  const [enroll, { loading: enrolling }] = useMutation(M_ENROLL, {
    onCompleted: (d) => {
      const res = d?.bmsEnrollMember;
      if (res?.status === "INVALID") return message.error(res.reason || t("admin_loyalty.enroll_failed"));
      message.success(res?.status === "ALREADY_MEMBER"
        ? t("admin_loyalty.enroll_already")
        : t("admin_loyalty.enroll_success"));
      setEnrollOpen(false);
      enrollForm.resetFields();
      void refetchMembers();
      refetch();
    },
    onError: (e) => message.error(e?.message || t("admin_loyalty.enroll_failed")),
  });
  const [expirePoints, { loading: expiring }] = useMutation(M_EXPIRE, {
    onCompleted: (d) => {
      const r = d?.bmsExpireLoyaltyPoints;
      message.success(t("admin_loyalty.expire_done", { customers: r?.customers ?? 0, points: r?.points ?? 0 }));
      refetch();
    },
    onError: (e) => message.error(e?.message || t("admin_loyalty.expire_failed")),
  });
  const [reviewTiers, { loading: reviewing }] = useMutation(M_REVIEW, {
    onCompleted: (d) => {
      const r = d?.bmsReviewMemberTier;
      message.success(t("admin_loyalty.review_done", { reviewed: r?.reviewed ?? 0, changed: r?.changed ?? 0 }));
      refetch();
    },
    onError: (e) => message.error(e?.message || t("admin_loyalty.review_failed")),
  });

  // useWatch ต้องอยู่เหนือ early return ทุกตัว ไม่งั้นเป็น conditional hook
  const watchedEarnMode = Form.useWatch("earnMode", settingsForm);

  if (!permsLoading && !can("member.view")) {
    return <Alert closable type="warning" showIcon message={t("admin_loyalty.no_permission")} />;
  }
  if (error) return <Alert closable type="error" showIcon message={t("admin_loyalty.load_error")} description={error.message} />;

  const settings = data?.bmsLoyaltySettings;
  const tiers = data?.bmsMembershipTiers || [];
  const outstanding = data?.bmsLoyaltyOutstanding;
  const earnMode = watchedEarnMode ?? settings?.earnMode;

  return (
    <div>
      <AdminPageHeader title={<Title level={4} style={{ margin: 0 }}>{t("admin_loyalty.title")}</Title>}>
        <Space wrap>
          <Link href="/admin/pos-manual"><Button icon={<ReadOutlined />}>คู่มือแคชเชียร์</Button></Link>
          {canManage && (
            <Button icon={<UserAddOutlined />} onClick={() => setEnrollOpen(true)}>
              {t("admin_loyalty.btn_enroll")}
            </Button>
          )}
          {canManage && (
            <Button loading={reviewing} onClick={() => reviewTiers()}>{t("admin_loyalty.btn_review_tiers")}</Button>
          )}
          {canSettings && (
            <Popconfirm title={t("admin_loyalty.expire_confirm")} onConfirm={() => expirePoints()}>
              <Button icon={<ClockCircleOutlined />} loading={expiring}>{t("admin_loyalty.btn_expire")}</Button>
            </Popconfirm>
          )}
        </Space>
      </AdminPageHeader>

      {!settings?.enabled && (
        <Alert closable type="info" showIcon style={{ marginBottom: 16 }} message={t("admin_loyalty.program_off")} />
      )}
      {outstanding && outstanding.balanceMismatchCount > 0 && (
        <Alert closable
          type="error" showIcon style={{ marginBottom: 16 }}
          message={t("admin_loyalty.mismatch_alert", { n: outstanding.balanceMismatchCount })}
        />
      )}

      {/* แต้มค้าง = ภาระผูกพันของร้าน ต้องดูได้ตลอด ไม่ใช่ตัวเลขเสริม */}
      <Card size="small" style={{ marginBottom: 16 }} loading={loading}>
        <Row gutter={[16, 12]}>
          <Col xs={12} md={6}><Statistic title={t("admin_loyalty.stat_members")} value={outstanding?.members ?? 0} /></Col>
          <Col xs={12} md={6}><Statistic title={t("admin_loyalty.stat_outstanding")} value={outstanding?.outstandingPoints ?? 0} /></Col>
          <Col xs={12} md={6}>
            <Statistic
              title={t("admin_loyalty.stat_liability")}
              value={outstanding?.outstandingValue ?? 0}
              precision={2} suffix="฿" valueStyle={{ color: "#c9455a" }}
            />
          </Col>
          <Col xs={12} md={6}><Statistic title={t("admin_loyalty.stat_expiring")} value={outstanding?.expiringIn30Days ?? 0} /></Col>
        </Row>
      </Card>

      <Row gutter={[16, 16]}>
        <Col xs={24} lg={12}>
          <Card size="small" title={t("admin_loyalty.card_settings")} loading={loading}>
            {settings && (
              <Form
                form={settingsForm}
                layout="vertical"
                initialValues={settings}
                disabled={!canSettings}
                onFinish={(v) => saveSettings({ variables: { input: {
                  enabled: v.enabled, earnMode: v.earnMode, earnPointsPerBaht: v.earnPointsPerBaht,
                  visitPoints: v.visitPoints, earnMinSpend: v.earnMinSpend, earnBase: v.earnBase,
                  redeemPointsPerUnit: v.redeemPointsPerUnit, redeemBahtPerUnit: v.redeemBahtPerUnit,
                  redeemMinPoints: v.redeemMinPoints, maxDiscountPct: v.maxDiscountPct,
                  pointsExpireMonths: v.pointsExpireMonths,
                } } })}
              >
                <Form.Item name="enabled" label={t("admin_loyalty.form_enabled")} valuePropName="checked">
                  <Switch />
                </Form.Item>
                <Row gutter={12}>
                  <Col xs={24} sm={12}>
                    <Form.Item name="earnMode" label={t("admin_loyalty.form_earn_mode")}>
                      <Select options={[
                        { value: "SPEND", label: t("admin_loyalty.earn_mode_spend") },
                        { value: "VISIT", label: t("admin_loyalty.earn_mode_visit") },
                      ]} />
                    </Form.Item>
                  </Col>
                  <Col xs={24} sm={12}>
                    {earnMode === "VISIT" ? (
                      <Form.Item name="visitPoints" label={t("admin_loyalty.form_visit_points")}>
                        <InputNumber min={0} style={{ width: "100%" }} />
                      </Form.Item>
                    ) : (
                      <Form.Item name="earnPointsPerBaht" label={t("admin_loyalty.form_points_per_baht")}>
                        <InputNumber min={0} step={0.1} style={{ width: "100%" }} />
                      </Form.Item>
                    )}
                  </Col>
                </Row>
                <Row gutter={12}>
                  <Col xs={24} sm={12}>
                    <Form.Item name="earnMinSpend" label={t("admin_loyalty.form_earn_min_spend")}>
                      <InputNumber min={0} style={{ width: "100%" }} />
                    </Form.Item>
                  </Col>
                  <Col xs={24} sm={12}>
                    <Form.Item
                      name="earnBase"
                      label={t("admin_loyalty.form_earn_base")}
                      extra={t("admin_loyalty.form_earn_base_hint")}
                    >
                      <Select options={[
                        { value: "AFTER_DISCOUNT", label: t("admin_loyalty.earn_base_after") },
                        { value: "BEFORE_DISCOUNT", label: t("admin_loyalty.earn_base_before") },
                      ]} />
                    </Form.Item>
                  </Col>
                </Row>
                <Divider style={{ margin: "4px 0 12px" }} />
                <Row gutter={12}>
                  <Col xs={24} sm={12}>
                    <Form.Item name="redeemPointsPerUnit" label={t("admin_loyalty.form_redeem_points")}>
                      <InputNumber min={1} style={{ width: "100%" }} />
                    </Form.Item>
                  </Col>
                  <Col xs={24} sm={12}>
                    <Form.Item name="redeemBahtPerUnit" label={t("admin_loyalty.form_redeem_baht")}>
                      <InputNumber min={0.01} style={{ width: "100%" }} />
                    </Form.Item>
                  </Col>
                </Row>
                <Row gutter={12}>
                  <Col xs={24} sm={8}>
                    <Form.Item name="redeemMinPoints" label={t("admin_loyalty.form_redeem_min")}>
                      <InputNumber min={0} style={{ width: "100%" }} />
                    </Form.Item>
                  </Col>
                  <Col xs={24} sm={8}>
                    <Form.Item name="maxDiscountPct" label={t("admin_loyalty.form_max_discount")}>
                      <InputNumber min={1} max={100} style={{ width: "100%" }} />
                    </Form.Item>
                  </Col>
                  <Col xs={24} sm={8}>
                    <Form.Item
                      name="pointsExpireMonths"
                      label={t("admin_loyalty.form_expire_months")}
                      extra={t("admin_loyalty.form_expire_months_hint")}
                    >
                      <InputNumber min={0} style={{ width: "100%" }} />
                    </Form.Item>
                  </Col>
                </Row>
                {canSettings && (
                  <Button type="primary" loading={savingSettings} onClick={() => settingsForm.submit()}>
                    {t("admin_loyalty.btn_save_settings")}
                  </Button>
                )}
              </Form>
            )}
          </Card>
        </Col>

        <Col xs={24} lg={12}>
          <Card
            size="small"
            title={t("admin_loyalty.card_tiers")}
            loading={loading}
            extra={canSettings && (
              <Button size="small" icon={<PlusOutlined />} onClick={() => {
                tierForm.resetFields();
                tierForm.setFieldsValue({ discountType: "PERCENT", active: true, sortOrder: tiers.length, qualifyPoints: 0, qualifySpend12m: 0, discountValue: 0 });
                setTierModal({ open: true, editing: null });
              }}>
                {t("admin_loyalty.btn_add_tier")}
              </Button>
            )}
          >
            <Table
              rowKey="id"
              size="small"
              dataSource={tiers}
              pagination={false}
              scroll={{ x: "max-content" }}
              columns={[
                {
                  title: t("admin_loyalty.col_tier"), key: "tier",
                  render: (_: any, r: any) => (
                    <Space direction="vertical" size={0}>
                      <Text strong>{r.name}</Text>
                      <Text type="secondary" style={{ fontSize: 11 }}>{r.code}</Text>
                    </Space>
                  ),
                },
                {
                  title: t("admin_loyalty.col_tier_discount"), key: "discount", align: "right" as const,
                  render: (_: any, r: any) => tierDiscountLabel(r, t),
                },
                {
                  title: t("admin_loyalty.col_qualify"), key: "qualify",
                  render: (_: any, r: any) => (
                    <Space direction="vertical" size={0} style={{ fontSize: 12 }}>
                      <span>{money(r.qualifySpend12m)} / 12 {t("admin_loyalty.months")}</span>
                      {r.qualifyPoints > 0 && <span>{t("admin_loyalty.or_points", { n: r.qualifyPoints })}</span>}
                    </Space>
                  ),
                },
                {
                  title: "", dataIndex: "active", width: 60,
                  render: (v: boolean) => <Tag color={v ? "green" : "default"}>{v ? "on" : "off"}</Tag>,
                },
                ...(canSettings ? [{
                  title: "", key: "actions", width: 80,
                  render: (_: any, r: any) => (
                    <Space size={4}>
                      <Button size="small" icon={<EditOutlined />} onClick={() => {
                        tierForm.setFieldsValue(r);
                        setTierModal({ open: true, editing: r });
                      }} />
                      <Popconfirm title={t("admin_loyalty.tier_delete_confirm")} onConfirm={() => deleteTier({ variables: { id: r.id } })}>
                        <Button size="small" danger icon={<DeleteOutlined />} />
                      </Popconfirm>
                    </Space>
                  ),
                }] : []),
              ]}
            />
          </Card>
        </Col>
      </Row>

      {/* รายงาน — แต้มคือหนี้สิน ตัวเลขพวกนี้ต้องดูได้ในหน้าเดียวกับที่ตั้งค่า
          ไม่ใช่ต้องรอ export ไฟล์ (report engine ยังไม่รองรับชนิด LOYALTY) */}
      <Row gutter={[16, 16]} style={{ marginTop: 16 }}>
        <Col xs={24} lg={13}>
          <Card size="small" title={t("admin_loyalty.card_activity")} loading={loading}>
            <Table
              rowKey="month"
              size="small"
              dataSource={data?.bmsLoyaltyActivity || []}
              locale={{ emptyText: <Empty description={t("admin_loyalty.activity_empty")} /> }}
              pagination={false}
              scroll={{ x: "max-content" }}
              columns={[
                {
                  title: t("admin_loyalty.col_month"), dataIndex: "month",
                  render: (v: string) => new Date(v).toLocaleDateString(undefined, { year: "numeric", month: "short" }),
                },
                {
                  title: t("admin_loyalty.col_earned"), dataIndex: "earned", align: "right" as const,
                  render: (v: number) => <Text type="success">+{v.toLocaleString()}</Text>,
                },
                {
                  title: t("admin_loyalty.col_redeemed"), dataIndex: "redeemed", align: "right" as const,
                  render: (v: number) => v.toLocaleString(),
                },
                {
                  title: t("admin_loyalty.col_expired"), dataIndex: "expired", align: "right" as const,
                  render: (v: number) => <Text type={v > 0 ? "warning" : undefined}>{v.toLocaleString()}</Text>,
                },
                {
                  // redemption rate ต่ำ = แต้มกลายเป็นหนี้สินสะสม ไม่ใช่แรงจูงใจ
                  title: t("admin_loyalty.col_redemption_rate"), key: "rate", align: "right" as const,
                  render: (_: any, r: any) => (r.earned > 0 ? `${Math.round((r.redeemed / r.earned) * 100)}%` : "—"),
                },
              ]}
            />
          </Card>
        </Col>
        <Col xs={24} lg={11}>
          <Card size="small" title={t("admin_loyalty.card_by_tier")} loading={loading}>
            <Table
              rowKey="tierCode"
              size="small"
              dataSource={data?.bmsSalesByTier || []}
              locale={{ emptyText: <Empty description={t("admin_loyalty.by_tier_empty")} /> }}
              pagination={false}
              scroll={{ x: "max-content" }}
              columns={[
                {
                  title: t("admin_loyalty.col_tier"), dataIndex: "tierName",
                  render: (v: string, r: any) => (
                    r.tierCode === "NON_MEMBER" ? <Text type="secondary">{v}</Text> : <Text strong>{v}</Text>
                  ),
                },
                { title: t("admin_loyalty.col_orders"), dataIndex: "orders", align: "right" as const,
                  render: (v: number) => v.toLocaleString() },
                { title: t("admin_loyalty.col_revenue"), dataIndex: "revenue", align: "right" as const,
                  render: (v: number) => money(v) },
                { title: t("admin_loyalty.col_avg_basket"), dataIndex: "averageBasket", align: "right" as const,
                  render: (v: number) => money(v) },
              ]}
            />
          </Card>
        </Col>
      </Row>

      {/* ใครแต้มใกล้หมด — ยังไม่มีระบบส่งข้อความอัตโนมัติ รายชื่อนี้จึงเป็นทางเดียว
          ที่ร้านจะติดต่อทันก่อนแต้มหาย (แต้มหายเงียบ ๆ = ลูกค้าโทรมาต่อว่าทีหลัง) */}
      {(data?.bmsMembersExpiringPoints?.length ?? 0) > 0 && (
        <Card size="small" title={t("admin_loyalty.card_expiring")} style={{ marginTop: 16 }} loading={loading}>
          <Alert closable type="warning" showIcon style={{ marginBottom: 12 }} message={t("admin_loyalty.expiring_hint")} />
          <Table
            rowKey="customerId"
            size="small"
            dataSource={data?.bmsMembersExpiringPoints || []}
            pagination={{ pageSize: 10, showSizeChanger: false }}
            scroll={{ x: "max-content" }}
            columns={[
              {
                title: t("admin_loyalty.col_member"), key: "member",
                render: (_: any, r: any) => (
                  <Space direction="vertical" size={0}>
                    <Text strong>{r.name}</Text>
                    <Text type="secondary" style={{ fontSize: 11 }}>{r.memberNo} · {r.phone || "—"}</Text>
                  </Space>
                ),
              },
              {
                title: t("admin_loyalty.col_expiring_points"), dataIndex: "expiringPoints", align: "right" as const,
                render: (v: number) => <Text type="warning" strong>{v.toLocaleString()}</Text>,
              },
              {
                title: t("admin_loyalty.col_expires"), dataIndex: "firstExpiresAt",
                render: (v: string) => new Date(v).toLocaleDateString(),
              },
            ]}
          />
        </Card>
      )}

      <Card
        size="small"
        title={t("admin_loyalty.card_members")}
        style={{ marginTop: 16 }}
        extra={<Text type="secondary" style={{ fontSize: 12 }}>
          {t("admin_loyalty.member_count", { n: memberData?.bmsMembers?.total ?? 0 })}
        </Text>}
      >
        <Input.Search
          placeholder={t("admin_loyalty.member_search_placeholder")}
          allowClear
          enterButton
          loading={searching}
          onSearch={(v) => { setMemberSearch(v.trim()); setMemberPage(1); }}
          onChange={(e) => { if (!e.target.value) { setMemberSearch(""); setMemberPage(1); } }}
          style={{ maxWidth: 420, marginBottom: 12 }}
        />
        <Table
          rowKey="customerId"
          size="small"
          loading={searching}
          dataSource={memberData?.bmsMembers?.members || []}
          locale={{ emptyText: <Empty description={memberSearch
            ? t("admin_loyalty.member_search_empty")
            : t("admin_loyalty.member_list_empty")} /> }}
          pagination={{
            current: memberPage,
            pageSize: MEMBER_PAGE_SIZE,
            total: memberData?.bmsMembers?.total ?? 0,
            showSizeChanger: false,
            onChange: setMemberPage,
          }}
          scroll={{ x: "max-content" }}
          columns={[
            {
              title: t("admin_loyalty.col_member"), key: "member",
              render: (_: any, r: any) => (
                <Space direction="vertical" size={0}>
                  <Text strong>{r.name}</Text>
                  <Text type="secondary" style={{ fontSize: 11 }}>{r.memberNo} · {r.phone || "—"}</Text>
                </Space>
              ),
            },
            {
              title: t("admin_loyalty.col_tier"), key: "tier",
              render: (_: any, r: any) => (r.tier ? <Tag>{r.tier.name} {tierDiscountLabel(r.tier, t)}</Tag> : "—"),
            },
            {
              title: t("admin_loyalty.col_since"), dataIndex: "memberSince",
              render: (v: string | null) => (v ? new Date(v).toLocaleDateString() : "—"),
            },
            {
              title: t("admin_loyalty.col_balance"), dataIndex: "pointsBalance", align: "right" as const,
              render: (v: number) => <Text type={v < 0 ? "danger" : undefined} strong>{v}</Text>,
            },
            { title: t("admin_loyalty.col_usable"), dataIndex: "pointsUsable", align: "right" as const },
            {
              title: "", key: "actions", width: 100,
              render: (_: any, r: any) => (
                <Button size="small" type="link" icon={<HistoryOutlined />} onClick={() => setViewing(r)}>
                  {t("admin_loyalty.btn_history")}
                </Button>
              ),
            },
          ]}
        />
      </Card>

      <Modal
        title={tierModal.editing ? t("admin_loyalty.tier_modal_edit") : t("admin_loyalty.tier_modal_create")}
        open={tierModal.open}
        onCancel={() => setTierModal({ open: false, editing: null })}
        onOk={() => tierForm.submit()}
        confirmLoading={savingTier}
        width={panelWidth(isMobile, 520)}
        destroyOnClose
      >
        <Form
          form={tierForm}
          layout="vertical"
          onFinish={(v) => saveTier({ variables: { input: {
            id: tierModal.editing?.id ?? null,
            code: v.code, name: v.name, discountType: v.discountType,
            discountValue: v.discountValue ?? 0, qualifySpend12m: v.qualifySpend12m ?? 0,
            qualifyPoints: v.qualifyPoints ?? 0, sortOrder: v.sortOrder ?? 0, active: v.active ?? true,
          } } })}
        >
          <Row gutter={12}>
            <Col xs={24} sm={10}>
              <Form.Item name="code" label={t("admin_loyalty.form_tier_code")} rules={[{ required: true }]}>
                <Input style={{ textTransform: "uppercase" }} placeholder="GOLD" />
              </Form.Item>
            </Col>
            <Col xs={24} sm={14}>
              <Form.Item name="name" label={t("admin_loyalty.form_tier_name")} rules={[{ required: true }]}>
                <Input placeholder="Gold" />
              </Form.Item>
            </Col>
          </Row>
          <Row gutter={12}>
            <Col xs={24} sm={12}>
              <Form.Item name="discountType" label={t("admin_loyalty.form_tier_discount_type")}>
                <Select options={[
                  { value: "NONE", label: t("admin_loyalty.tier_no_discount") },
                  { value: "PERCENT", label: t("admin_loyalty.discount_percent") },
                  { value: "FIXED", label: t("admin_loyalty.discount_fixed") },
                ]} />
              </Form.Item>
            </Col>
            <Col xs={24} sm={12}>
              <Form.Item name="discountValue" label={t("admin_loyalty.form_tier_discount_value")}>
                <InputNumber min={0} style={{ width: "100%" }} />
              </Form.Item>
            </Col>
          </Row>
          <Row gutter={12}>
            <Col xs={24} sm={12}>
              <Form.Item
                name="qualifySpend12m"
                label={t("admin_loyalty.form_qualify_spend")}
                extra={t("admin_loyalty.form_qualify_hint")}
              >
                <InputNumber min={0} style={{ width: "100%" }} />
              </Form.Item>
            </Col>
            <Col xs={24} sm={12}>
              <Form.Item name="qualifyPoints" label={t("admin_loyalty.form_qualify_points")}>
                <InputNumber min={0} style={{ width: "100%" }} />
              </Form.Item>
            </Col>
          </Row>
          <Row gutter={12}>
            <Col xs={12}>
              <Form.Item name="sortOrder" label={t("admin_loyalty.form_sort_order")} extra={t("admin_loyalty.form_sort_hint")}>
                <InputNumber min={0} style={{ width: "100%" }} />
              </Form.Item>
            </Col>
            <Col xs={12}>
              <Form.Item name="active" label={t("admin_loyalty.form_tier_active")} valuePropName="checked">
                <Switch />
              </Form.Item>
            </Col>
          </Row>
        </Form>
      </Modal>

      <Modal
        title={t("admin_loyalty.enroll_title")}
        open={enrollOpen}
        onCancel={() => setEnrollOpen(false)}
        onOk={() => enrollForm.submit()}
        confirmLoading={enrolling}
        destroyOnClose
      >
        <Alert closable type="info" showIcon style={{ marginBottom: 12 }} message={t("admin_loyalty.enroll_hint")} />
        <Form form={enrollForm} layout="vertical" onFinish={(v) => enroll({ variables: { phone: v.phone, name: v.name ?? null } })}>
          <Form.Item name="phone" label={t("admin_loyalty.form_phone")} rules={[{ required: true }]}>
            <Input placeholder="0812345678" />
          </Form.Item>
          <Form.Item name="name" label={t("admin_loyalty.form_name")}>
            <Input />
          </Form.Item>
        </Form>
      </Modal>

      <LedgerDrawer
        member={viewing}
        onClose={() => setViewing(null)}
        canAdjust={canAdjust}
        onAdjusted={() => refetch()}
      />
    </div>
  );
}
