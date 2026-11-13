// apps/web/app/(admin)/admin/posts/[id]/edit/page.tsx
"use client";

import { useUiText } from "@/lib/useUiText";
import React, { useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import PostForm, { PostRecord } from '@/components/post/PostForm';

import { gql, useQuery } from "@apollo/client";

const Q_POST = gql`
  query($id:ID!){
    post(id:$id){
      detail
      transfer_amount
      transfer_date
      updated_at
      website
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
    }
  }
`;

export default function Page(){
  const uiText = useUiText();
  const { id } = useParams<{id:string}>()!;
  const router = useRouter();

  const { data, loading, error } = useQuery(Q_POST, { variables: { id } });

  if (loading) return <div>{uiText("admin_ui.en_loading_b04ba")}</div>;
  if (error)   return <div>{uiText("admin_ui.en_error_787aa")} {String(error.message)}</div>;

  const post = data?.post;
  if (!post) return <div>{uiText("admin_ui.en_not_found_475c8")}</div>

  return (
    <PostForm
      apiBase="/admin"
      initialData={post!}
      onSaved={()=> router.refresh()}
      title={uiText("admin_ui.en_edit_post_admin_51157")}
    />
  );
}
