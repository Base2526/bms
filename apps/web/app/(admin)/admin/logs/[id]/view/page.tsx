'use client';
import React, { useEffect, useState } from 'react';
import { Card, Space, Tag, Button, message, Descriptions, Divider } from 'antd';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';

type LogRow = {
  id: number;
  level: string;
  category: string;
  message: string;
  meta: any;
  created_by: number | null;
  created_at: string;

  action?: string | null;
  status?: string | null;
  correlation_id?: string | null;
  session_id?: string | null;
  screen_name?: string | null;
  route_name?: string | null;
  platform?: string | null;
  app_version?: string | null;
  duration_ms?: number | null;
  error_message?: string | null;
  stack?: string | null;
};

const ADMIN_API_PREFIX = '/api';

function levelTag(level: string){
  const color =
    level === 'error' ? 'red' :
    level === 'warn' ? 'orange' :
    level === 'info' ? 'blue' :
    level === 'debug' ? 'default' : 'default';
  return <Tag color={color}>{level}</Tag>;
}

export default function LogDetailPage(){
  const { id } = useParams<{id:string}>();
  const router = useRouter();
  const [row, setRow] = useState<LogRow | null>(null);
  const [loading, setLoading] = useState(false);

//   async function load(){
//     setLoading(true);
//     try{
//       const res = await fetch(`/api/logs?q=${encodeURIComponent(id || '')}`, { cache: 'no-store' });;// await fetch(`${ADMIN_API_PREFIX}/logs/${id}`, { cache: 'no-store' });

//       console.log("[res]", res)
//       if(!res.ok) throw new Error('Load failed');
//       const j = await res.json();

//       console.log("[j]", j);
//       setRow(j);
//     }catch(e:any){
//       message.error(e.message||'Load failed');
//     }finally{ setLoading(false); }
//   }

    async function load() {
        setLoading(true);
        try {
            // 1️⃣ ลองเรียก endpoint ใหม่ก่อน
            let res = await fetch(`${ADMIN_API_PREFIX}/logs/${id}`, { cache: 'no-store' });

            console.log("[res @1]", res, id);
            // // 2️⃣ ถ้ายังไม่มี (404) → fallback ไปแบบเก่า /api/logs?q=id
            // if (res.status === 404) {
            //     res = await fetch(`${ADMIN_API_PREFIX}/logs?q=${encodeURIComponent(id || '')}`, { cache: 'no-store' });
                
            //     console.log("[res @2]", res);
            //     if (!res.ok) throw new Error('Load failed');
            //     const j = await res.json();
            //     const found = Array.isArray(j.items)
            //         ? j.items.find((x: any) => String(x.id) === String(id))
            //         : null;

            //     console.log("[res @2-1]", j, found);
            //     if (!found) throw new Error('Log not found');
            //     setRow(found);
            //     return;
            // }

            // 3️⃣ ใช้ API ใหม่สำเร็จ
            if (!res.ok) throw new Error('Load failed');
            const j = await res.json();
            setRow(j);
        } catch (e: any) {
            message.error(e.message || 'Load failed');
        } finally {
            setLoading(false);
        }
    }


  async function remove(){
    const res = await fetch(`${ADMIN_API_PREFIX}/logs/${id}`, { method:'DELETE' });
    if(res.ok){ message.success('Deleted'); router.push('/admin/logs'); }
    else { const j = await res.json().catch(()=> ({})); message.error(j.error||'Delete failed'); }
  }

  useEffect(()=>{ load(); /* eslint-disable-next-line */ }, [id]);

  if (!row) return <Card loading title="Log detail" />;

  return (
    <Card
      title={`Log #${row.id}`}
      extra={
        <Space>
          {row.created_by ? (
            <Link href={`/admin/logs?user_id=${encodeURIComponent(String(row.created_by))}`}>
              <Button>Filter user</Button>
            </Link>
          ) : null}
          {row.session_id ? (
            <Link href={`/admin/logs/timeline?session_id=${encodeURIComponent(String(row.session_id))}`}>
              <Button>Timeline (session)</Button>
            </Link>
          ) : null}
          {row.correlation_id ? (
            <Link href={`/admin/logs/timeline?correlation_id=${encodeURIComponent(String(row.correlation_id))}`}>
              <Button>Timeline (correlation)</Button>
            </Link>
          ) : null}
          <Button danger onClick={remove}>Delete</Button>
        </Space>
      }
      loading={loading}
    >
      <Descriptions column={1} bordered size="small">
        <Descriptions.Item label="Level">{levelTag(row.level)}</Descriptions.Item>
        <Descriptions.Item label="Category"><Tag>{row.category}</Tag></Descriptions.Item>
        {row.status ? <Descriptions.Item label="Status"><Tag>{row.status}</Tag></Descriptions.Item> : null}
        {row.action ? <Descriptions.Item label="Action"><Tag color="geekblue">{row.action}</Tag></Descriptions.Item> : null}
        <Descriptions.Item label="Message"><strong>{row.message}</strong></Descriptions.Item>
        <Descriptions.Item label="Created At">{new Date(row.created_at).toLocaleString()}</Descriptions.Item>
        <Descriptions.Item label="Created By">{row.created_by ?? '-'}</Descriptions.Item>

        {row.platform ? <Descriptions.Item label="Platform">{row.platform}</Descriptions.Item> : null}
        {row.app_version ? <Descriptions.Item label="App Version">{row.app_version}</Descriptions.Item> : null}
        {row.route_name ? <Descriptions.Item label="Route">{row.route_name}</Descriptions.Item> : null}
        {row.screen_name ? <Descriptions.Item label="Screen">{row.screen_name}</Descriptions.Item> : null}
        {row.session_id ? <Descriptions.Item label="Session ID">{row.session_id}</Descriptions.Item> : null}
        {row.correlation_id ? <Descriptions.Item label="Correlation ID">{row.correlation_id}</Descriptions.Item> : null}
        {typeof row.duration_ms === 'number' ? <Descriptions.Item label="Duration">{row.duration_ms}ms</Descriptions.Item> : null}
        {row.error_message ? <Descriptions.Item label="Error">{row.error_message}</Descriptions.Item> : null}
      </Descriptions>

      <Divider />

      <h4>Meta</h4>
      <pre style={{ whiteSpace:'pre-wrap', margin:0 }}>
        {JSON.stringify(row.meta || {}, null, 2)}
      </pre>

      {row.stack ? (
        <>
          <Divider />
          <h4>Stack</h4>
          <pre style={{ whiteSpace:'pre-wrap', margin:0 }}>
            {String(row.stack)}
          </pre>
        </>
      ) : null}
    </Card>
  );
}
