// apps/web/app/(admin)/admin/file/page.tsx
"use client";

import { useUiText } from "@/lib/useUiText";
import React, { useMemo, useState } from "react";
import { Input, Upload, Button, Table, Space, Modal, message, Popconfirm, Image } from "antd";
import { UploadOutlined } from "@ant-design/icons";
import Link from "next/link";
import { useQuery, useMutation } from "@apollo/client";
// import { Q_FILES_PAGED, M_DELETE_FILE, M_DELETE_FILES, M_RENAME_FILE } from "@/graphql/files";

// graphql/files.ts
import { gql } from '@apollo/client';

const Q_FILES_PAGED = gql`
  query($q:String, $limit:Int!, $offset:Int!){
    filesPaged(search:$q, limit:$limit, offset:$offset){
      total
      items{
        id filename original_name mimetype size created_at updated_at
        url thumb
      }
    }
  }
`;

const M_DELETE_FILE = gql`mutation($id:ID!){ deleteFile(id:$id) }`;
const M_DELETE_FILES = gql`mutation($ids:[ID!]!){ deleteFiles(ids:$ids) }`;
const M_RENAME_FILE = gql`mutation($id:ID!,$name:String!){ renameFile(id:$id, name:$name) }`;


type FileRow = {
  id: number|string;
  filename: string;
  original_name: string | null;
  mimetype: string | null;
  size: number;
  created_at: string;
  updated_at: string;
  url: string;
  thumb?: string | null;
};

