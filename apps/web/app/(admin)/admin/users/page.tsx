'use client';
import { gql, useQuery, useMutation } from "@apollo/client";
import { Table, Input, Space, Button, Tag, Popconfirm, Modal, message, Avatar, Typography, Tooltip } from "antd";
import { PlusOutlined, DeleteOutlined, ReloadOutlined, EditOutlined } from "@ant-design/icons";
import { useEffect, useMemo, useState } from "react";
import debounce from "lodash/debounce";
import { useIsMobile } from "@/app/hooks/useMediaQuery";
import AdminPageHeader from "@/components/admin/AdminPageHeader";
import { AdminMobileList, AdminRecordCard } from "@/components/admin/AdminMobileList";
import { canManageStaffRole } from "@/lib/bms/staffRoles";
import { useBmsPermissions } from "@/app/hooks/useBmsPermissions";
import { useI18n } from "@/lib/i18nContext";

const Q_USERS = gql`
  query($search:String, $limit:Int, $offset:Int){
    users(search:$search, limit:$limit, offset:$offset){
      total
      items{ id name email phone role created_at avatar tenantName lastLoginAt is_platform_admin }
    }
  }
`;

const Q_ME = gql`query { bmsMe { id role is_platform_admin } }`;

const M_DELETE = gql`mutation($id:ID!){ deleteUser(id:$id) }`;
const M_DELETE_MANY = gql`mutation($ids:[ID!]!){ deleteUsers(ids:$ids) }`;

type UserRow = {
  id: string;
  name: string;
  email: string;
  phone: string | null;
  role: string;
  created_at: string;
  avatar: string | null;
  tenantName: string | null;
  lastLoginAt: string | null;
  is_platform_admin: boolean;
};

// สีตาม role จริงของ BMS (Administrator/Manager/Sales/Warehouse) — ไม่ใช่แค่ Administrator/Author เดิม
const ROLE_COLOR: Record<string, string> = {
  Administrator: "red",
  Manager: "geekblue",
  Sales: "green",
  Warehouse: "gold",
};
const roleTag = (v: string) => <Tag color={ROLE_COLOR[v] ?? "default"}>{v}</Tag>;

// created_at เดิมมาเป็น epoch string (ดู bug note ใน CLAUDE.local.md) — parse ให้ทนทั้ง 2 แบบ
function formatDate(d: string | null) {
  if (!d) return <span style={{ color: "var(--app-muted)" }}>—</span>;
  const asNumber = Number(d);
  const date = Number.isFinite(asNumber) && String(asNumber) === d ? new Date(asNumber) : new Date(d);
  if (Number.isNaN(date.getTime())) return <span style={{ color: "var(--app-muted)" }}>—</span>;
  return date.toLocaleString("th-TH", { dateStyle: "medium", timeStyle: "short" });
}

function UserAvatar({ name, avatar }: { name: string; avatar: string | null }) {
  if (avatar) return <Avatar src={avatar} size={40} />;
  return (
    <Avatar
      size={40}
      style={{
        background: "linear-gradient(135deg, var(--app-primary), #22c55e)",
        fontWeight: 600,
        flexShrink: 0,
      }}
    >
      {name?.[0]?.toUpperCase() || "?"}
    </Avatar>
  );
}

// ปุ่มลบ — ปิดใช้งานเมื่อลบแถวนั้นไม่ได้ (แถวตัวเอง หรือ role สูงกว่า/เท่ากับเรา)
// backend ปฏิเสธซ้ำใน deleteUser/deleteUsers อยู่แล้ว ปิดที่ UI แค่กันงงว่ากดแล้วทำไมฟ้อง error
function DeleteUserAction({ reason, onConfirm }: { reason: string | null; onConfirm: () => void }) {
  const { t } = useI18n();
  if (reason) {
    return (
      <Tooltip title={reason}>
        <Button type="link" size="small" danger disabled icon={<DeleteOutlined />}>{t("admin_users.btn_delete")}</Button>
      </Tooltip>
    );
  }
  return (
    <Popconfirm title={t("admin_users.delete_confirm_title")} okText={t("admin_users.btn_delete")} cancelText={t("admin_users.cancel_text")} onConfirm={onConfirm}>
      <Button type="link" size="small" danger icon={<DeleteOutlined />}>{t("admin_users.btn_delete")}</Button>
    </Popconfirm>
  );
}

