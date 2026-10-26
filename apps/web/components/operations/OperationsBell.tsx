"use client";
import { gql, useQuery } from "@apollo/client";
import { useState } from "react";
import {
  Alert,
  Badge,
  Button,
  Drawer,
  List,
  Pagination,
  Space,
  Spin,
} from "antd";
import { BellOutlined } from "@ant-design/icons";
import { useBmsPermissions } from "@/app/hooks/useBmsPermissions";
import { useI18n } from "@/lib/i18nContext";
import { useTeamCommand } from "./useTeamCommand";
const INBOX = gql`
  query OperationInbox($offset: Int) {
    bmsOperationInbox(offset: $offset) {
      total
      unread
      items {
        id
        entityId
        entityKind
        kind
        source
        createdAt
        readAt
      }
    }
  }
`;
export default function OperationsBell() {
  const { can } = useBmsPermissions(),
    { t, lang } = useI18n(),
    tr = (k: string) => t(`operation_team.${k}`),
    [open, setOpen] = useState(false),
    [page, setPage] = useState(1);
  const q = useQuery(INBOX, {
      variables: { offset: (page - 1) * 25 },
      skip: !can("operations.checklist.view"),
      fetchPolicy: "network-only",
      pollInterval: 30000,
    }),
    w = q.data?.bmsOperationInbox,
    m = useTeamCommand(() => q.refetch());
  if (!can("operations.checklist.view")) return null;
  return (
    <div style={{ marginBottom: 12 }}>
      <Badge count={w?.unread ?? 0}>
        <Button
          aria-label={tr("notifications")}
          icon={<BellOutlined />}
          onClick={() => setOpen(true)}
        >
          {tr("notifications")}
        </Button>
      </Badge>
      <Drawer
        title={tr("notifications")}
        open={open}
        onClose={() => setOpen(false)}
        width="min(520px, 100vw)"
      >
        {q.error ? (
          <Alert
            closable
            type="error"
            message={tr("failed")}
            action={<Button onClick={() => q.refetch()}>{tr("reload")}</Button>}
          />
        ) : q.loading && !w ? (
          <Spin />
        ) : (
          <>
            <List
              locale={{ emptyText: tr("empty") }}
              dataSource={w?.items ?? []}
              renderItem={(n: any) => (
                <List.Item>
                  <Space direction="vertical">
                    <span>{tr(n.kind)}</span>
                    <small>
                      {new Date(n.createdAt).toLocaleString(
                        lang === "th" ? "th-TH" : "en-GB",
                      )}
                    </small>
                    <Space wrap>
                      <Button
                        href={`/admin/operations?${n.entityKind === "QUALITY" ? "quality" : n.entityKind === "RUN" ? "run" : n.entityKind === "HANDOVER" ? "handover" : "roster"}=${encodeURIComponent(n.entityId)}`}
                        onClick={() => setOpen(false)}
                      >
                        {tr("open")}
                      </Button>
                      {!n.readAt && (
                        <Button
                          loading={m.busy}
                          onClick={() =>
                            m.command({
                              action: "READ_NOTICE",
                              id: n.id,
                              source: n.source,
                            })
                          }
                        >
                          {tr("read")}
                        </Button>
                      )}
                    </Space>
                  </Space>
                </List.Item>
              )}
            />
            <Pagination
              simple
              current={page}
              pageSize={25}
              total={w?.total ?? 0}
              onChange={setPage}
            />
          </>
        )}
      </Drawer>
      {m.retry}
    </div>
  );
}
