// apps/web/app/(admin)/admin/posts/new/page.tsx
"use client";

import { useUiText } from "@/lib/useUiText";
import { useRouter } from 'next/navigation';
import PostForm from '@/components/post/PostForm';

export default function Page(){
  const uiText = useUiText();
  const router = useRouter();
  return (
    <PostForm
      apiBase="/admin"
      initialData={null}
      onSaved={(id)=> router.push(`/admin/post/${id}`)}
      title={uiText("admin_ui.en_new_post_admin_79f2b")}
    />
  );
}
