// apps/web/app/(admin)/admin/file/page.tsx
'use client';
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
        id filename original_name mimetype size relpath created_at updated_at
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
  relpath: string;
  created_at: string;
  updated_at: string;
  url: string;
  thumb?: string | null;
};

export default function FilesPage(){
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
      message.success("Deleted");
      refetch({ q, limit: pageSize, offset: (page-1)*pageSize });
    } else {
      message.error("Delete failed");
    }
  };

  const delFilesBulk = async () => {
    if (!selectedCount) return;
    Modal.confirm({
      title: `Delete ${selectedCount} file(s)?`,
      content: 'This action cannot be undone.',
      okButtonProps: { danger: true },
      onOk: async () => {
        const ids = selectedRowKeys.map(String);
        const res = await mutDelMany({ variables: { ids } });
        if (res.data?.deleteFiles) {
          message.success(`Deleted ${selectedCount} item(s)`);
          setSelectedRowKeys([]);
          refetch({ q, limit: pageSize, offset: (page-1)*pageSize });
        } else {
          message.error("Delete failed");
        }
      }
    });
  };

  const renameFile = async (r: FileRow) => {
    const name = prompt("Rename to:", r.original_name || r.filename);
    if (!name) return;
    const res = await mutRename({ variables: { id: String(r.id), name } });
    if (res.data?.renameFile) {
      message.success("Renamed");
      refetch({ q, limit: pageSize, offset: (page-1)*pageSize });
    } else {
      message.error("Rename failed");
    }
  };

  const columns = useMemo(()=>[
    {
      title: "Preview",
      dataIndex: "thumb",
      key: "thumb",
      render: (_: any, r: FileRow) =>{
        return r.url ? (
          <Image src={r.url} alt="" width={64} height={64} style={{ objectFit:'cover', borderRadius:6 }} />
        ) : (
          <div style={{ width:64, height:64, borderRadius:6, background:'#f3f3f3', display:'flex', alignItems:'center', justifyContent:'center' }}>
            <span style={{ color:'#999', fontSize:12 }}>no preview</span>
          </div>
        )
      },
      width: 90,
    },
    { title:"Name", dataIndex:"original_name", key:"original_name", render:(v: string|null, r:FileRow)=> v || r.filename },
    { title:"Type", dataIndex:"mimetype", key:"mimetype" },
    { title:"Size", dataIndex:"size", key:"size", render:(v:number)=> (v/1024).toFixed(1)+" KB" },
    { title:"Created", dataIndex:"created_at", key:"created_at" },
    {
      title:"Actions",
      key:"actions",
      render: (_:any, r:FileRow)=> (
        <Space>
          <Link href={`${r.url}?mode=download`}>Download</Link>
          <a onClick={()=> renameFile(r)}>Rename</a>
          <Popconfirm title="Delete this file?" onConfirm={()=> delFile(r)}>
            <a>Delete</a>
          </Popconfirm>
        </Space>
      )
    },
  ],[]);

  const rowSelection = {
    selectedRowKeys,
    onChange: (keys: React.Key[]) => setSelectedRowKeys(keys),
    selections: [Table.SELECTION_ALL, Table.SELECTION_INVERT, Table.SELECTION_NONE],
  };

  const onUploadChange = (info:any) => {
    if (info.file.status === "done") {
      message.success("Uploaded");
      refetch({ q, limit: pageSize, offset: (page-1)*pageSize });
    } else if (info.file.status === "error") {
      message.error("Upload failed");
    }
  };

  return (
    <div className="p-6">
      <Space className="mb-4" wrap>
        <Input.Search
          placeholder="Search by name"
          allowClear
          enterButton
          value={q}
          onChange={e=>setQ(e.target.value)}
          onSearch={()=>onSearch()}
        />
        <Upload name="file" action="/api/files" onChange={onUploadChange} showUploadList={false}>
          <Button icon={<UploadOutlined/>}>Upload</Button>
        </Upload>

        <Button danger disabled={!selectedCount} onClick={delFilesBulk}>
          Delete selected ({selectedCount})
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
            `${range[0]}-${range[1]} of ${tot} items`,
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
