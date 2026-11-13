"use client";

import { useUiText } from "@/lib/useUiText";
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
  const uiText = useUiText();
  const { id } = useParams<{id:string}>()!;
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
            if (!res.ok) throw new Error(uiText("admin_ui.en_load_failed_1dc60"));
            const j = await res.json();
            setRow(j);
        } catch (e: any) {
            message.error(e.message || uiText("admin_ui.en_load_failed_1dc60"));
        } finally {
            setLoading(false);
        }
    }


  async function remove(){
    const res = await fetch(`${ADMIN_API_PREFIX}/logs/${id}`, { method:'DELETE' });
    if(res.ok){ message.success(uiText("admin_ui.en_deleted_441bd")); router.push('/admin/logs'); }
    else { const j = await res.json().catch(()=> ({})); message.error(j.error||uiText("admin_ui.en_delete_failed_64513")); }
  }

  useEffect(()=>{ load(); /* eslint-disable-next-line */ }, [id]);

  if (!row) return <Card loading title={uiText("admin_ui.en_log_detail_5a128")} />;

  return (
    <Card
      title={uiText("admin_ui.en_log_25e1d", { v0: row.id })}
      extra={
        <Space>
          {row.created_by ? (
            <Link href={`/admin/logs?user_id=${encodeURIComponent(String(row.created_by))}`}>
              <Button>{uiText("admin_ui.en_filter_user_9b7ad")}</Button>
            </Link>
          ) : null}
          {row.session_id ? (
            <Link href={`/admin/logs/timeline?session_id=${encodeURIComponent(String(row.session_id))}`}>
              <Button>{uiText("admin_ui.en_timeline_session_3f932")}</Button>
            </Link>
          ) : null}
          {row.correlation_id ? (
            <Link href={`/admin/logs/timeline?correlation_id=${encodeURIComponent(String(row.correlation_id))}`}>
              <Button>{uiText("admin_ui.en_timeline_correlation_22ca7")}</Button>
            </Link>
          ) : null}
          <Button danger onClick={remove}>{uiText("admin_ui.en_delete_f6fdb")}</Button>
        </Space>
      }
      loading={loading}
    >
      <Descriptions column={1} bordered size="small">
        <Descriptions.Item label={uiText("admin_ui.en_level_7c7f5")}>{levelTag(row.level)}</Descriptions.Item>
        <Descriptions.Item label={uiText("admin_ui.en_category_a3c68")}><Tag>{row.category}</Tag></Descriptions.Item>
        {row.status ? <Descriptions.Item label={uiText("admin_ui.en_status_bae7d")}><Tag>{row.status}</Tag></Descriptions.Item> : null}
        {row.action ? <Descriptions.Item label={uiText("admin_ui.en_action_97c89")}><Tag color="geekblue">{row.action}</Tag></Descriptions.Item> : null}
        <Descriptions.Item label={uiText("admin_ui.en_message_68f41")}><strong>{row.message}</strong></Descriptions.Item>
        <Descriptions.Item label={uiText("admin_ui.en_created_at_5db15")}>{new Date(row.created_at).toLocaleString(uiText.locale)}</Descriptions.Item>
        <Descriptions.Item label={uiText("admin_ui.en_created_by_43de2")}>{row.created_by ?? '-'}</Descriptions.Item>

        {row.platform ? <Descriptions.Item label={uiText("admin_ui.en_platform_123a7")}>{row.platform}</Descriptions.Item> : null}
        {row.app_version ? <Descriptions.Item label={uiText("admin_ui.en_app_version_055c4")}>{row.app_version}</Descriptions.Item> : null}
        {row.route_name ? <Descriptions.Item label={uiText("admin_ui.en_route_49995")}>{row.route_name}</Descriptions.Item> : null}
        {row.screen_name ? <Descriptions.Item label={uiText("admin_ui.en_screen_5cc84")}>{row.screen_name}</Descriptions.Item> : null}
        {row.session_id ? <Descriptions.Item label={uiText("admin_ui.en_session_id_25e4f")}>{row.session_id}</Descriptions.Item> : null}
        {row.correlation_id ? <Descriptions.Item label={uiText("admin_ui.en_correlation_id_805ca")}>{row.correlation_id}</Descriptions.Item> : null}
        {typeof row.duration_ms === 'number' ? <Descriptions.Item label={uiText("admin_ui.en_duration_13700")}>{row.duration_ms}ms</Descriptions.Item> : null}
        {row.error_message ? <Descriptions.Item label={uiText("admin_ui.en_error_7f2f6")}>{row.error_message}</Descriptions.Item> : null}
      </Descriptions>

      <Divider />

      <h4>{uiText("admin_ui.en_meta_8d546")}</h4>
      <pre style={{ whiteSpace:'pre-wrap', margin:0 }}>
        {JSON.stringify(row.meta || {}, null, 2)}
      </pre>

      {row.stack ? (
        <>
          <Divider />
          <h4>{uiText("admin_ui.en_stack_83e5a")}</h4>
          <pre style={{ whiteSpace:'pre-wrap', margin:0 }}>
            {String(row.stack)}
          </pre>
        </>
      ) : null}
    </Card>
  );
}
