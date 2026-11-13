"use client";

import { useUiText, thaiUiText, type UiTranslator } from "@/lib/useUiText";
import { gql, useQuery, useMutation } from "@apollo/client";
import {
  Table,
  Input,
  Space,
  Button,
  Tag,
  Modal,
  message,
  Popconfirm,
  Tooltip,
} from "antd";
import type { TableColumnsType } from "antd";
import Link from "next/link";
import { useMemo, useState } from "react";
import { EditOutlined, DeleteOutlined } from "@ant-design/icons";

import ThumbGrid from '@/components/ThumbGrid';

const Q_POSTS_PAGED = gql`
  query($q:String, $limit:Int!, $offset:Int!){
    postsPaged(search:$q, limit:$limit, offset:$offset){
      total
      items{
        id 
        title 
        detail 
        status 
        created_at
        updated_at
        images { id url }
        author { id name avatar }
      }
    }
  }
`;
const M_DEL = gql`mutation($id:ID!){ deletePost(id:$id) }`;
const M_DEL_MANY = gql`mutation($ids:[ID!]!){ deletePosts(ids:$ids) }`;

const statusTag = (s:string)=><Tag color={s==='public'?'green':'red'}>{s}</Tag>;

type PostRow = {
  id: string;
  title?: string | null;
  detail?: string | null;
  status?: string | null;
  created_at?: string | null;
  updated_at?: string | null;
  images?: any;
  author?: { id: string; name?: string | null } | null;
};

const formatDateTime = (
  value: string | number | null | undefined, uiText: UiTranslator = thaiUiText
): string => {
  if (value === null || value === undefined || value === "") return "-";

  let timestamp: number;

  if (typeof value === "string") {
    const trimmed = value.trim();
    if (!trimmed) return "-";

    const parsed = Number(trimmed);
    if (Number.isNaN(parsed)) return "-";
    timestamp = parsed;
  } else {
    timestamp = value;
  }

  const digits = String(Math.trunc(timestamp)).length;

  if (digits === 10) {
    timestamp = timestamp * 1000;
  }

  const date = new Date(timestamp);

  if (Number.isNaN(date.getTime())) return "-";

  return date.toLocaleString(uiText.locale);
};

