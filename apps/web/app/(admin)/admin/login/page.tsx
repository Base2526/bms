'use client';
import { Card, Form, Input, Button, message, Typography } from "antd";
import { useRouter, useSearchParams } from "next/navigation";
import { useState } from "react";
import { gql, useMutation } from '@apollo/client';

const LOGIN = gql`
  mutation Login($input: LoginInput!) {
    loginAdmin(input: $input) {
      ok
      message
      token
      user { id name email role }
    }
  }
`;

export default function AdminLoginPage(){
  const [loading,setLoading] = useState(false);
  const router = useRouter();
  const sp = useSearchParams();
  const next = sp.get("next") || "/admin";

  const [login, { loading: loadingLogin }] = useMutation(LOGIN);
  
  // async function onFinish(v:any){

  //   setLoading(true);
  //   try{
  //     const res = await fetch("/api/login", {
  //       method:"POST",
  //       headers:{ "Content-Type":"application/json" },
  //       body: JSON.stringify(v),
  //     });

  //     console.log("[res]", res, next);
  //     if(!res.ok){
  //       const j = await res.json().catch(()=>({error:"Login failed"}));
  //       message.error(j.error||"Login failed");
  //       return;
  //     }
  //     message.success("Welcome, admin");
  //     router.replace(next);
  //   }finally{ setLoading(false); }
  // }

  const onFinish = async (values: { identifier: string; password: string }) => {
      const { identifier, password } = values;
  
      // เดาว่าเป็น email ถ้ามี '@' ไม่งั้นใช้ username
      const input = identifier.includes('@')
        ? { email: identifier.trim(), password }
        : { username: identifier.trim(), password };
  
      try {
        const { data } = await login({ variables: { input } });
        const res = data?.loginAdmin
        console.log("[login]", res, res.user?.name );
  
        if (!res?.ok) {
          message.error(res?.message || 'Invalid credentials');
          return;
        }
  
        // เก็บ token แบบง่าย (แนะนำทำ httpOnly cookie ที่ฝั่ง server ในงานจริง)
        // if (res.token) {
        //   localStorage.setItem("user", JSON.stringify(res.user));
        //   localStorage.setItem('token', res.token);
        //   document.cookie = `token=${res.token}; path=/; samesite=lax`;
        // }
  
        message.success(`Welcome ${res.user?.name || ''}!`);
        router.replace(next);
      } catch (err: any) {
        message.error(err?.message || 'Login failed');
      }
  };

  return (
      <div style={{
        minHeight: '100dvh',
        display: 'flex',
        alignItems: 'flex-start',
        justifyContent: 'center',
        padding: 16,
        paddingTop: 'clamp(24px, 12vh, 140px)',
        boxSizing: 'border-box',
      }}>
        <Card title="Admin Login" style={{width: '100%', maxWidth: 420}}>
          <Form layout="vertical" onFinish={onFinish}>
            <Form.Item name="identifier" label="Username or Email" rules={[{required:true}]}>
              <Input autoFocus />
            </Form.Item>
            <Form.Item name="password" label="Password" rules={[{required:true}]}>
              <Input.Password />
            </Form.Item>
            <Button type="primary" htmlType="submit" block loading={loading}>
              Sign in
            </Button>
          </Form>
          <Typography.Paragraph type="secondary" style={{marginTop:8,fontSize:12}}>
            Admin only area — you’ll need Administrator role.
          </Typography.Paragraph>
          <Typography.Paragraph style={{marginBottom:0}}>
            <a href="/forgot">ลืมรหัสผ่านหรือมีผู้อื่นใช้อีเมลของคุณ?</a>
          </Typography.Paragraph>
        </Card>
      </div>
  );
}
