'use client';
import { useRouter, useSearchParams } from 'next/navigation';
import {
  Card,
  Form,
  Input,
  Button,
  Space,
  message,
  Typography,
  Divider,
} from 'antd';
import { gql, useMutation } from '@apollo/client';
import { GoogleLogin } from '@react-oauth/google';
import FacebookLogin from '@greatsumini/react-facebook-login';
import { GoogleOutlined, FacebookFilled, LeftOutlined } from '@ant-design/icons';

function safeInternalNextPath(nextPath: string | null): string | null {
  if (!nextPath) return null;
  if (!nextPath.startsWith('/')) return null;
  if (nextPath.startsWith('//')) return null;
  return nextPath;
}

const LOGIN = gql`
  mutation Login($input: LoginInput!) {
    loginUser(input: $input) {
      ok
      message
      token
      user { id name email role }
    }
  }
`;

const LOGIN_SOCIAL = gql`
  mutation LoginWithSocial($input: SocialLoginInput!) {
    loginWithSocial(input: $input) {
      ok
      message
      token
      user { id name email role }
    }
  }
`;

export default function Page() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const nextPath = safeInternalNextPath(searchParams.get('next'));

  const [form] = Form.useForm();
  const [login, { loading }] = useMutation(LOGIN);
  const [loginSocial, { loading: loadingSocial }] = useMutation(LOGIN_SOCIAL);

  const onLeaveLogin = () => {
    if (typeof window !== 'undefined' && window.history.length > 1) {
      router.back();
      return;
    }

    router.replace('/');
  };

  const handleLoginSuccess = (res: any) => {
    if (!res?.ok) {
      message.error(res?.message || 'Login failed');
      return;
    }
    message.success(`Welcome ${res.user?.name || ''}!`);
    // ในโปรดักชันแนะนำให้เซ็ต httpOnly cookie ที่ backend
    // ที่นี่ใช้ redirect ง่าย ๆ
    window.location.href = nextPath || '/';
  };

  // === Normal username/email + password login ===
  const onFinish = async (values: { identifier: string; password: string }) => {
    const { identifier, password } = values;

    const input = identifier.includes('@')
      ? { email: identifier.trim(), password }
      : { username: identifier.trim(), password };

    try {
      const { data } = await login({ variables: { input } });
      const res = data?.loginUser;
      console.log('[login]', res);

      handleLoginSuccess(res);
    } catch (err: any) {
      console.error(err);
      message.error(err?.message || 'Login failed');
    }
  };

  // === Google Login ===
  const onGoogleSuccess = async (credentialResponse: any) => {
    try {
      const accessToken = credentialResponse?.credential;
      if (!accessToken) {
        message.error('Google login failed: missing credential');
        return;
      }

      const { data } = await loginSocial({
        variables: {
          input: {
            provider: 'google',
            accessToken,
          },
        },
      });

      const res = data?.loginWithSocial;
      console.log('[loginWithSocial:google]', res);
      handleLoginSuccess(res);
    } catch (err: any) {
      console.error(err);
      message.error(err?.message || 'Google login failed');
    }
  };

  const onGoogleError = () => {
    message.error('Google login cancelled or failed');
  };

  // === Facebook Login ===
  const FACEBOOK_APP_ID = process.env.NEXT_PUBLIC_FACEBOOK_APP_ID!;

  const handleFacebookSuccess = async (response: any) => {
    try {

      /*
      {
        "userID": "xxxx",
        "expiresIn": 4507,
        "accessToken": "xxx",
        "signedRequest": "x.xxx",
        "graphDomain": "facebook",
        "data_access_expiration_time": 1774280693
      }
      */

      console.log("[handleFacebookSuccess] = ", response);
      const accessToken = response?.accessToken;
      if (!accessToken) {
        message.error('Facebook login failed: missing accessToken');
        return;
      }

      const { data } = await loginSocial({
        variables: {
          input: {
            provider: 'facebook',
            accessToken,
          },
        },
      });

      const res = data?.loginWithSocial;
      console.log('[loginWithSocial:facebook]', res);
      handleLoginSuccess(res);
    } catch (err: any) {
      console.error(err);
      message.error(err?.message || 'Facebook login failed');
    }
  };

  const handleFacebookFail = (error: any) => {
    console.error('Facebook login error', error);
    message.error('Facebook login cancelled or failed');
  };

  return (
    <>
    <Card
      title="Sign in"
      className="auth-card"
      extra={
        <Space className="auth-card-actions" size="small">
          <Button
            type="text"
            icon={<LeftOutlined />}
            onClick={onLeaveLogin}
            aria-label="Go back"
          >
            Back
          </Button>
          <Button type="link" href="/" aria-label="Go to home">
            Home
          </Button>
        </Space>
      }
      style={{ width: '100%', maxWidth: 420, margin: '0 auto' }}
    >
      {/* === Form Login ปกติ === */}
      <Form
        form={form}
        layout="vertical"
        onFinish={onFinish}
        initialValues={{ identifier: '', password: '' }}
      >
        <Form.Item
          label="Username or Email"
          name="identifier"
          rules={[{ required: true, message: 'Please enter your username or email' }]}
        >
          <Input
            placeholder="e.g. bob or bob@example.com"
            autoComplete="username"
          />
        </Form.Item>

        <Form.Item
          label="Password"
          name="password"
          rules={[{ required: true, message: 'Please enter your password' }]}
        >
          <Input.Password
            placeholder="Your password"
            autoComplete="current-password"
          />
        </Form.Item>

        <Space
          direction="vertical"
          style={{ width: '100%' }}
          size="middle"
        >
          <Button
            type="primary"
            htmlType="submit"
            loading={loading}
            block
          >
            Login
          </Button>

          <Space
            style={{ width: '100%', justifyContent: 'space-between' }}
          >
            <Button type="link" href="/register">
              Register
            </Button>
            <Button type="link" href="/forgot">
              Forgot password?
            </Button>
          </Space>
        </Space>
      </Form>

      <Divider>or continue with</Divider>

      {/* === Social Login Buttons === */}
      <Space
        direction="vertical"
        style={{ width: '100%' }}
        size="middle"
      >
        {/* Google */}
        {/* <Button
          icon={<GoogleOutlined />}
          block
          disabled={loadingSocial}
          style={{ display: 'flex', alignItems: 'center' }}
        >
          <span style={{ flex: 1 }}>
            <GoogleLogin
              onSuccess={onGoogleSuccess}
              onError={onGoogleError}
              useOneTap={false}
            />
          </span>
        </Button> */}
        <GoogleLogin
              onSuccess={onGoogleSuccess}
              onError={onGoogleError}
              useOneTap={false}
            />

        {/* Facebook 
        <FacebookLogin
          appId={FACEBOOK_APP_ID}
          onSuccess={handleFacebookSuccess}
          onFail={handleFacebookFail}
          onProfileSuccess={(response) => {
            // optional: ดูข้อมูล profile ถ้าต้องใช้
            console.log('FB profile', response);

            
          //   {
          //     "name": "SK Sim",
          //     "email": "android.xxx@gmail.com",
          //     "picture": {
          //         "data": {
          //             "height": 51,
          //             "is_silhouette": false,
          //             "url": "https://platform-lookaside.fbsbx.com/platform/profilepic/?asid=24884805111197908&height=50&width=50&ext=1769096367&hash=AT-YFyb3yDncrqKID2r7VmDJ",
          //             "width": 50
          //         }
          //     },
          //     "id": "xxxx"
          // }
            
          }}
          render={({ onClick }) => (
            <Button
              icon={<FacebookFilled />}
              block
              onClick={onClick}
              disabled={loadingSocial}
              style={{ backgroundColor: '#1877F2', color: '#fff' }}
            >
              Continue with Facebook
            </Button>
          )}
        />
        */}
      </Space>

      <Divider />

      <Typography.Paragraph type="secondary" style={{ marginBottom: 0 }}>
        Tip: บน server แนะนำให้เซ็ต <code>httpOnly cookie</code>{' '}
        จาก token เพื่อความปลอดภัย และอ่านจาก cookie ฝั่ง API/SSR แทนการเก็บใน
        <code> localStorage</code>.
      </Typography.Paragraph>
    </Card>
    <style
      dangerouslySetInnerHTML={{
        __html: `
          .auth-card .ant-card-head {
            flex-wrap: wrap;
            row-gap: 8px;
          }

          .auth-card .ant-card-extra {
            margin-left: auto;
          }

          @media (max-width: 480px) {
            .auth-card .ant-card-extra {
              width: 100%;
              margin-left: 0;
            }

            .auth-card-actions {
              width: 100%;
              display: flex;
              justify-content: space-between;
            }
          }
        `,
      }}
    />
    </>
  );
}
