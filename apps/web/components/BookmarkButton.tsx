"use client";

import { useUiText } from "@/lib/useUiText";

import { useState, useEffect } from 'react';
import { useMutation, gql } from '@apollo/client';
import { Tooltip, Button, message } from 'antd';
import { BookOutlined, BookFilled } from '@ant-design/icons';

const M_TOGGLE_BOOKMARK = gql`
  mutation ToggleBookmark($postId: ID!) {
    toggleBookmark(postId: $postId) {
      status
      isBookmarked
    }
  }
`;

interface BookmarkButtonProps {
  postId: string;
  defaultBookmarked?: boolean; // ค่าเริ่มต้นจาก server
}

export default function BookmarkButton({ postId, defaultBookmarked = false }: BookmarkButtonProps) {
  const uiText = useUiText();
  const [isBookmarked, setIsBookmarked] = useState(defaultBookmarked);
  const [toggleBookmark, { loading }] = useMutation(M_TOGGLE_BOOKMARK, {
    onCompleted: (res) => {
      const ok = !!res?.toggleBookmark?.isBookmarked;
      setIsBookmarked(ok);
      message.success(ok ? uiText("admin_ui.en_added_to_bookmarks_71f33") : uiText("admin_ui.en_removed_from_bookmarks_435ef"));
    },
    update: (cache, { data }) => {
      const ok = data?.toggleBookmark?.isBookmarked;
      if (typeof ok !== 'boolean') return;

      const cacheId = cache.identify({ __typename: 'Post', id: postId });
      if (!cacheId) return;

      cache.modify({
        id: cacheId,
        fields: {
          is_bookmarked() {
            return ok;
          },
        },
      });
    },
    onError: (err) => {
      console.error('Toggle bookmark failed:', err);
      message.error(uiText("admin_ui.en_please_login_first_or_try_again_3965e"));
    },
  });

  // Sync local UI state with backend truth (props update via cache/subscription)
  useEffect(() => {
    setIsBookmarked(!!defaultBookmarked);
  }, [defaultBookmarked]);

  async function handleToggle(e: React.MouseEvent) {
    e.preventDefault(); // ป้องกัน click ผ่าน <Link> ถ้าอยู่ใน card
    e.stopPropagation();
    if (loading) return;
    await toggleBookmark({ variables: { postId } });
  }

  return (
    <Tooltip title={isBookmarked ? uiText("admin_ui.en_remove_bookmark_7da72") : uiText("admin_ui.en_add_to_bookmarks_5c1a3")}>
      <Button
        type="text"
        size="small"
        icon={isBookmarked ? <BookFilled /> : <BookOutlined />}
        loading={loading}
        onClick={handleToggle}
      />
    </Tooltip>
  );
}
