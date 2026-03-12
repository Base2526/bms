'use client';

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
  const [isBookmarked, setIsBookmarked] = useState(defaultBookmarked);
  const [toggleBookmark, { loading }] = useMutation(M_TOGGLE_BOOKMARK, {
    onCompleted: (res) => {
      const ok = res?.toggleBookmark?.isBookmarked;
      setIsBookmarked(ok);
      message.success(ok ? 'Added to bookmarks' : 'Removed from bookmarks');
    },
    onError: (err) => {
      console.error('Toggle bookmark failed:', err);
      message.error('Please login first or try again.');
    },
  });

  // Sync local UI state with backend truth (props update via cache/subscription)
  useEffect(() => {
    if (loading) return;
    setIsBookmarked(!!defaultBookmarked);
  }, [defaultBookmarked, loading]);

  async function handleToggle(e: React.MouseEvent) {
    e.preventDefault(); // ป้องกัน click ผ่าน <Link> ถ้าอยู่ใน card
    if (loading) return;
    await toggleBookmark({ variables: { postId } });
  }

  return (
    <Tooltip title={isBookmarked ? 'Remove bookmark' : 'Add to bookmarks'}>
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