export default function FilesPage(){
  const uiText = useUiText();
  const [q,setQ] = useState("");
  const [page,setPage] = useState(1);
  const [pageSize,setPageSize] = useState(20);

  const { data, loading, refetch } = useQuery(Q_FILES_PAGED, {
    variables: { q:'', limit: pageSize, offset: (page-1)*pageSize }
  });

  const [mutDel]      = useMutation(M_DELETE_FILE);
  const [mutDelMany]  = useMutation(M_DELETE_FILES);
  const [mutRename]   = useMutation(M_RENAME_FILE);

  const items: FileRow[] = data?.filesPaged?.items ?? [];
  const total = data?.filesPaged?.total ?? 0;
  
  const [selectedRowKeys, setSelectedRowKeys] = useState<React.Key[]>([]);
  const selectedCount = selectedRowKeys.length;

  const onSearch = (value?: string) => {
    const qq = value ?? q;
    setQ(qq);
    setPage(1);
    refetch({ q: qq, limit: pageSize, offset: 0 });
  };

  const delFile = async (r: FileRow) => {
    const res = await mutDel({ variables: { id: String(r.id) } });
    if (res.data?.deleteFile) {
      message.success(uiText("admin_ui.en_deleted_441bd"));
      refetch({ q, limit: pageSize, offset: (page-1)*pageSize });
    } else {
      message.error(uiText("admin_ui.en_delete_failed_64513"));
    }
  };

  const delFilesBulk = async () => {
    if (!selectedCount) return;
    Modal.confirm({
      title: uiText("admin_ui.en_delete_file_s_5896e", { v0: selectedCount }),
      content: uiText("admin_ui.en_this_action_cannot_be_undone_951f4"),
      okButtonProps: { danger: true },
      onOk: async () => {
        const ids = selectedRowKeys.map(String);
        const res = await mutDelMany({ variables: { ids } });
        if (res.data?.deleteFiles) {
          message.success(uiText("admin_ui.en_deleted_item_s_d41b7", { v0: selectedCount }));
          setSelectedRowKeys([]);
          refetch({ q, limit: pageSize, offset: (page-1)*pageSize });
        } else {
          message.error(uiText("admin_ui.en_delete_failed_64513"));
        }
      }
    });
  };

  const renameFile = async (r: FileRow) => {
    const name = prompt(uiText("admin_ui.en_rename_to_5942b"), r.original_name || r.filename);
    if (!name) return;
    const res = await mutRename({ variables: { id: String(r.id), name } });
    if (res.data?.renameFile) {
      message.success(uiText("admin_ui.en_renamed_e5ad1"));
      refetch({ q, limit: pageSize, offset: (page-1)*pageSize });
    } else {
      message.error(uiText("admin_ui.en_rename_failed_85aa4"));
    }
  };

  const columns = useMemo(()=>[
    {
      title: uiText("admin_ui.en_preview_f1fbb"),
      dataIndex: "thumb",
      key: "thumb",
      render: (_: any, r: FileRow) =>{
        return r.url ? (
          <Image src={r.url} alt="" width={64} height={64} style={{ objectFit:'cover', borderRadius:6 }} />
        ) : (
          <div style={{ width:64, height:64, borderRadius:6, background:'var(--app-surface-2)', display:'flex', alignItems:'center', justifyContent:'center' }}>
            <span style={{ color:'var(--app-muted)', fontSize:12 }}>{uiText("admin_ui.en_no_preview_00a6e")}</span>
          </div>
        )
      },
      width: 90,
    },
    { title:uiText("admin_ui.en_name_709a2"), dataIndex:"original_name", key:"original_name", render:(v: string|null, r:FileRow)=> v || r.filename },
    { title:uiText("admin_ui.en_type_3deb7"), dataIndex:"mimetype", key:"mimetype" },
    { title:uiText("admin_ui.en_size_b7152"), dataIndex:"size", key:"size", render:(v:number)=> (v/1024).toFixed(1)+" KB" },
    { title:uiText("admin_ui.en_created_accf4"), dataIndex:"created_at", key:"created_at" },
    {
      title:uiText("admin_ui.en_actions_c3cd6"),
      key:"actions",
      render: (_:any, r:FileRow)=> (
        <Space>
          <Link href={`${r.url}?mode=download`}>{uiText("admin_ui.en_download_a479c")}</Link>
          <a onClick={()=> renameFile(r)}>{uiText("admin_ui.en_rename_d3f4c")}</a>
          <Popconfirm title={uiText("admin_ui.en_delete_this_file_3cf37")} onConfirm={()=> delFile(r)}>
            <a>{uiText("admin_ui.en_delete_f6fdb")}</a>
          </Popconfirm>
        </Space>
      )
    },
  ],[uiText, ]);

  const rowSelection = {
    selectedRowKeys,
    onChange: (keys: React.Key[]) => setSelectedRowKeys(keys),
    selections: [Table.SELECTION_ALL, Table.SELECTION_INVERT, Table.SELECTION_NONE],
  };

  const onUploadChange = (info:any) => {
    if (info.file.status === "done") {
      message.success(uiText("admin_ui.en_uploaded_80c49"));
      refetch({ q, limit: pageSize, offset: (page-1)*pageSize });
    } else if (info.file.status === "error") {
      message.error(uiText("admin_ui.en_upload_failed_ad0d0"));
    }
  };

  return (
    <div className="p-6">
      <Space className="mb-4" wrap>
        <Input.Search
          placeholder={uiText("admin_ui.en_search_by_name_28abc")}
          allowClear
          enterButton
          value={q}
          onChange={e=>setQ(e.target.value)}
          onSearch={()=>onSearch()}
        />
        <Upload name="file" action="/api/files" onChange={onUploadChange} showUploadList={false}>
          <Button icon={<UploadOutlined/>}>{uiText("admin_ui.en_upload_8bdf0")}</Button>
        </Upload>

        <Button danger disabled={!selectedCount} onClick={delFilesBulk}>
          {uiText("admin_ui.en_delete_selected_eec82")}{selectedCount})
        </Button>
      </Space>

      <Table
        rowKey="id"
        loading={loading}
        columns={columns as any}
        dataSource={items}
        rowSelection={rowSelection}
        pagination={{
          current: page,
          pageSize,
          total,
          showSizeChanger: true,
          showTotal: (tot, range) =>
            uiText("admin_ui.en_of_items_9aa37", { v0: range[0], v1: range[1], v2: tot }),
          onChange: (p, ps) => {
            setPage(p);
            setPageSize(ps);
            refetch({ q, limit: ps, offset: (p-1)*ps });
            setSelectedRowKeys([]);
          }
        }}
      />
    </div>
  );
}
