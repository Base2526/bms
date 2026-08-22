'use client';

import { useEffect, useState } from 'react';
import { gql, useQuery, useMutation, useSubscription } from '@apollo/client';
import { Avatar, Button, Input, Space, Spin, Typography, Popconfirm, message } from 'antd';
import Link from 'next/link';
import { UpOutlined, DownOutlined } from '@ant-design/icons';

import { insertCommentIntoTree, formatTimeAgo } from "./Helper"

const { Text } = Typography;

const Q_COMMENTS = gql`
  query Comments($post_id: ID!) {
    comments(post_id: $post_id) {
      id
      post_id
      user_id
      parent_id
      content
      created_at
      user { id name avatar }
      replies {
        id
        post_id
        user_id
        parent_id
        content
        created_at
        user { id name avatar }
      }
    }
  }
`;

const MUT_ADD = gql`
  mutation AddComment($post_id: ID!, $content: String!) {
    addComment(post_id: $post_id, content: $content) {
      id
      post_id
      user_id
      parent_id
      content
      created_at
      user { id name avatar }
      replies { id }
    }
  }
`;

const MUT_REPLY = gql`
  mutation ReplyComment($comment_id: ID!, $content: String!) {
    replyComment(comment_id: $comment_id, content: $content) {
      id
      post_id
      user_id
      parent_id
      content
      created_at
      user { id name avatar }
    }
  }
`;

const MUT_UPDATE = gql`
  mutation UpdateComment($id: ID!, $content: String!) {
    updateComment(id: $id, content: $content) {
      id
      content
      updated_at
    }
  }
`;

const MUT_DELETE = gql`
  mutation DeleteComment($id: ID!) {
    deleteComment(id: $id)
  }
`;

const SUB_ADDED = gql`
  subscription CommentAdded($post_id: ID!) {
    commentAdded(post_id: $post_id) {
      id
      post_id
      user_id
      parent_id
      content
      created_at
      user { id name avatar }
    }
  }
`;

// ===================== CommentItem (รองรับ 2 level) =====================
function renderCommentContent(content: string) {
  const match = content.match(/^@\[(.+?):(.+?)\]\s*(.*)$/);
  if (!match) {
    return <div style={{ whiteSpace: 'pre-wrap' }}>{content}</div>;
  }
  const [, userId, displayName, rest] = match;

  return (
    <div style={{ whiteSpace: 'pre-wrap' }}>
      <Link href={`/profile/${encodeURIComponent(userId)}`}>
        <Text strong style={{color: 'blue'}}>@{displayName}</Text>
      </Link>{' '}
      {rest}
    </div>
  );
}