function PostsList(){
  const uiText = useUiText();
  const [q, setQ] = useState('');
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);

  const { data, refetch, loading } = useQuery(Q_POSTS_PAGED, {
    variables: { q:'', limit: pageSize, offset: (page-1)*pageSize }
  });

  const [doDel] = useMutation(M_DEL);
  const [doDelMany] = useMutation(M_DEL_MANY);

  // multi-select
  const [selectedRowKeys, setSelectedRowKeys] = useState<React.Key[]>([]);
  const selectedCount = selectedRowKeys.length;

  // loading สำหรับปุ่ม delete เฉพาะแถว
  const [deletingId, setDeletingId] = useState<string | null>(null);

  const onSearch = () => {
    setPage(1);
    refetch({ q, limit: pageSize, offset: 0 });
  };

  const onBulkDelete = async () => {
    if (!selectedCount) return;
    Modal.confirm({
      title: uiText("admin_ui.en_delete_post_s_76f91", { v0: selectedCount }),
      content: uiText("admin_ui.en_this_action_cannot_be_undone_951f4"),
      okButtonProps: { danger: true },
      onOk: async () => {
        const ids = selectedRowKeys.map(String);
        const res = await doDelMany({ variables: { ids } });
        if (res.data?.deletePosts) {
          message.success(uiText("admin_ui.en_deleted_item_s_d41b7", { v0: selectedCount }));
          setSelectedRowKeys([]);
          refetch({ q, limit: pageSize, offset: (page-1)*pageSize });
        } else {
          message.error(uiText("admin_ui.en_delete_failed_64513"));
        }
      }
    });
  };

  const handleDelete = async (id: string) => {
    try {
      setDeletingId(id); // 👉 เซ็ต id ของแถวที่กำลังลบ
      const res = await doDel({ variables: { id } });
      if (res.data?.deletePost) {
        message.success(uiText("admin_ui.en_deleted_441bd"));
        refetch({ q, limit: pageSize, offset: (page-1)*pageSize });
      } else {
        message.error(uiText("admin_ui.en_delete_failed_64513"));
      }
    } catch (err) {
      console.error(err);
      message.error(uiText("admin_ui.en_delete_failed_64513"));
    } finally {
      setDeletingId(null); // 👉 เคลียร์หลังลบเสร็จ
    }
  };

  const cols = useMemo<TableColumnsType<PostRow>>(()=>[
    {
      title:uiText("admin_ui.en_images_09e87"),
      dataIndex:'images',
      render:(imgs:any)=><ThumbGrid images={imgs} width={160} height={110} />
    },
    {
      title:uiText("admin_ui.en_title_768e0"),
      render: (_:any, r:any)=>{
        return <Link href={`/admin/post/${r.id}`}>{r.title}</Link>
      }
    },
    {
      title:uiText("admin_ui.en_detail_7c9a7"),
      dataIndex:'detail'
    },
    {
      title:uiText("admin_ui.en_author_5fda2"),
      render:(_:any,r:any)=>
        <Link href={`/admin/users/${r.author.id}/edit`} prefetch={false}>
          {r.author?.name}
        </Link>
    },
    {
      title:uiText("admin_ui.en_status_bae7d"),
      dataIndex:'status',
      render:statusTag
    },
    {
      title:uiText("admin_ui.en_action_97c89"),
      render: (_:any, r:any) => (
        <Space>
          {/* ปุ่ม Edit แบบไอคอน + Tooltip */}
          <>
            <Tooltip title={uiText("admin_ui.en_edit_53016")}>
              <Link href={`/admin/post/${r.id}/edit`} prefetch={false}>
                <Button
                  type="text"
                  size="small"
                  icon={<EditOutlined />}
                />
              </Link>
            </Tooltip>

            {/* ปุ่ม Delete แบบ Popconfirm + Tooltip */}
            <Popconfirm
              title={uiText("admin_ui.en_confirm_delete_32a98")}
              okText={uiText("admin_ui.en_yes_5397e")}
              cancelText={uiText("admin_ui.en_no_816c5")}
              onConfirm={() => handleDelete(r.id)}
            >
              <Tooltip title={uiText("admin_ui.en_delete_f6fdb")}>
                <Button
                  type="text"
                  size="small"
                  danger
                  // ✅ loading เฉพาะแถวที่ id ตรงกับ deletingId
                  loading={deletingId === r.id}
                  icon={<DeleteOutlined />}
                />
              </Tooltip>
            </Popconfirm>
          </>
        </Space>
      )
    },
    {
      title: uiText("admin_ui.en_created_at_5db15"),
      dataIndex: 'created_at',
      key: 'created_at',
      render: (value) => formatDateTime(value, uiText),
    },
    {
      title: uiText("admin_ui.en_updated_at_22714"),
      dataIndex: 'updated_at',
      key: 'updated_at',
      render: (value) => formatDateTime(value, uiText),
    },
  ], [uiText, deletingId, q, page, pageSize, refetch]); // เปลี่ยนจาก deleting -> deletingId

  const rowSelection = {
    selectedRowKeys,
    onChange: (keys: React.Key[]) => setSelectedRowKeys(keys),
    selections: [Table.SELECTION_ALL, Table.SELECTION_INVERT, Table.SELECTION_NONE],
  };

  const items = data?.postsPaged?.items || [];
  const total = data?.postsPaged?.total || 0;

  return (
    <>
      <Space style={{marginBottom:16}} wrap>
        <Input
          placeholder={uiText("admin_ui.en_search_title_phone_263ba")}
          value={q}
          onChange={e=>setQ(e.target.value)}
          onPressEnter={onSearch}
        />
        <Button onClick={onSearch}>{uiText("admin_ui.en_search_bce06")}</Button>

        <Button danger disabled={!selectedCount} onClick={onBulkDelete}>
          {uiText("admin_ui.en_delete_selected_eec82")}{selectedCount})
        </Button>

        <Button type="primary">
          <Link href="/admin/post/new" style={{ color: 'inherit' }}>{uiText("admin_ui.en_new_post_25571")}</Link>
        </Button>
      </Space>

      <Table
        rowKey="id"
        loading={loading}
        dataSource={items}
        columns={cols}
        rowSelection={rowSelection}
        pagination={{
          current: page,
          pageSize,
          total,
          showSizeChanger: true,
          showTotal: (tot, range) =>
            uiText("admin_ui.en_of_items_9aa37", { v0: range[0], v1: range[1], v2: tot }),
          onChange: (p, ps) => {
            const changedPageSize = ps !== pageSize;
            setPage(p);
            setPageSize(ps);
            refetch({
              q,
              limit: ps,
              offset: (p-1)*ps
            });
            if (changedPageSize) setSelectedRowKeys([]); // เคลียร์ selection เมื่อเปลี่ยน pageSize
          }
        }}
      />
    </>
  );
}

export default function Page(){ return <PostsList/>; }