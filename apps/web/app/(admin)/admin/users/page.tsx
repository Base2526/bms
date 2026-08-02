'use client';
import { gql, useQuery, useMutation } from "@apollo/client";
import { Table, Input, Space, Button, Tag, Popconfirm, Modal, message, Image } from "antd";
import { useMemo, useState } from "react";

const Q_USERS = gql`
  query($search:String, $limit:Int, $offset:Int){
    users(search:$search, limit:$limit, offset:$offset){
      total
      items{ id name email phone role created_at avatar tenantName lastLoginAt }
    }
  }
`;

const M_DELETE = gql`mutation($id:ID!){ deleteUser(id:$id) }`;
const M_DELETE_MANY = gql`mutation($ids:[ID!]!){ deleteUsers(ids:$ids) }`;

const roleTag = (v:string) => (
  <Tag color={v==='Administrator'?'red':v==='Author'?'blue':'default'}>
    {v}
  </Tag>
);

function UsersList(){
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);

  const limit = pageSize;
  const offset = (page - 1) * pageSize;

  const { data, refetch, loading } = useQuery(Q_USERS, {
    variables: { search: '', limit, offset },
    fetchPolicy: "cache-and-network",
  });

  const [deleteOne] = useMutation(M_DELETE);
  const [deleteMany] = useMutation(M_DELETE_MANY);

  const [selectedRowKeys, setSelectedRowKeys] = useState<React.Key[]>([]);
  const selectedCount = selectedRowKeys.length;

  const items = data?.users?.items || [];
  const total = data?.users?.total || 0;

  const doSearch = async () => {
    setPage(1);
    setSelectedRowKeys([]);
    await refetch({ search, limit: pageSize, offset: 0 });
  };

  const handleBulkDelete = async () => {
    if (!selectedCount) return;
    Modal.confirm({
      title: `Delete ${selectedCount} user(s)?`,
      content: 'This action cannot be undone.',
      okButtonProps: { danger: true },
      onOk: async () => {
        const ids = selectedRowKeys.map(String);
        const res = await deleteMany({ variables:{ ids } });
        if (res.data?.deleteUsers) {
          message.success(`Deleted ${selectedCount} users`);
          setSelectedRowKeys([]);
          // หลังลบ: refetch หน้าเดิม (ถ้าหน้าว่าง ค่อยถอยหน้า)
          const newTotal = total - selectedCount;
          const maxPage = Math.max(1, Math.ceil(newTotal / pageSize));
          const nextPage = Math.min(page, maxPage);
          setPage(nextPage);
          await refetch({ search, limit: pageSize, offset: (nextPage - 1) * pageSize });
        } else {
          message.error('Delete failed');
        }
      }
    });
  };

  const columns = useMemo(()=>[
    {
      title:'User',
      dataIndex:'name',
      render:(v:any,r:any)=>(
        <Space direction="vertical" size={0}>
          <Space>
            {r.avatar
              ? <Image src={r.avatar} alt={r.name} width={50} height={50}
                     style={{borderRadius:'50%',objectFit:'cover'}}/>
              : <div style={{
                  width:50,height:50,borderRadius:'50%',
                  background:'#ddd',display:'inline-flex',
                  alignItems:'center',justifyContent:'center',fontSize:12
                }}>
                  {r.name?.[0]?.toUpperCase() || '?'}
                </div>}
            <a href={`/admin/users/${r.id}/edit`}>{v}</a>
          </Space>
          {/* platform admin เห็น user ข้ามร้าน — badge นี้บอกว่า user เป็นของร้านไหน
              (regular admin เห็นแค่ร้านตัวเองอยู่แล้ว badge จะซ้ำกันทุกแถว แต่ไม่เป็นอันตราย) */}
          {r.tenantName ? <Tag color="geekblue">{r.tenantName}</Tag> : null}
        </Space>
      )
    },
    { title:'Email', dataIndex:'email' },
    { title:'Phone', dataIndex:'phone' },
    { title:'Role', dataIndex:'role', render:roleTag },
    {
      title: 'Created',
      dataIndex: 'created_at',
      render: (d: string) => new Date( Number(d) ).toLocaleString(),
    },
    {
      title: 'Last Login',
      dataIndex: 'lastLoginAt',
      render: (d: string | null) => d ? new Date(d).toLocaleString() : <span style={{color:'#999'}}>ยังไม่เคย</span>,
    },
    {
      title:'Actions',
      render:(_:any,r:any)=>(
        <Space>
          <a href={`/admin/users/${r.id}/edit`}>Edit</a>
          <Popconfirm title="Delete this user?" onConfirm={async()=>{
            const res = await deleteOne({ variables:{ id:r.id } });
            if(res.data?.deleteUser){
              message.success('Deleted');

              const newTotal = total - 1;
              const maxPage = Math.max(1, Math.ceil(newTotal / pageSize));
              const nextPage = Math.min(page, maxPage);
              setPage(nextPage);

              await refetch({ search, limit: pageSize, offset: (nextPage - 1) * pageSize });
            } else message.error('Delete failed');
          }}>
            <a>Delete</a>
          </Popconfirm>
        </Space>
      )
    }
  ], [deleteOne, search, refetch, page, pageSize, total]);

  const rowSelection = {
    selectedRowKeys,
    onChange: (keys: React.Key[]) => setSelectedRowKeys(keys),
    selections: [Table.SELECTION_ALL, Table.SELECTION_INVERT, Table.SELECTION_NONE],
  };

  return (
    <>
      <Space style={{marginBottom:16}} wrap>
        <Input
          placeholder="Search name/phone/email"
          value={search}
          onChange={e=>setSearch(e.target.value)}
          onPressEnter={doSearch}
        />
        <Button onClick={doSearch}>Search</Button>

        <Button danger disabled={!selectedCount} onClick={handleBulkDelete}>
          Delete selected ({selectedCount})
        </Button>

        <Button type="primary" href="/admin/users/new">
          + New User
        </Button>
      </Space>

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
            : "ร้านนี้ยังไม่มีผู้ใช้ กด + New User เพื่อเพิ่มแอดมินหรือทีมงานของร้าน",
        }}
        pagination={{
          current: page,
          pageSize,
          total,
          showSizeChanger: true,
          pageSizeOptions: [10, 20, 50, 100],
          showTotal: (tot, range) =>
            `${range[0]}-${range[1]} of ${tot} items`,
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
    </>
  );
}

export default function Page(){ return <UsersList/>; }
