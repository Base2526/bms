'use client';
import { gql, useQuery, useMutation } from "@apollo/client";
import { Table, Input, Space, Button, Tag, Popconfirm, Modal, message, Avatar, Typography, Tooltip } from "antd";
import { PlusOutlined, DeleteOutlined, ReloadOutlined, EditOutlined } from "@ant-design/icons";
import { useEffect, useMemo, useState } from "react";
import debounce from "lodash/debounce";
import { useIsMobile } from "@/app/hooks/useMediaQuery";
import AdminPageHeader from "@/components/admin/AdminPageHeader";
import { AdminMobileList, AdminRecordCard } from "@/components/admin/AdminMobileList";

const Q_USERS = gql`
  query($search:String, $limit:Int, $offset:Int){
    users(search:$search, limit:$limit, offset:$offset){
      total
      items{ id name email phone role created_at avatar tenantName lastLoginAt }
    }
  }
`;

const Q_ME = gql`query { bmsMe { id } }`;

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

// ปุ่มลบ — ปิดใช้งานเสมอสำหรับแถวของตัวเอง (backend ก็ปฏิเสธซ้ำใน deleteUser/deleteUsers อยู่แล้ว
// แต่ซ่อน/ปิดที่ UI กันงงว่ากดแล้วทำไมฟ้อง error)
function DeleteUserAction({ isSelf, onConfirm }: { isSelf: boolean; onConfirm: () => void }) {
  if (isSelf) {
    return (
      <Tooltip title="ลบบัญชีของตัวเองไม่ได้">
        <Button type="link" size="small" danger disabled icon={<DeleteOutlined />}>ลบ</Button>
      </Tooltip>
    );
  }
  return (
    <Popconfirm title="ลบผู้ใช้นี้?" okText="ลบ" cancelText="ยกเลิก" onConfirm={onConfirm}>
      <Button type="link" size="small" danger icon={<DeleteOutlined />}>ลบ</Button>
    </Popconfirm>
  );
}