function CommentItem({
  comment,
  currentUserId,
  onReply,
  onUpdate,
  onDelete,
  rootId,
  level = 1,
}: any) {
  const [replying, setReplying] = useState(false);
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState(comment.content);
  const [replyText, setReplyText] = useState('');

  const [showReplies, setShowReplies] = useState(false);

  const isLoggedIn = !!currentUserId;
  const canEdit = isLoggedIn && currentUserId === comment.user_id;

  const rootCommentId = rootId ?? comment.id;
  const replyCount = comment.replies?.length ?? 0;

  const user = comment.user;
  const userId = user?.id;
  const userName = user?.name || "";
  const userInitial = userName?.[0] || "?";
  const profileHref = userId
    ? `/profile/${encodeURIComponent(userId)}`
    : undefined;

  return (
    <div style={{ marginBottom: 12 }}>
      <Space align="start">
        {/* ✅ Avatar + ตัวอักษรแรก คลิกไปหน้าโปรไฟล์ */}
        {profileHref ? (
          <Link
            href={profileHref}
            style={{ display: 'inline-block' }}
          >
            <Avatar src={user?.avatar}>
              {userInitial}
            </Avatar>
          </Link>
        ) : (
          <Avatar src={user?.avatar}>
            {userInitial}
          </Avatar>
        )}

        <div style={{ width: '100%' }}>
          {/* ชื่อ + เวลา */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            {profileHref ? (
              <Link href={profileHref}>
                <span style={{ fontWeight: 600 }}>
                  {userName}
                </span>
              </Link>
            ) : (
              <span style={{ fontWeight: 600 }}>
                {userName}
              </span>
            )}

            <Text type="secondary" style={{ fontSize: 12 }}>
              {formatTimeAgo(comment.created_at)}
            </Text>
          </div>

          {/* เนื้อหาคอมเมนต์ (รองรับ mention) */}
          {!editing ? (
            renderCommentContent(comment.content)
          ) : (
            <div>
              <Input.TextArea
                rows={2}
                value={text}
                onChange={(e) => setText(e.target.value)}
              />
              <Space style={{ marginTop: 4 }}>
                <Button
                  size="small"
                  type="primary"
                  onClick={() => {
                    onUpdate(comment.id, text);
                    setEditing(false);
                  }}
                >
                  Save
                </Button>
                <Button size="small" onClick={() => setEditing(false)}>
                  Cancel
                </Button>
              </Space>
            </div>
          )}

          {/* action buttons */}
          {isLoggedIn && (
            <Space size="small" style={{ marginTop: 4 }}>
              <Button
                size="small"
                type="text"
                onClick={() => setReplying(!replying)}
              >
                Reply
              </Button>
              {canEdit && !editing && (
                <>
                  <Button
                    size="small"
                    type="text"
                    onClick={() => setEditing(true)}
                  >
                    Edit
                  </Button>
                  <Popconfirm
                    title="Delete this comment?"
                    onConfirm={() => onDelete(comment.id)}
                  >
                    <Button size="small" type="text" danger>
                      Delete
                    </Button>
                  </Popconfirm>
                </>
              )}
            </Space>
          )}

          {/* reply box */}
          {isLoggedIn && replying && (
            <div style={{ marginTop: 8 }}>
              <Input.TextArea
                rows={2}
                value={replyText}
                onChange={(e) => setReplyText(e.target.value)}
              />
              <Button
                size="small"
                type="primary"
                style={{ marginTop: 4 }}
                onClick={() => {
                  onReply(rootCommentId, replyText, comment.user);
                  setReplyText('');
                  setReplying(false);
                }}
              >
                Reply
              </Button>
            </div>
          )}

          {/* ปุ่ม show/hide replies (level 1 เท่านั้น) */}
          {level === 1 && replyCount > 0 && (
            <div style={{ marginTop: 8 }}>
              <Button
                type="text"
                size="small"
                onClick={() => setShowReplies(!showReplies)}
                icon={showReplies ? <UpOutlined /> : <DownOutlined />}
                style={{ paddingLeft: 0 }}
              >
                {showReplies ? 'Hide replies' : `${replyCount} replies`}
              </Button>
            </div>
          )}

          {/* replies level 2 */}
          {level === 1 && replyCount > 0 && showReplies && (
            <div
              style={{
                marginTop: 4,
                paddingLeft: 24,
                borderLeft: '1px solid #333',
              }}
            >
              {comment.replies.map((r: any) => (
                <div key={r.id} style={{ marginTop: 8 }}>
                  <CommentItem
                    comment={r}
                    currentUserId={currentUserId}
                    onReply={onReply}
                    onUpdate={onUpdate}
                    onDelete={onDelete}
                    rootId={rootCommentId}
                    level={2}
                  />
                </div>
              ))}
            </div>
          )}
        </div>
      </Space>
    </div>
  );
}

// ===================== CommentsSection =====================

export function CommentsSection({
  postId,
  currentUserId,
}: {
  postId: string;
  currentUserId?: string | number;
}) {
  const [newText, setNewText] = useState('');

  const { data, loading, error, refetch } = useQuery(Q_COMMENTS, {
    variables: { post_id: postId },
  });

  const [addComment] = useMutation(MUT_ADD);
  const [replyComment] = useMutation(MUT_REPLY);
  const [updateComment] = useMutation(MUT_UPDATE);
  const [deleteComment] = useMutation(MUT_DELETE);

  const isLoggedIn = !!currentUserId;

  // useEffect(() => {
  //   console.log('[CommentsSection] = ', data);
  // }, [data]);

  useSubscription(SUB_ADDED, {
    variables: { post_id: postId },
    onData: ({ data: subData, client }) => {
      const newComment = subData.data?.commentAdded;
      if (!newComment) return;

      console.log('[SUB_ADDED] = ', newComment);

      client.cache.updateQuery(
        {
          query: Q_COMMENTS,
          variables: { post_id: postId },
        },
        (prev: any) => {
          if (!prev) return prev;
          const prevComments = prev.comments ?? [];

          const nextComments = insertCommentIntoTree(prevComments, newComment);

          return {
            ...prev,
            comments: nextComments,
          };
        }
      );
    },
  });

  const comments = data?.comments ?? [];

  const handleAdd = async () => {
    if (!isLoggedIn) {
      message.error('กรุณาเข้าสู่ระบบก่อนแสดงความคิดเห็น');
      return;
    }
    if (!newText.trim()) return;
    try {
      await addComment({
        variables: { post_id: postId, content: newText },
      });
      setNewText('');
      refetch();
    } catch (e: any) {
      console.error(e);
      message.error('Add comment failed');
    }
  };

    // 👇 ปรับให้รองรับ tag + บังคับอยู่ level 2
    const handleReply = async (
        rootCommentId: string,
        content: string,
        tagUser?: { id: string; name: string }
        ) => {
        if (!isLoggedIn) {
            message.error('กรุณาเข้าสู่ระบบก่อนตอบคอมเมนต์');
            return;
        }
        if (!content.trim()) return;

        // เก็บ mention เป็น prefix แบบมี userId
        // รูปแบบ: @[userId:Display Name] ข้อความจริง...
        const finalContent = tagUser
            ? `@[${tagUser.id}:${tagUser.name}] ${content}`
            : content;

        try {
            await replyComment({
            variables: { comment_id: rootCommentId, content: finalContent },
            });
            refetch();
        } catch (e: any) {
            console.error(e);
            message.error('Reply failed');
        }
    };

  const handleUpdate = async (id: string, content: string) => {
    if (!isLoggedIn) {
      message.error('กรุณาเข้าสู่ระบบก่อนแก้ไขคอมเมนต์');
      return;
    }
    if (!content.trim()) return;
    try {
      await updateComment({ variables: { id, content } });
      refetch();
    } catch (e: any) {
      console.error(e);
      message.error('Update failed');
    }
  };

  const handleDelete = async (id: string) => {
    if (!isLoggedIn) {
      message.error('กรุณาเข้าสู่ระบบก่อนลบคอมเมนต์');
      return;
    }
    try {
      await deleteComment({ variables: { id } });
      refetch();
    } catch (e: any) {
      console.error(e);
      message.error('Delete failed');
    }
  };

  if (loading) return <Spin />;
  if (error) return <Text type="danger">Failed to load comments</Text>;

  return (
    <div>
      {/* กล่องเขียนคอมเมนต์ */}
      <div style={{ marginBottom: 16 }}>
        {isLoggedIn ? (
          <>
            <Input.TextArea
              rows={3}
              value={newText}
              placeholder="Write a comment..."
              onChange={(e) => setNewText(e.target.value)}
            />
            <Button
              type="primary"
              style={{ marginTop: 6 }}
              onClick={handleAdd}
              disabled={!newText.trim()}
            >
              Comment
            </Button>
          </>
        ) : (
          <Text type="secondary">
            กรุณา <Link href="/admin/login">เข้าสู่ระบบ</Link> เพื่อแสดงความคิดเห็น
          </Text>
        )}
      </div>

      {/* list comments */}
      <div>
        {comments.length === 0 ? (
          <Text type="secondary">No comments yet.</Text>
        ) : (
          comments.map((c: any) => (
            <CommentItem
              key={c.id}
              comment={c}
              currentUserId={currentUserId}
              onReply={handleReply}
              onUpdate={handleUpdate}
              onDelete={handleDelete}
              rootId={c.id}   // parent ของ thread นี้
              level={1}
            />
          ))
        )}
      </div>
    </div>
  );
}
