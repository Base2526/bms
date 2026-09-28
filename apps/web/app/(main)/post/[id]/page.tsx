'use client';
import { useParams, useRouter } from 'next/navigation';
import PostView from '@/components/post/PostView';
import { gql, useQuery, useMutation } from "@apollo/client";
import { message, Result, Button } from 'antd';

const Q_POST = gql`
  query($id: ID!) {
    post(id: $id) {
      detail
      transfer_amount
      transfer_date
      updated_at
      website
      is_bookmarked
      tel_numbers {
        id
        tel
      }
      status
      seller_accounts {
        bank_id
        bank_name
        id
        seller_account
      }
      province_name
      province_id
      title
      images {
        id
        url
      }
      id_card
      id
      first_last_name
      created_at
      author {
        avatar
        created_at
        email
        id
        name
        phone
        role
      }

      fb_permalink_url
      fb_published_at
      fb_status
      fb_social_post_id
    }
  }
`;

const DELETE_POST = gql`
  mutation ($id: ID!) {
    deletePost(id: $id)
  }
`;

const CLONE_POST = gql`
  mutation ($id: ID!) {
    clonePost(id: $id)
  }
`;

export default function Page() {
  const { id } = useParams<{ id: string }>()!;
  const router = useRouter();

  const { data, loading, error, refetch } = useQuery(Q_POST, {
    variables: { id },
  });

  const [deletePost, { loading: deleting }] = useMutation(DELETE_POST);
  const [clonePost, { loading: cloning }] = useMutation(CLONE_POST);

  const handleDelete = async (id: string) => {
    try {
      const { data: res } = await deletePost({ variables: { id } });
      if (res?.deletePost) {
        message.success("Deleted successfully");
        router.push('/admin/posts');
      } else {
        message.warning("Delete failed");
      }
    } catch (err: any) {
      message.error(err?.message || "Delete error");
    }
  };

  const handleClone = async (id: string) => {
    try {
      console.log("[handleClone]", id);
      const { data: res } = await clonePost({ variables: { id } });

      const newId = res?.clonePost;
      if (newId) {
        message.success("Cloned successfully");
        router.push(`/post/${newId}`);
      } else {
        message.warning("Clone failed");
      }
    } catch (err: any) {
      message.error(err?.message || "Clone error");
    }
  };

  // ❌ Error state – แสดง Result สวย ๆ
  if (error) {
    return (
      <Result
        status="error"
        title="โหลดข้อมูลโพสต์ไม่สำเร็จ"
        subTitle={String(error.message || "Unknown error")}
        extra={[
          <Button key="retry" onClick={() => refetch()}>
            ลองใหม่อีกครั้ง
          </Button>,
          <Button key="back" type="primary" onClick={() => router.push('/admin/posts')}>
            กลับหน้ารายการ
          </Button>,
        ]}
      />
    );
  }

  const post = data?.post ?? null;

  console.log("[POST] = ", post);

  // ❗ ตรงนี้คือ key: ให้ PostView handle loading/skeleton
  return (
    <PostView
      post={post}
      loading={loading}
      onDelete={handleDelete}
      deleting={deleting}
      onClone={handleClone}
      cloning={cloning}
      title={post?.title || "รายละเอียดโพสต์"}
    />
  );
}