// ปุ่มแก้ไข — role ที่สูงกว่า/เท่ากับเราแก้ไม่ได้ (server เช็คซ้ำที่ requireManageableTarget)
function EditUserAction({ href, reason }: { href: string; reason: string | null }) {
  const { t } = useI18n();
  if (reason) {
    return (
      <Tooltip title={reason}>
        <Button type="link" size="small" disabled icon={<EditOutlined />}>{t("admin_users.btn_edit")}</Button>
      </Tooltip>
    );
  }
  return <Button type="link" size="small" icon={<EditOutlined />} href={href}>{t("admin_users.btn_edit")}</Button>;
}

function UserNameLink({ href, label, disabledReason }: { href: string; label: string; disabledReason: string | null }) {
  if (disabledReason) {
    return (
      <Tooltip title={disabledReason}>
        <Typography.Text>{label}</Typography.Text>
      </Tooltip>
    );
  }
  return <a href={href}>{label}</a>;
}

function UsersList() {
  const { t } = useI18n();
  const isMobile = useIsMobile();
  const [searchInput, setSearchInput] = useState("");
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);

  const limit = pageSize;
  const offset = (page - 1) * pageSize;

  const { data, refetch, loading } = useQuery(Q_USERS, {
    variables: { search: "", limit, offset },
    fetchPolicy: "cache-and-network",
  });
  // ใช้เช็คว่าแถวไหนคือบัญชีตัวเอง — ห้ามลบตัวเองทั้ง UI (ปุ่ม/checkbox) และ backend (deleteUser/deleteUsers)
  const { data: meData } = useQuery(Q_ME);
  const myId: string | undefined = meData?.bmsMe?.id;
  const myRole: string | undefined = meData?.bmsMe?.role;

  // สิทธิ์เขียน: platform admin / Administrator ผ่านเสมอ (server ก็ short-circuit ให้)
  // ส่วน role อื่นต้องมี `user.manage` — role ที่มีแค่ `user.view` จะเห็นรายชื่อแบบอ่านอย่างเดียว
  const { can } = useBmsPermissions();
  const canWrite =
    meData?.bmsMe?.is_platform_admin === true || myRole === "Administrator" || can("user.manage");

  // เหตุผลที่แก้/ลบแถวนี้ไม่ได้ (null = ทำได้) — Manager แตะได้แค่ role ที่ต่ำกว่าตัวเอง
  // ⚠️ นี่เป็นแค่การซ่อนปุ่ม ไม่ใช่ authorization — ตัวบังคับจริงอยู่ที่ requireManageableTarget()
  const blockedReason = (r: UserRow): string | null => {
    if (!meData) return null; // ยังโหลดสิทธิ์ไม่เสร็จ — อย่าเพิ่งปิดปุ่มให้กะพริบ
    if (!canWrite) return t("admin_users.reason_read_only");
    if (r.id === myId) return null; // แถวตัวเอง: แก้โปรไฟล์ตัวเองได้ (ลบไม่ได้ — เช็คแยกด้านล่าง)
    if (r.is_platform_admin) return t("admin_users.reason_platform_admin");
    if (!myRole) return null;
    if (!canManageStaffRole(myRole, r.role)) {
      return t("admin_users.reason_role_rank", { myRole, targetRole: r.role });
    }
    return null;
  };
  const deleteReason = (r: UserRow): string | null => {
    if (r.id === myId) return t("admin_users.delete_self_tooltip");
    return blockedReason(r);
  };

  const [deleteOne] = useMutation(M_DELETE);
  const [deleteMany] = useMutation(M_DELETE_MANY);

  const [selectedRowKeys, setSelectedRowKeys] = useState<React.Key[]>([]);
  const selectedCount = selectedRowKeys.length;

  const items: UserRow[] = data?.users?.items || [];
  const total = data?.users?.total || 0;

  // ค้นหาแบบ debounce (แพทเทิร์นเดียวกับหน้า products/shipment) แทนต้องกดปุ่ม Search เอง
  const debouncedSearch = useMemo(
    () =>
      debounce(async (v: string) => {
        setPage(1);
        setSelectedRowKeys([]);
        await refetch({ search: v, limit: pageSize, offset: 0 });
      }, 300),
    [refetch, pageSize]
  );
  useEffect(() => () => debouncedSearch.cancel(), [debouncedSearch]);
  const onSearchChange = (v: string) => {
    setSearchInput(v);
    setSearch(v);
    debouncedSearch(v);
  };

  const handleBulkDelete = async () => {
    if (!selectedCount) return;
    Modal.confirm({
      title: t("admin_users.bulk_delete_title", { count: selectedCount }),
      content: t("admin_users.bulk_delete_content"),
      okButtonProps: { danger: true },
      okText: t("admin_users.btn_delete"),
      cancelText: t("admin_users.cancel_text"),
      onOk: async () => {
        const ids = selectedRowKeys.map(String);
        try {
          const res = await deleteMany({ variables: { ids } });
          if (res.data?.deleteUsers) {
            message.success(t("admin_users.bulk_delete_success", { count: selectedCount }));
            setSelectedRowKeys([]);
            const newTotal = total - selectedCount;
            const maxPage = Math.max(1, Math.ceil(newTotal / pageSize));
            const nextPage = Math.min(page, maxPage);
            setPage(nextPage);
            await refetch({ search, limit: pageSize, offset: (nextPage - 1) * pageSize });
          } else {
            message.error(t("admin_users.delete_failed"));
          }
        } catch (e: any) {
          // mutation ปฏิเสธได้จริง (ไม่มีสิทธิ์/บทบาทไม่ถึง) — ต้องโชว์เหตุผลจาก server
          // ไม่งั้นจะเป็น unhandled rejection แล้วผู้ใช้ไม่เห็นอะไรเลย
          message.error(e?.message || t("admin_users.delete_failed"));
        }
      },
    });
  };

  const deleteRow = async (r: UserRow) => {
    try {
      const res = await deleteOne({ variables: { id: r.id } });
      if (res.data?.deleteUser) {
        message.success(t("admin_users.delete_success"));
        const newTotal = total - 1;
        const maxPage = Math.max(1, Math.ceil(newTotal / pageSize));
        const nextPage = Math.min(page, maxPage);
        setPage(nextPage);
        await refetch({ search, limit: pageSize, offset: (nextPage - 1) * pageSize });
      } else {
        message.error(t("admin_users.delete_failed"));
      }
    } catch (e: any) {
      // เช่น แถวถูกลบไปแล้วโดยคนอื่น (NOT_FOUND) หรือบทบาทไม่ถึง (FORBIDDEN)
      message.error(e?.message || t("admin_users.delete_failed"));
    }
  };

  const columns = useMemo(
    () => [
      {
        title: t("admin_users.col_user"),
        dataIndex: "name",
        render: (v: string, r: UserRow) => (
          <Space>
            <UserAvatar name={r.name} avatar={r.avatar} />
            <Space direction="vertical" size={0}>
              <Space size={4}>
                <UserNameLink href={`/admin/users/${r.id}/edit`} label={v} disabledReason={blockedReason(r)} />
                {r.id === myId ? <Tag color="blue" style={{ marginInlineEnd: 0 }}>{t("admin_users.you_tag")}</Tag> : null}
              </Space>
              {/* platform admin เห็น user ข้ามร้าน — badge บอกว่า user เป็นของร้านไหน
                  (regular admin เห็นแค่ร้านตัวเองอยู่แล้ว badge จะซ้ำกันทุกแถว แต่ไม่เป็นอันตราย) */}
              {r.tenantName ? <Tag color="geekblue" style={{ marginInlineEnd: 0 }}>{r.tenantName}</Tag> : null}
            </Space>
          </Space>
        ),
      },
      { title: t("admin_users.col_email"), dataIndex: "email" },
      { title: t("admin_users.col_phone"), dataIndex: "phone", render: (v: string | null) => v || <span style={{ color: "var(--app-muted)" }}>—</span> },
      { title: t("admin_users.col_role"), dataIndex: "role", render: roleTag },
      { title: t("admin_users.col_created"), dataIndex: "created_at", render: formatDate },
      { title: t("admin_users.col_last_login"), dataIndex: "lastLoginAt", render: (d: string | null) => d ? formatDate(d) : <span style={{ color: "var(--app-muted)" }}>{t("admin_users.never_logged_in")}</span> },
      {
        title: t("admin_users.col_actions"),
        render: (_: any, r: UserRow) => (
          <Space size="small">
            <EditUserAction href={`/admin/users/${r.id}/edit`} reason={blockedReason(r)} />
            <DeleteUserAction reason={deleteReason(r)} onConfirm={() => deleteRow(r)} />
          </Space>
        ),
      },
    ],
    // canWrite/meData อยู่ใน closure ของ blockedReason ที่ render ใช้ → ต้องอยู่ใน deps
    // ไม่งั้นปุ่มจะค้างสถานะเดิมตอนสิทธิ์โหลดเสร็จทีหลัง
    [search, refetch, page, pageSize, total, myId, myRole, canWrite, meData, t]
  );

  const rowSelection = {
    selectedRowKeys,
    onChange: (keys: React.Key[]) => setSelectedRowKeys(keys),
    selections: [Table.SELECTION_ALL, Table.SELECTION_INVERT, Table.SELECTION_NONE],
    // ห้ามเลือกแถวตัวเอง (กันเผลอลบตัวเองผ่าน bulk delete) และแถวที่ rank ไม่ถึง —
    // deleteUsers เป็น all-or-nothing ถ้าติ๊กแถวที่แตะไม่ได้ไปด้วยจะ throw ทั้งชุด ไม่ลบอะไรเลย
    getCheckboxProps: (r: UserRow) => (deleteReason(r) ? { disabled: true } : {}),
  };

  return (
    <div>
      <AdminPageHeader title={t("admin_users.title")}>
        <Input.Search
          placeholder={t("admin_users.search_placeholder")}
          allowClear
          style={{ width: isMobile ? "100%" : 260 }}
          value={searchInput}
          onChange={(e) => onSearchChange(e.target.value)}
        />
        <Button danger disabled={!selectedCount || !canWrite} icon={<DeleteOutlined />} onClick={handleBulkDelete}>
          {t("admin_users.btn_delete_selected", { count: selectedCount })}
        </Button>
        <Button type="primary" icon={<PlusOutlined />} href="/admin/users/new" disabled={!canWrite}>
          {t("admin_users.btn_add_user")}
        </Button>
        <Button icon={<ReloadOutlined />} onClick={() => refetch()} loading={loading} />
      </AdminPageHeader>

      {isMobile ? (
        <AdminMobileList
          loading={loading}
          dataSource={items}
          rowKey={(r) => r.id}
          totalText={(n) => t("admin_users.mobile_total", { n })}
          emptyText={
            search.trim()
              ? t("admin_users.empty_search")
              : t("admin_users.empty_no_users")
          }
          renderItem={(r) => (
            <AdminRecordCard
              key={r.id}
              title={
                <Space align="start">
                  <UserAvatar name={r.name} avatar={r.avatar} />
                  <Space direction="vertical" size={0}>
                    <Space size={4}>
                      <UserNameLink href={`/admin/users/${r.id}/edit`} label={r.name} disabledReason={blockedReason(r)} />
                      {r.id === myId ? <Tag color="blue" style={{ marginInlineEnd: 0 }}>{t("admin_users.you_tag")}</Tag> : null}
                    </Space>
                    <Typography.Text type="secondary" style={{ fontSize: 12 }}>{r.email}</Typography.Text>
                  </Space>
                </Space>
              }
              extra={roleTag(r.role)}
              fields={[
                { label: t("admin_users.col_phone"), value: r.phone || "—" },
                { label: t("admin_users.field_shop"), value: r.tenantName || "—", hidden: !r.tenantName },
                { label: t("admin_users.col_created"), value: formatDate(r.created_at) },
                { label: t("admin_users.col_last_login"), value: r.lastLoginAt ? formatDate(r.lastLoginAt) : t("admin_users.never_logged_in") },
              ]}
              actions={
                <>
                  <EditUserAction href={`/admin/users/${r.id}/edit`} reason={blockedReason(r)} />
                  <DeleteUserAction reason={deleteReason(r)} onConfirm={() => deleteRow(r)} />
                </>
              }
            />
          )}
        />
      ) : (
        <Table
          rowKey="id"
          loading={loading}
          dataSource={items}
          columns={columns as any}
          rowSelection={rowSelection}
          scroll={{ x: "max-content" }}
          locale={{
            emptyText: search.trim()
              ? t("admin_users.empty_search")
              : t("admin_users.empty_no_users"),
          }}
          pagination={{
            current: page,
            pageSize,
            total,
            showSizeChanger: true,
            pageSizeOptions: [10, 20, 50, 100],
            showTotal: (tot, range) => t("admin_users.pagination_range", { from: range[0], to: range[1], total: tot }),
            onChange: async (nextPage, nextSize) => {
              const sizeChanged = nextSize !== pageSize;
              const finalPage = sizeChanged ? 1 : nextPage;
              const finalSize = nextSize;

              setPage(finalPage);
              setPageSize(finalSize);
              setSelectedRowKeys([]);

              await refetch({
                search,
                limit: finalSize,
                offset: (finalPage - 1) * finalSize,
              });
            },
          }}
        />
      )}
    </div>
  );
}

export default function Page() {
  return <UsersList />;
}
