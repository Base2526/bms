'use client';
import { gql, useQuery, useMutation } from "@apollo/client";
import { Table, Input, Space, Button, Tag, Modal, message } from "antd";
import { useState } from "react";

const Q = gql`query($q:String){ myPosts(search:$q){ id title phone status created_at } }`;
const DEL = gql`mutation($id:ID!){ deletePost(id:$id) }`;

function MyPostsList(){
  const [q, setQ] = useState('');
  const { data, refetch } = useQuery(Q,{ variables:{ q:'' } });
  const [doDel] = useMutation(DEL);
  const cols = [
    { title:'Title', dataIndex:'title' },
    { title:'Phone', dataIndex:'phone' },
    { title:'Status', dataIndex:'status', render:(s:string)=><Tag color={s==='public'?'green':'red'}>{s}</Tag> },
    { title:'Action', render:(_:any,r:any)=><Space>
        <a href={`/post/${r.id}/edit`}>edit [x]</a>
        <a onClick={()=>{
          Modal.confirm({
            title: 'Delete this post?',
            onOk: async ()=>{
              const res = await doDel({ variables:{ id: r.id } });
              if (res.data?.deletePost) { message.success('Deleted'); refetch(); }
              else message.error('Delete failed');
            }
          });
        }}>delete</a>
        <a href={`/post/${r.id}/view`}>view</a>
      </Space> }
  ];
  return (<>
    <Space style={{marginBottom:16}}>
      <Input placeholder="Search title/phone" value={q} onChange={e=>setQ(e.target.value)} />
      <Button onClick={()=>refetch({ q })}>Search</Button>
      <Button type="primary"><a href="/post/new" style={{ color: 'inherit' }}>+ New Post</a></Button>
    </Space>
    <Table rowKey="id" dataSource={data?.myPosts||[]} columns={cols as any} />
  </>);
}

export default function Page(){
  return <MyPostsList/>;
}
