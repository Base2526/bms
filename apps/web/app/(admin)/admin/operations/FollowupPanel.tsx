"use client";
import { gql, useMutation, useQuery } from "@apollo/client";
import { useRef, useState } from "react";
import {
  Alert,
  Badge,
  Button,
  Form,
  Input,
  InputNumber,
  Modal,
  Select,
  Space,
  Switch,
  Table,
  Tabs,
  Tag,
  Typography,
  message,
} from "antd";
import { useI18n } from "@/lib/i18nContext";
import styles from "./operations.module.css";

const WORK = gql`
  query ChecklistMyWork($filter: BmsChecklistFollowupFilter) {
    bmsChecklistMyWork(filter: $filter) {
      total
      overdue
      items {
        id
        runId
        kind
        name
        locationId
        status
        dueAt
        version
        overdue
      }
    }
  }
`;
const INBOX = gql`
  query ChecklistInbox($filter: BmsChecklistFollowupFilter) {
    bmsChecklistInbox(filter: $filter) {
      total
      unread
      items {
        id
        runId
        kind
        name
        runStatus
        createdAt
        readAt
      }
    }
  }
`;
const SUPERVISION = gql`
  query ChecklistSupervision($filter: BmsChecklistFollowupFilter) {
    bmsChecklistSupervision(filter: $filter) {
      total
      policies {
        locationId
        name
        supervisorId
        reminderMinutes
        escalationMinutes
        enabled
        version
      }
      supervisors {
        id
        name
      }
      escalations {
        id
        runId
        locationId
        name
        recipient
        reason
        source
        status
        version
        createdAt
        acknowledgedAt
      }
    }
  }
`;
const REPORT = gql`
  query ChecklistInspectionReport($filter: BmsChecklistReportFilter!) {
    bmsChecklistInspectionReport(filter: $filter) {
      from
      to
      timezone
      generatedAt
      problemsTruncated
      branches {
        locationId
        name
        total
        voided
        approved
        onTime
        overdue
        review
        failedRuns
        openActions
      }
      problems {
        locationId
        branch
        familyId
        itemKey
        name
        runs
        lastDue
      }
    }
  }
`;
const MUTATION = gql`
  mutation ChecklistFollowup($input: BmsChecklistFollowupInput!) {
    bmsChecklistFollowup(input: $input) {
      status
      id
      version
    }
  }
`;
function useFollowupMutation(refresh: () => Promise<unknown>) {
  const { t } = useI18n(),
    tr = (k: string) => t(`operation_checklists.${k}`);
  const [mutate] = useMutation(MUTATION),
    [busy, setBusy] = useState(false),
    [uncertain, setUncertain] = useState(false),
    pending = useRef<any>(null);
  async function command(input?: any) {
    if (busy || (!input && !pending.current) || (input && pending.current))
      return false;
    if (input)
      pending.current = { ...input, idempotencyKey: crypto.randomUUID() };
    setBusy(true);
    try {
      const response = await mutate({ variables: { input: pending.current } }),
        result = response.data?.bmsChecklistFollowup;
      if (!result) throw new Error("Missing outcome");
      pending.current = null;
      setUncertain(false);
      if (result.status !== "OK") {
        const text = tr(result.status);
        message.error(
          text === `operation_checklists.${result.status}`
            ? `${tr("failed")} (${result.status})`
            : text,
        );
        return false;
      }
      message.success(tr("saved"));
      await refresh().catch(() => message.warning(tr("failed")));
      return true;
    } catch (error: any) {
      // These failures are rejected before execution; transport/internal failures remain unknown.
      const rejected =
        !error.networkError &&
        error.graphQLErrors?.length > 0 &&
        error.graphQLErrors.every((e: any) =>
          [
            "FORBIDDEN",
            "UNAUTHENTICATED",
            "GRAPHQL_VALIDATION_FAILED",
            "BAD_USER_INPUT",
          ].includes(e.extensions?.code),
        );
      if (rejected) {
        pending.current = null;
        setUncertain(false);
        message.error(tr("denied"));
      } else setUncertain(true);
      return false;
    } finally {
      setBusy(false);
    }
  }
  return {
    command,
    busy,
    uncertain,
    retry: (
      <Modal
        open={uncertain}
        zIndex={4000}
        title={tr("uncertain")}
        closable={false}
        maskClosable={false}
        keyboard={false}
        footer={
          <Button loading={busy} onClick={() => command()}>
            {tr("retry")}
          </Button>
        }
      >
        <p>{tr("followup_retry")}</p>
      </Modal>
    ),
  };
}
export function ChecklistEscalateButton({
  run,
  onDone,
}: {
  run: any;
  onDone: () => Promise<unknown>;
}) {
  const { t } = useI18n(),
    tr = (k: string) => t(`operation_checklists.${k}`),
    [open, setOpen] = useState(false),
    [note, setNote] = useState("");
  const mutation = useFollowupMutation(async () => {
    setOpen(false);
    setNote("");
    await onDone();
  });
  return (
    <>
      <Button onClick={() => setOpen(true)}>{tr("escalate")}</Button>
      <Modal
        title={tr("escalate")}
        open={open}
        onCancel={() => !mutation.busy && setOpen(false)}
        confirmLoading={mutation.busy}
        okText={tr("confirm")}
        cancelText={tr("cancel")}
        onOk={async () => {
          if (note.trim())
            await mutation.command({
              action: "ESCALATE",
              id: run.id,
              version: run.version,
              note,
              confirmed: true,
            });
        }}
        okButtonProps={{ disabled: !note.trim() || mutation.uncertain }}
      >
        <p>
          {run.snapshot.name} · v{run.version}
        </p>
        <p>{tr("escalation_hint")}</p>
        <Input.TextArea
          aria-label={tr("reason")}
          placeholder={tr("reason")}
          value={note}
          maxLength={2000}
          onChange={(e) => setNote(e.target.value)}
        />
      </Modal>
      {mutation.retry}
    </>
  );
}
export default function FollowupPanel({
  locationId,
  locations,
  actorId,
  execute,
  manage,
  review,
  onOpenRun,
}: {
  locationId?: string;
  locations: any[];
  actorId: string;
  execute: boolean;
  manage: boolean;
  review: boolean;
  onOpenRun: (id: string) => void;
}) {
  const { t, lang } = useI18n(),
    tr = (k: string) => t(`operation_checklists.${k}`);
  const [bucket, setBucket] = useState(execute ? "MINE" : "REVIEW"),
    [workPage, setWorkPage] = useState(1),
    [noticePage, setNoticePage] = useState(1),
    [escalationPage, setEscalationPage] = useState(1),
    [unreadOnly, setUnreadOnly] = useState(false);
  const [tab, setTab] = useState(execute || review ? "work" : "inbox"),
    [dialog, setDialog] = useState<any>(null),
    [form] = Form.useForm();
  const today = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Bangkok",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
  const [dates, setDates] = useState({ from: today, to: today }),
    [reportDates, setReportDates] = useState(dates);
  const work = useQuery(WORK, {
    variables: { filter: { locationId, bucket, offset: (workPage - 1) * 25 } },
    skip: !execute && !review,
    fetchPolicy: "network-only",
    pollInterval: 30000,
  });
  const inbox = useQuery(INBOX, {
    variables: {
      filter: { locationId, unreadOnly, offset: (noticePage - 1) * 25 },
    },
    fetchPolicy: "network-only",
    pollInterval: 30000,
  });
  const supervision = useQuery(SUPERVISION, {
    variables: { filter: { locationId, offset: (escalationPage - 1) * 25 } },
    skip: !manage && !review,
    fetchPolicy: "network-only",
    pollInterval: 30000,
  });
  const report = useQuery(REPORT, {
    variables: { filter: { locationId, ...reportDates } },
    skip: !review || tab !== "report",
    fetchPolicy: "network-only",
  });
  async function refresh() {
    await Promise.all([
      inbox.refetch(),
      ...(execute || review ? [work.refetch()] : []),
      ...(manage || review ? [supervision.refetch()] : []),
      ...(review && tab === "report" ? [report.refetch()] : []),
    ]);
  }
  const mutation = useFollowupMutation(async () => {
    setDialog(null);
    await refresh();
  });
  const w = work.data?.bmsChecklistMyWork,
    n = inbox.data?.bmsChecklistInbox,
    s = supervision.data?.bmsChecklistSupervision,
    r = report.data?.bmsChecklistInspectionReport;
  const format = (v: string) =>
    new Date(v).toLocaleString(lang === "th" ? "th-TH" : "en-GB");
  const open = (row: any) => (
    <Button onClick={() => onOpenRun(row.runId)}>{tr("view")}</Button>
  );
  function policyDialog(p?: any) {
    form.resetFields();
    form.setFieldsValue(
      p
        ? { ...p }
        : {
            locationId,
            reminderMinutes: 30,
            escalationMinutes: 60,
            enabled: false,
          },
    );
    setDialog({
      action: "SAVE_POLICY",
      version: p?.version ?? 0,
      locationId: p?.locationId,
    });
  }
  const errors = [
    inbox.error,
    work.error,
    supervision.error,
    report.error,
  ].filter(Boolean);
  return (
    <>
      <Alert
        closable
        type="info"
        showIcon
        message={tr("followup_hint")}
        className={styles.item}
      />
      {!!errors.length && (
        <Alert
          closable
          type="error"
          message={tr("failed")}
          action={
            <Button
              onClick={() => refresh().catch(() => message.error(tr("failed")))}
            >
              {tr("refresh")}
            </Button>
          }
        />
      )}
      <Tabs
        activeKey={tab}
        onChange={setTab}
        items={[
          ...(execute || review
            ? [
                {
                  key: "work",
                  label: tr("my_work"),
                  children: (
                    <>
                      <Space wrap className={styles.toolbar}>
                        <Select
                          aria-label={tr("work_queue")}
                          value={bucket}
                          onChange={(v) => {
                            setBucket(v);
                            setWorkPage(1);
                          }}
                          options={[
                            ...(execute ? ["MINE", "UNASSIGNED"] : []),
                            ...(review ? ["REVIEW"] : []),
                          ].map((v) => ({ value: v, label: tr(`work_${v}`) }))}
                        />
                        <span>
                          {tr("total")}: {w?.total ?? "—"} · {tr("overdue")}:{" "}
                          {w?.overdue ?? "—"}
                        </span>
                      </Space>
                      <Table
                        rowKey={(row) => `${row.kind}:${row.id}`}
                        loading={work.loading}
                        dataSource={w?.items ?? []}
                        scroll={{ x: 750 }}
                        pagination={{
                          current: workPage,
                          pageSize: 25,
                          total: w?.total ?? 0,
                          showSizeChanger: false,
                          onChange: setWorkPage,
                        }}
                        columns={[
                          { title: tr("name"), dataIndex: "name" },
                          {
                            title: tr("type"),
                            render: (_: any, row: any) =>
                              tr(`work_${row.kind}`),
                          },
                          {
                            title: tr("status"),
                            render: (_: any, row: any) => (
                              <Tag color={row.overdue ? "red" : undefined}>
                                {tr(row.status)}
                              </Tag>
                            ),
                          },
                          {
                            title: tr("due"),
                            render: (_: any, row: any) => format(row.dueAt),
                          },
                          {
                            title: tr("view"),
                            render: (_: any, row: any) => open(row),
                          },
                        ]}
                      />
                    </>
                  ),
                },
              ]
            : []),
          {
            key: "inbox",
            label: (
              <span>
                {tr("notices")}{" "}
                <span aria-hidden="true">
                  <Badge count={n?.unread ?? 0} />
                </span>
              </span>
            ),
            children: (
              <>
                <Space className={styles.toolbar}>
                  <Switch
                    aria-label={tr("unread_only")}
                    checked={unreadOnly}
                    onChange={(v) => {
                      setUnreadOnly(v);
                      setNoticePage(1);
                    }}
                  />
                  {tr("unread_only")}
                </Space>
                <Table
                  rowKey="id"
                  loading={inbox.loading}
                  dataSource={n?.items ?? []}
                  scroll={{ x: 750 }}
                  pagination={{
                    current: noticePage,
                    pageSize: 25,
                    total: n?.total ?? 0,
                    showSizeChanger: false,
                    onChange: setNoticePage,
                  }}
                  columns={[
                    { title: tr("name"), dataIndex: "name" },
                    {
                      title: tr("type"),
                      render: (_: any, row: any) => tr(`notice_${row.kind}`),
                    },
                    {
                      title: tr("status"),
                      render: (_: any, row: any) => tr(row.runStatus),
                    },
                    {
                      title: tr("created"),
                      render: (_: any, row: any) => format(row.createdAt),
                    },
                    {
                      title: tr("view"),
                      render: (_: any, row: any) => (
                        <Space>
                          {open(row)}
                          {!row.readAt && (
                            <Button
                              disabled={mutation.busy || mutation.uncertain}
                              onClick={() =>
                                mutation.command({
                                  action: "READ_NOTICE",
                                  id: row.id,
                                })
                              }
                            >
                              {tr("mark_read")}
                            </Button>
                          )}
                        </Space>
                      ),
                    },
                  ]}
                />
              </>
            ),
          },
          ...(manage || review
            ? [
                {
                  key: "supervision",
                  label: tr("supervision"),
                  children: (
                    <>
                      <p>{tr("escalation_hint")}</p>
                      {manage && (
                        <Button
                          className={styles.toolbar}
                          onClick={() => policyDialog()}
                        >
                          {tr("configure_supervisor")}
                        </Button>
                      )}
                      <Table
                        rowKey="locationId"
                        size="small"
                        dataSource={s?.policies ?? []}
                        scroll={{ x: 700 }}
                        columns={[
                          { title: tr("branch"), dataIndex: "name" },
                          {
                            title: tr("supervisor"),
                            render: (_: any, p: any) =>
                              s?.supervisors.find(
                                (u: any) => u.id === p.supervisorId,
                              )?.name ?? tr("unavailable_supervisor"),
                          },
                          {
                            title: tr("automatic"),
                            render: (_: any, p: any) =>
                              tr(p.enabled ? "enabled" : "disabled"),
                          },
                          {
                            title: tr("reminder_minutes"),
                            dataIndex: "reminderMinutes",
                          },
                          {
                            title: tr("escalation_minutes"),
                            dataIndex: "escalationMinutes",
                          },
                          ...(manage
                            ? [
                                {
                                  title: tr("edit"),
                                  render: (_: any, p: any) => (
                                    <Button onClick={() => policyDialog(p)}>
                                      {tr("edit")}
                                    </Button>
                                  ),
                                },
                              ]
                            : []),
                        ]}
                      />
                      <Typography.Title level={4}>
                        {tr("escalations")}
                      </Typography.Title>
                      <Table
                        rowKey="id"
                        loading={supervision.loading}
                        dataSource={s?.escalations ?? []}
                        scroll={{ x: 850 }}
                        pagination={{
                          current: escalationPage,
                          pageSize: 25,
                          total: s?.total ?? 0,
                          showSizeChanger: false,
                          onChange: setEscalationPage,
                        }}
                        columns={[
                          { title: tr("name"), dataIndex: "name" },
                          {
                            title: tr("reason"),
                            render: (_: any, e: any) =>
                              e.source === "OVERDUE" ? tr("overdue") : e.reason,
                          },
                          {
                            title: tr("status"),
                            render: (_: any, e: any) =>
                              tr(`escalation_${e.status}`),
                          },
                          {
                            title: tr("supervisor"),
                            render: (_: any, e: any) =>
                              s?.supervisors.find(
                                (u: any) => u.id === e.recipient,
                              )?.name ?? tr("unavailable_supervisor"),
                          },
                          {
                            title: tr("view"),
                            render: (_: any, e: any) => (
                              <Space wrap>
                                {open(e)}
                                {review &&
                                  e.status === "OPEN" &&
                                  e.recipient === actorId && (
                                    <Button
                                      onClick={() => {
                                        form.resetFields();
                                        setDialog({
                                          action: "ACKNOWLEDGE",
                                          row: e,
                                        });
                                      }}
                                    >
                                      {tr("acknowledge")}
                                    </Button>
                                  )}
                                {manage && (
                                  <Button
                                    onClick={() => {
                                      form.resetFields();
                                      setDialog({ action: "REROUTE", row: e });
                                    }}
                                  >
                                    {tr("reroute")}
                                  </Button>
                                )}
                              </Space>
                            ),
                          },
                        ]}
                      />
                    </>
                  ),
                },
              ]
            : []),
          ...(review
            ? [
                {
                  key: "report",
                  label: tr("inspection_report"),
                  children: (
                    <>
                      <p>{tr("report_hint")}</p>
                      <Space wrap className={styles.toolbar}>
                        <label>
                          {tr("from")}{" "}
                          <Input
                            type="date"
                            aria-label={tr("from")}
                            value={dates.from}
                            onChange={(e) =>
                              setDates({ ...dates, from: e.target.value })
                            }
                          />
                        </label>
                        <label>
                          {tr("to")}{" "}
                          <Input
                            type="date"
                            aria-label={tr("to")}
                            value={dates.to}
                            onChange={(e) =>
                              setDates({ ...dates, to: e.target.value })
                            }
                          />
                        </label>
                        <Button
                          onClick={() => {
                            setReportDates({ ...dates });
                            if (
                              dates.from === reportDates.from &&
                              dates.to === reportDates.to
                            )
                              report
                                .refetch()
                                .catch(() => message.error(tr("failed")));
                          }}
                        >
                          {tr("show_report")}
                        </Button>
                      </Space>
                      {r && (
                        <p>
                          {r.from} — {r.to} · {r.timezone} · {tr("as_of")}{" "}
                          {format(r.generatedAt)}
                        </p>
                      )}
                      <Table
                        rowKey="locationId"
                        loading={report.loading}
                        dataSource={r?.branches ?? []}
                        pagination={{ pageSize: 25 }}
                        scroll={{ x: 1200 }}
                        columns={[
                          { title: tr("branch"), dataIndex: "name" },
                          ...[
                            "total",
                            "voided",
                            "approved",
                            "onTime",
                            "overdue",
                            "review",
                            "failedRuns",
                            "openActions",
                          ].map((k) => ({
                            title: tr(`report_${k}`),
                            dataIndex: k,
                          })),
                          {
                            title: tr("on_time_rate"),
                            render: (_: any, b: any) =>
                              b.total - b.voided > 0
                                ? `${((b.onTime / (b.total - b.voided)) * 100).toFixed(1)}%`
                                : "—",
                          },
                        ]}
                      />
                      <Typography.Title level={4}>
                        {tr("recurring")}
                      </Typography.Title>
                      <p>{tr("recurring_hint")}</p>
                      {r?.problemsTruncated && (
                        <Alert
                          closable
                          type="warning"
                          message={tr("truncated_problems")}
                        />
                      )}
                      <Table
                        rowKey={(p) =>
                          `${p.locationId}:${p.familyId}:${p.itemKey}`
                        }
                        dataSource={r?.problems ?? []}
                        scroll={{ x: 750 }}
                        columns={[
                          { title: tr("branch"), dataIndex: "branch" },
                          { title: tr("name"), dataIndex: "name" },
                          { title: tr("item_key"), dataIndex: "itemKey" },
                          { title: tr("runs"), dataIndex: "runs" },
                          {
                            title: tr("last_due"),
                            render: (_: any, p: any) => format(p.lastDue),
                          },
                        ]}
                      />
                    </>
                  ),
                },
              ]
            : []),
        ]}
      />
      <Modal
        open={!!dialog}
        title={tr(
          dialog?.action === "SAVE_POLICY"
            ? "configure_supervisor"
            : dialog?.action === "REROUTE"
              ? "reroute"
              : "acknowledge",
        )}
        okText={tr("confirm")}
        cancelText={tr("cancel")}
        confirmLoading={mutation.busy}
        onCancel={() => !mutation.busy && setDialog(null)}
        okButtonProps={{ disabled: mutation.uncertain }}
        onOk={async () => {
          try {
            const v = await form.validateFields();
            const input =
              dialog.action === "SAVE_POLICY"
                ? {
                    ...v,
                    action: dialog.action,
                    version: dialog.version,
                    confirmed: true,
                  }
                : {
                    action: dialog.action,
                    id: dialog.row.id,
                    version: dialog.row.version,
                    note: v.note,
                    confirmed: true,
                  };
            await mutation.command(input);
          } catch {
            /* Form displays field errors. */
          }
        }}
      >
        {dialog?.row && (
          <p>
            {dialog.row.name} · v{dialog.row.version}
          </p>
        )}
        <p>
          {tr(
            dialog?.action === "SAVE_POLICY"
              ? "policy_hint"
              : "escalation_hint",
          )}
        </p>
        <Form form={form} layout="vertical">
          {dialog?.action === "SAVE_POLICY" ? (
            <>
              <Form.Item
                name="locationId"
                label={tr("branch")}
                rules={[{ required: true }]}
              >
                <Select
                  disabled={!!dialog.locationId}
                  options={locations.map((l) => ({
                    value: l.id,
                    label: l.name,
                  }))}
                />
              </Form.Item>
              <Form.Item
                name="supervisorId"
                label={tr("supervisor")}
                rules={[{ required: true }]}
              >
                <Select
                  options={(s?.supervisors ?? []).map((u: any) => ({
                    value: u.id,
                    label: u.name,
                  }))}
                />
              </Form.Item>
              <Form.Item
                name="reminderMinutes"
                label={tr("reminder_minutes")}
                rules={[{ required: true }]}
              >
                <InputNumber min={0} max={10080} />
              </Form.Item>
              <Form.Item
                name="escalationMinutes"
                label={tr("escalation_minutes")}
                rules={[{ required: true }]}
              >
                <InputNumber min={0} max={10080} />
              </Form.Item>
              <Form.Item
                name="enabled"
                label={tr("automatic")}
                valuePropName="checked"
              >
                <Switch />
              </Form.Item>
            </>
          ) : (
            <Form.Item
              name="note"
              label={tr("reason")}
              rules={[{ required: true, whitespace: true }]}
            >
              <Input.TextArea aria-label={tr("reason")} maxLength={2000} />
            </Form.Item>
          )}
        </Form>
      </Modal>
      {mutation.retry}
    </>
  );
}