function UsersList() {
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
      title: `ลบผู้ใช้ ${selectedCount} คน?`,
      content: "ไม่สามารถย้อนกลับได้",
      okButtonProps: { danger: true },
      okText: "ลบ",
      cancelText: "ยกเลิก",
      onOk: async () => {
        const ids = selectedRowKeys.map(String);
        const res = await deleteMany({ variables: { ids } });
        if (res.data?.deleteUsers) {
          message.success(`ลบผู้ใช้ ${selectedCount} คนแล้ว`);
          setSelectedRowKeys([]);
          const newTotal = total - selectedCount;
          const maxPage = Math.max(1, Math.ceil(newTotal / pageSize));
          const nextPage = Math.min(page, maxPage);
          setPage(nextPage);
          await refetch({ search, limit: pageSize, offset: (nextPage - 1) * pageSize });
        } else {
          message.error("ลบไม่สำเร็จ");
        }
      },
    });
  };

  const deleteRow = async (r: UserRow) => {
    const res = await deleteOne({ variables: { id: r.id } });
    if (res.data?.deleteUser) {
      message.success("ลบแล้ว");
      const newTotal = total - 1;
      const maxPage = Math.max(1, Math.ceil(newTotal / pageSize));
      const nextPage = Math.min(page, maxPage);
      setPage(nextPage);
      await refetch({ search, limit: pageSize, offset: (nextPage - 1) * pageSize });
    } else {
      message.error("ลบไม่สำเร็จ");
    }
  };

  const columns = useMemo(
    () => [
      {
        title: "ผู้ใช้",
        dataIndex: "name",
        render: (v: string, r: UserRow) => (
          <Space>
            <UserAvatar name={r.name} avatar={r.avatar} />
            <Space direction="vertical" size={0}>
              <Space size={4}>
                <a href={`/admin/users/${r.id}/edit`}>{v}</a>
                {r.id === myId ? <Tag color="blue" style={{ marginInlineEnd: 0 }}>คุณ</Tag> : null}
              </Space>
              {/* platform admin เห็น user ข้ามร้าน — badge บอกว่า user เป็นของร้านไหน
                  (regular admin เห็นแค่ร้านตัวเองอยู่แล้ว badge จะซ้ำกันทุกแถว แต่ไม่เป็นอันตราย) */}
              {r.tenantName ? <Tag color="geekblue" style={{ marginInlineEnd: 0 }}>{r.tenantName}</Tag> : null}
            </Space>
          </Space>
        ),
      },
      { title: "อีเมล", dataIndex: "email" },
      { title: "เบอร์โทร", dataIndex: "phone", render: (v: string | null) => v || <span style={{ color: "var(--app-muted)" }}>—</span> },
      { title: "บทบาท", dataIndex: "role", render: roleTag },
      { title: "สร้างเมื่อ", dataIndex: "created_at", render: formatDate },
      { title: "เข้าระบบล่าสุด", dataIndex: "lastLoginAt", render: (d: string | null) => d ? formatDate(d) : <span style={{ color: "var(--app-muted)" }}>ยังไม่เคย</span> },
      {
        title: "จัดการ",
        render: (_: any, r: UserRow) => (
          <Space size="small">
            <Button type="link" size="small" icon={<EditOutlined />} href={`/admin/users/${r.id}/edit`}>แก้ไข</Button>
            <DeleteUserAction isSelf={r.id === myId} onConfirm={() => deleteRow(r)} />
          </Space>
        ),
      },
    ],
    [search, refetch, page, pageSize, total, myId]
  );

  const rowSelection = {
    selectedRowKeys,
    onChange: (keys: React.Key[]) => setSelectedRowKeys(keys),
    selections: [Table.SELECTION_ALL, Table.SELECTION_INVERT, Table.SELECTION_NONE],
    // ห้ามเลือกแถวตัวเองไปรวมกับ "ลบที่เลือก" — กันเผลอลบตัวเองผ่าน bulk delete
    getCheckboxProps: (r: UserRow) => (r.id === myId ? { disabled: true } : {}),
  };

  return (
    <div>
      <AdminPageHeader title="ผู้ใช้งาน">
        <Input.Search
          placeholder="ค้นหาชื่อ / เบอร์โทร / อีเมล"
          allowClear
          style={{ width: isMobile ? "100%" : 260 }}
          value={searchInput}
          onChange={(e) => onSearchChange(e.target.value)}
        />
        <Button danger disabled={!selectedCount} icon={<DeleteOutlined />} onClick={handleBulkDelete}>
          ลบที่เลือก ({selectedCount})
        </Button>
        <Button type="primary" icon={<PlusOutlined />} href="/admin/users/new">
          เพิ่มผู้ใช้
        </Button>
        <Button icon={<ReloadOutlined />} onClick={() => refetch()} loading={loading} />
      </AdminPageHeader>

      {isMobile ? (
        <AdminMobileList
          loading={loading}
          dataSource={items}
          rowKey={(r) => r.id}
          totalText={(t) => `ทั้งหมด ${t} คน`}
          emptyText={
            search.trim()
              ? "ไม่พบผู้ใช้ที่ตรงกับคำค้นหาในร้านนี้"
              : "ร้านนี้ยังไม่มีผู้ใช้ กด \"เพิ่มผู้ใช้\" เพื่อเพิ่มแอดมินหรือทีมงานของร้าน"
          }
          renderItem={(r) => (
            <AdminRecordCard
              key={r.id}
              title={
                <Space align="start">
                  <UserAvatar name={r.name} avatar={r.avatar} />
                  <Space direction="vertical" size={0}>
                    <Space size={4}>
                      <a href={`/admin/users/${r.id}/edit`}>{r.name}</a>
                      {r.id === myId ? <Tag color="blue" style={{ marginInlineEnd: 0 }}>คุณ</Tag> : null}
                    </Space>
                    <Typography.Text type="secondary" style={{ fontSize: 12 }}>{r.email}</Typography.Text>
                  </Space>
                </Space>
              }
              extra={roleTag(r.role)}
              fields={[
                { label: "เบอร์โทร", value: r.phone || "—" },
                { label: "ร้าน", value: r.tenantName || "—", hidden: !r.tenantName },
                { label: "สร้างเมื่อ", value: formatDate(r.created_at) },
                { label: "เข้าระบบล่าสุด", value: r.lastLoginAt ? formatDate(r.lastLoginAt) : "ยังไม่เคย" },
              ]}
              actions={
                <>
                  <Button type="link" size="small" icon={<EditOutlined />} href={`/admin/users/${r.id}/edit`}>แก้ไข</Button>
                  <DeleteUserAction isSelf={r.id === myId} onConfirm={() => deleteRow(r)} />
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
              ? "ไม่พบผู้ใช้ที่ตรงกับคำค้นหาในร้านนี้"
              : "ร้านนี้ยังไม่มีผู้ใช้ กด \"เพิ่มผู้ใช้\" เพื่อเพิ่มแอดมินหรือทีมงานของร้าน",
          }}
          pagination={{
            current: page,
            pageSize,
            total,
            showSizeChanger: true,
            pageSizeOptions: [10, 20, 50, 100],
            showTotal: (tot, range) => `${range[0]}-${range[1]} จาก ${tot} คน`,
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
