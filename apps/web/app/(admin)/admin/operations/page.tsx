"use client";
import { gql, useMutation, useQuery } from "@apollo/client";
import { useDeferredValue, useEffect, useRef, useState } from "react";
import {
  Alert,
  Button,
  Card,
  Drawer,
  Form,
  Input,
  InputNumber,
  Modal,
  Select,
  Space,
  Spin,
  Switch,
  Table,
  Tabs,
  Tag,
  Typography,
  message,
} from "antd";
import { useBmsPermissions } from "@/app/hooks/useBmsPermissions";
import { useI18n } from "@/lib/i18nContext";
import styles from "./operations.module.css";
import FollowupPanel, { ChecklistEscalateButton } from "./FollowupPanel";
import TeamPanel from "./TeamPanel";
import ProductionPanel, { ProductionRunLink } from "./ProductionPanel";
import ImprovementPanel from "./ImprovementPanel";
import ImprovementRunContext from "@/components/operations/ImprovementRunContext";
import MaterialPanel, { MaterialRunContext } from "./MaterialPanel";
import QualityPanel, { QualityRunContext } from "./QualityPanel";

const WORKSPACE = gql`
  query ChecklistWorkspace($filter: BmsChecklistFilter) {
    bmsChecklistWorkspace(filter: $filter) {
      actorId
      total
      locations {
        id
        name
        active
      }
      staff {
        id
        name
      }
      stations {
        id
        name
        locationId
      }
      metrics {
        open
        overdue
        review
        actions
      }
      templates {
        id
        familyId
        name
        category
        version
        status
        locationId
        stationId
        items
        separateReviewer
        createdAt
      }
      runs {
        id
        snapshot
        status
        version
        locationId
        assignedTo
        dueAt
        createdAt
      }
      schedules {
        assignmentMode
        dutyKey
        id
        templateId
        name
        assignedTo
        timezone
        localTime
        weekdays
        dueMinutes
        nextAt
        active
        version
      }
      actions {
        id
        runId
        itemKey
        status
        version
        assignedTo
        dueAt
        instruction
        resolution
        name
        locationId
      }
    }
  }
`;
const DETAIL = gql`
  query ChecklistRun($id: ID!) {
    bmsChecklistRun(id: $id) {
      assignmentEvidence
      id
      templateId
      snapshot
      status
      version
      locationId
      assignedTo
      dueAt
      createdAt
      startedAt
      submittedAt
      reviewedAt
      reviewedBy
      results {
        id
        itemKey
        revision
        value
        outcome
        note
        photoIds
        recordedBy
        recordedAt
      }
      history {
        id
        itemKey
        revision
        value
        outcome
        note
        photoIds
        recordedBy
        recordedAt
      }
      events {
        id
        action
        actor
        note
        createdAt
      }
      actions {
        id
        runId
        itemKey
        status
        version
        assignedTo
        dueAt
        instruction
        resolution
        resolvedBy
        verifiedBy
      }
      evidence {
        fileId
        itemKey
      }
    }
  }
`;
const COMMAND = gql`
  mutation ChecklistCommand($input: BmsChecklistCommandInput!) {
    bmsChecklistCommand(input: $input) {
      status
      id
      version
    }
  }
`;
const TYPES = [
  "BOOLEAN",
  "PASS_FAIL",
  "NUMBER",
  "TEMPERATURE",
  "TEXT",
  "PHOTO",
  "CHOICE",
];
const STATUSES = [
  "OPEN",
  "IN_PROGRESS",
  "SUBMITTED",
  "APPROVED",
  "REJECTED",
  "VOID",
];
const localInput = (d: string) => {
  const v = new Date(d);
  return new Date(v.getTime() - v.getTimezoneOffset() * 60000)
    .toISOString()
    .slice(0, 16);
};
const newItem = () => ({
  key: crypto.randomUUID().replaceAll("-", ""),
  label: "",
  type: "PASS_FAIL",
  required: true,
  photoRequired: false,
  allowNa: false,
  min: null,
  max: null,
  unit: "",
  choicesText: "",
  instruction: "",
});

export default function OperationsPage() {
  const { t, lang } = useI18n(),
    { can, loading: permissionsLoading } = useBmsPermissions();
  const tr = (k: string) => t(`operation_checklists.${k}`);
  const [activeTab, setActiveTab] = useState("runs");
  useEffect(() => {
    const p = new URLSearchParams(window.location.search);
    if(p.has('improvement'))setActiveTab('improvement');
    if(p.get('production'))setActiveTab('production');
    if(p.get('material'))setActiveTab('materials');
    if(p.get('quality'))setActiveTab('quality');
    if (p.get("run")) setSelected(p.get("run")!);
    if (p.has("handover") || p.has("roster")) setActiveTab("team");
  }, []);
  const [locationId, setLocation] = useState<string>(),
    [search, setSearch] = useState(""),
    [status, setStatus] = useState<string>(),
    [page, setPage] = useState(1);
  const deferredSearch = useDeferredValue(search);
  const [selected, setSelected] = useState<string>(),
    [dialog, setDialog] = useState<any>(null),
    [form] = Form.useForm();
  const [draft, setDraft] = useState<any>(null),
    [busy, setBusy] = useState(false),
    [uncertain, setUncertain] = useState(false);
  const assignmentMode = Form.useWatch("assignmentMode", form);
  const pending = useRef<any>(null);
  const view = can("operations.checklist.view"),
    manage = can("operations.checklist.manage"),
    execute = can("operations.checklist.execute"),
    review = can("operations.checklist.review");
  const workspace = useQuery(WORKSPACE, {
    variables: {
      filter: {
        locationId,
        search: deferredSearch,
        status,
        offset: (page - 1) * 25,
      },
    },
    skip: !view,
    fetchPolicy: "network-only",
    pollInterval: 30000,
  });
  const detail = useQuery(DETAIL, {
    variables: { id: selected },
    skip: !selected || !view,
    fetchPolicy: "network-only",
  });
  const [mutate] = useMutation(COMMAND);
  const w = workspace.data?.bmsChecklistWorkspace,
    run = detail.data?.bmsChecklistRun;
  const format = (d: string) =>
    new Date(d).toLocaleString(lang === "th" ? "th-TH" : "en-GB");
  const branchName = (id: string) =>
    w?.locations.find((x: any) => x.id === id)?.name ?? id;
  const staffName = (id: string) =>
    w?.staff.find((x: any) => x.id === id)?.name ?? id ?? tr("unassigned");
  const errorText = (code: string) =>
    tr(
      (
        {
          STALE_VERSION: "stale",
          REASON_REQUIRED: "reason_required",
          CORRECTIVE_ACTION_OPEN: "pending_actions",
          DISTINCT_REVIEWER_REQUIRED: "distinct",
          INCOMPLETE: "incomplete",
          NOT_ASSIGNED: "not_assigned",
          INVALID_INPUT: "bad_input",
          INVALID_STATE: "bad_state",
          EVIDENCE_REQUIRED: "photo_needed",
          EVIDENCE_LIMIT: "photo_limit",
          FORBIDDEN: "denied",
          NOT_FOUND: "not_found",
          INVALID_ASSIGNEE: "invalid_assignee",
        } as Record<string, string>
      )[code] ?? "bad_input",
    );
  async function reload() {
    await Promise.all([
      workspace.refetch(),
      ...(selected ? [detail.refetch()] : []),
    ]);
  }
  async function command(input: any, retry = false) {
    if (pending.current && !retry) {
      message.error(tr("uncertain"));
      return false;
    }
    const payload = retry
      ? pending.current
      : { ...input, idempotencyKey: crypto.randomUUID() };
    pending.current = payload;
    setBusy(true);
    try {
      const response = await mutate({ variables: { input: payload } }),
        result = response.data.bmsChecklistCommand;
      pending.current = null;
      setUncertain(false);
      if (result.status !== "OK") {
        message.error(errorText(result.status));
        return false;
      }
      message.success(tr("saved"));
      if (payload.action === "SAVE_TEMPLATE") setDraft(null);
      if (
        [
          "CREATE_RUN",
          "SAVE_SCHEDULE",
          "ASSIGN",
          "ACTION_ASSIGN",
          "ACTION_RESOLVE",
          "ACTION_REOPEN",
          "REJECT",
          "VOID",
        ].includes(payload.action)
      )
        setDialog(null);
      // A read failure after a committed write must not resend the mutation.
      await reload().catch(() => message.warning(tr("failed")));
      return true;
    } catch (e: any) {
      if (
        e.graphQLErrors?.some((x: any) =>
          ["FORBIDDEN", "UNAUTHENTICATED", "BAD_USER_INPUT"].includes(
            x.extensions?.code,
          ),
        )
      ) {
        pending.current = null;
        setUncertain(false);
        message.error(tr("denied"));
      } else {
        setUncertain(true);
        message.error(tr("uncertain"));
      }
      return false;
    } finally {
      setBusy(false);
    }
  }
  function confirmCommand(input: any) {
    const target = [
      ...(w?.templates ?? []),
      ...(w?.schedules ?? []),
      ...(w?.actions ?? []),
      ...(run?.actions ?? []),
      ...(run ? [run] : []),
    ].find((r: any) => r.id === input.id);
    const label = (
      {
        PUBLISH: "publish",
        RETIRE: "retire",
        PAUSE_SCHEDULE: "pause",
        ACTION_VERIFY: "verify",
        SUBMIT: "submit",
        APPROVE: "approve",
      } as Record<string, string>
    )[input.action];
    const confirmation = Modal.confirm({
      title: tr(label ?? "confirm"),
      content: (
        <div>
          <p>
            {tr(input.action === "PUBLISH" ? "publish_hint" : "safety_hint")}
          </p>
          <p>{target?.snapshot?.name ?? target?.name ?? target?.instruction}</p>
          <p>
            {tr("version")}: {input.version}
          </p>
          <code>{input.id}</code>
        </div>
      ),
      okText: tr("confirm"),
      cancelText: tr("cancel"),
      onOk: async () => {
        if (!(await command({ ...input, confirmed: true }))) {
          // The higher retry dialog owns this exact command while its outcome is unknown.
          if (pending.current) confirmation.destroy();
          else throw new Error("not committed");
        }
      },
    });
  }
  function openDialog(kind: string, row: any) {
    form.resetFields();
    form.setFieldsValue({
      assignmentMode: "FIXED",
      assignedTo: row.assignedTo ?? undefined,
      dueAt: localInput(
        row.dueAt ?? new Date(Date.now() + 3600000).toISOString(),
      ),
      timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
      localTime: "08:00",
      weekdays: [0, 1, 2, 3, 4, 5, 6],
      dueMinutes: 60,
    });
    setDialog({ kind, row });
  }
  async function submitDialog() {
    const v = await form.validateFields(),
      r = dialog.row,
      kind = dialog.kind;
    let input: any = {
      action: kind,
      id: r.id,
      version: r.version,
      confirmed: true,
    };
    if (kind === "CREATE_RUN")
      input = {
        action: kind,
        templateId: r.id,
        assignmentMode: v.assignmentMode ?? "FIXED",
        dutyKey: v.assignmentMode === "DUTY" ? v.dutyKey : undefined,
        assignedTo: v.assignmentMode === "DUTY" ? null : (v.assignedTo ?? null),
        dueAt: new Date(v.dueAt).toISOString(),
        confirmed: true,
      };
    else if (kind === "SAVE_SCHEDULE")
      input = {
        action: kind,
        templateId: r.id,
        ...v,
        assignedTo: v.assignmentMode === "DUTY" ? null : (v.assignedTo ?? null),
        dutyKey: v.assignmentMode === "DUTY" ? v.dutyKey : undefined,
        confirmed: true,
      };
    else if (kind === "ASSIGN" || kind === "ACTION_ASSIGN")
      input = {
        ...input,
        assignedTo: v.assignedTo ?? null,
        dueAt: new Date(v.dueAt).toISOString(),
      };
    else input.note = v.note;
    if (await command(input)) setDialog(null);
  }
  function editTemplate(row?: any) {
    setDraft(
      row
        ? {
            ...row,
            items: row.items.map((x: any) => ({
              ...x,
              choicesText: x.choices.join("|"),
            })),
          }
        : {
            name: "",
            category: "OPENING",
            locationId,
            stationId: null,
            separateReviewer: true,
            items: [newItem()],
          },
    );
  }
  async function saveTemplate() {
    const items = draft.items.map(({ choicesText, ...x }: any) => ({
      ...x,
      choices:
        x.type === "CHOICE"
          ? choicesText.split("|").map((s: string) => s.trim())
          : [],
      min: ["NUMBER", "TEMPERATURE"].includes(x.type) ? x.min : null,
      max: ["NUMBER", "TEMPERATURE"].includes(x.type) ? x.max : null,
    }));
    if (
      await command({
        action: "SAVE_TEMPLATE",
        id: draft.id,
        name: draft.name,
        category: draft.category,
        locationId: draft.locationId,
        stationId: draft.stationId,
        separateReviewer: draft.separateReviewer,
        items,
      })
    )
      setDraft(null);
  }
  const actionButtons = (a: any) => (
    <Space wrap>
      <Button onClick={() => setSelected(a.runId)}>{tr("view")}</Button>
      {execute && ["OPEN", "IN_PROGRESS"].includes(a.status) && (
        <Button disabled={busy} onClick={() => openDialog("ACTION_RESOLVE", a)}>
          {tr("resolve")}
        </Button>
      )}
      {review && a.status === "RESOLVED" && (
        <Button
          disabled={busy}
          onClick={() =>
            confirmCommand({
              action: "ACTION_VERIFY",
              id: a.id,
              version: a.version,
            })
          }
        >
          {tr("verify")}
        </Button>
      )}
      {review && ["RESOLVED", "VERIFIED"].includes(a.status) && (
        <Button disabled={busy} onClick={() => openDialog("ACTION_REOPEN", a)}>
          {tr("reopen")}
        </Button>
      )}
      {manage && (
        <Button disabled={busy} onClick={() => openDialog("ACTION_ASSIGN", a)}>
          {tr("assign")}
        </Button>
      )}
    </Space>
  );
  if (permissionsLoading) return <Spin />;
  if (!view) return <Alert closable type="error" message={tr("denied")} />;
  return (
    <div className={styles.page}>
      <Typography.Title level={2}>{tr("title")}</Typography.Title>
      <Typography.Paragraph>{tr("subtitle")}</Typography.Paragraph>
      <Alert closable type="info" message={tr("safety_hint")} showIcon />
      {uncertain && (
        <Alert
          closable
          type="warning"
          message={tr("uncertain")}
          action={
            <Button loading={busy} onClick={() => command(null, true)}>
              {tr("retry")}
            </Button>
          }
        />
      )}
      <Modal
        open={uncertain}
        zIndex={3000}
        title={tr("uncertain")}
        closable={false}
        maskClosable={false}
        keyboard={false}
        cancelButtonProps={{ style: { display: "none" } }}
        confirmLoading={busy}
        okText={tr("retry")}
        onOk={() => command(null, true)}
      />
      {workspace.error && (
        <Alert
          closable
          type="error"
          message={tr("failed")}
          action={
            <Button onClick={() => workspace.refetch()}>{tr("refresh")}</Button>
          }
        />
      )}
      <Space wrap className={styles.toolbar}>
        <Select
          aria-label={tr("branch")}
          placeholder={tr("all_branches")}
          allowClear
          value={locationId}
          className={styles.select}
          options={w?.locations.map((l: any) => ({
            label: l.name,
            value: l.id,
          }))}
          onChange={(v) => {
            setLocation(v);
            setPage(1);
          }}
        />
        <Button
          onClick={() => reload().catch(() => message.error(tr("failed")))}
        >
          {tr("refresh")}
        </Button>
      </Space>
      <div className={styles.metrics}>
        {["open", "overdue", "review", "actions"].map((k) => (
          <Card key={k} size="small">
            <div>{tr(k)}</div>
            <strong>{w?.metrics[k] ?? "—"}</strong>
          </Card>
        ))}
      </div>
      <Typography.Paragraph type="secondary">
        {tr("bounds")}
      </Typography.Paragraph>
      <Tabs
        activeKey={activeTab}
        onChange={setActiveTab}
        items={[
          ...(can('operations.material.view')&&can('product.view')?[{key:'materials',label:t('operation_material.tab'),children:<MaterialPanel key={locationId??'all'} locationId={locationId} locationName={w?.locations?.find((x:any)=>x.id===locationId)?.name} staff={w?.staff??[]} onOpenRun={setSelected}/>}]:[]),
          ...(can('operations.quality.view')&&can('product.view')?[{key:'quality',label:t('operation_quality.tab'),children:<QualityPanel key={locationId??'all'} locationId={locationId} staff={w?.staff??[]} onOpenRun={setSelected}/>}]:[]),
          {key:'improvement',label:t('operation_improvement.tab'),children:<ImprovementPanel key={locationId??'all'} locationId={locationId} locations={w?.locations??[]} templates={w?.templates??[]} staff={w?.staff??[]} onOpenRun={setSelected}/>},
          {key:'production',label:t('operation_production.tab'),children:<ProductionPanel key={locationId??'all'} locationId={locationId} templates={w?.templates??[]} staff={w?.staff??[]} onOpenRun={setSelected}/>},
          {
            key: "team",
            label: t("operation_team.tab"),
            children: (
              <TeamPanel
                key={locationId ?? "all"}
                locationId={locationId}
                locations={w?.locations ?? []}
                staff={w?.staff ?? []}
                onOpenRun={setSelected}
              />
            ),
          },
          {
            key: "followup",
            label: tr("followup"),
            children: (
              <FollowupPanel
                key={locationId ?? "all"}
                locationId={locationId}
                locations={w?.locations ?? []}
                actorId={w?.actorId ?? ""}
                execute={execute}
                manage={manage}
                review={review}
                onOpenRun={setSelected}
              />
            ),
          },
          {
            key: "runs",
            label: tr("runs"),
            children: (
              <>
                <Space wrap className={styles.toolbar}>
                  <Input.Search
                    aria-label={tr("search")}
                    placeholder={tr("search")}
                    value={search}
                    onChange={(e) => {
                      setSearch(e.target.value);
                      setPage(1);
                    }}
                  />
                  <Select
                    className={styles.select}
                    aria-label={tr("status")}
                    placeholder={tr("all_status")}
                    allowClear
                    value={status}
                    options={STATUSES.map((s) => ({ label: tr(s), value: s }))}
                    onChange={(v) => {
                      setStatus(v);
                      setPage(1);
                    }}
                  />
                </Space>
                <Table
                  rowKey="id"
                  loading={workspace.loading}
                  dataSource={w?.runs ?? []}
                  scroll={{ x: 780 }}
                  pagination={{
                    current: page,
                    pageSize: 25,
                    total: w?.total ?? 0,
                    onChange: setPage,
                    showSizeChanger: false,
                  }}
                  columns={[
                    {
                      title: tr("name"),
                      render: (_: any, r: any) => (
                        <Button type="link" onClick={() => setSelected(r.id)}>
                          {r.snapshot.name}
                        </Button>
                      ),
                    },
                    {
                      title: tr("branch"),
                      render: (_: any, r: any) => branchName(r.locationId),
                    },
                    {
                      title: tr("status"),
                      render: (_: any, r: any) => <Tag>{tr(r.status)}</Tag>,
                    },
                    {
                      title: tr("assignee"),
                      render: (_: any, r: any) => staffName(r.assignedTo),
                    },
                    {
                      title: tr("due"),
                      render: (_: any, r: any) => format(r.dueAt),
                    },
                  ]}
                />
              </>
            ),
          },
          {
            key: "templates",
            label: tr("templates"),
            children: (
              <>
                <Space wrap className={styles.toolbar}>
                  {manage && (
                    <Button type="primary" onClick={() => editTemplate()}>
                      {tr("new_template")}
                    </Button>
                  )}
                </Space>
                <Table
                  rowKey="id"
                  dataSource={w?.templates ?? []}
                  scroll={{ x: 820 }}
                  columns={[
                    { title: tr("name"), dataIndex: "name" },
                    { title: tr("version"), dataIndex: "version" },
                    {
                      title: tr("branch"),
                      render: (_: any, r: any) => branchName(r.locationId),
                    },
                    {
                      title: tr("status"),
                      render: (_: any, r: any) => <Tag>{tr(r.status)}</Tag>,
                    },
                    {
                      title: tr("actions"),
                      render: (_: any, r: any) => (
                        <Space wrap>
                          {manage && (
                            <>
                              <Button onClick={() => editTemplate(r)}>
                                {tr("edit_version")}
                              </Button>
                              {r.status === "DRAFT" && (
                                <Button
                                  disabled={busy}
                                  onClick={() =>
                                    confirmCommand({
                                      action: "PUBLISH",
                                      id: r.id,
                                      version: r.version,
                                    })
                                  }
                                >
                                  {tr("publish")}
                                </Button>
                              )}
                              {r.status === "ACTIVE" && (
                                <>
                                  <Button
                                    disabled={busy}
                                    onClick={() => openDialog("CREATE_RUN", r)}
                                  >
                                    {tr("create_run")}
                                  </Button>
                                  <Button
                                    onClick={() =>
                                      openDialog("SAVE_SCHEDULE", r)
                                    }
                                  >
                                    {tr("schedule")}
                                  </Button>
                                  <Button
                                    disabled={busy}
                                    onClick={() =>
                                      confirmCommand({
                                        action: "RETIRE",
                                        id: r.id,
                                        version: r.version,
                                      })
                                    }
                                  >
                                    {tr("retire")}
                                  </Button>
                                </>
                              )}
                            </>
                          )}
                        </Space>
                      ),
                    },
                  ]}
                />
              </>
            ),
          },
          {
            key: "schedules",
            label: tr("schedules"),
            children: (
              <Table
                rowKey="id"
                dataSource={w?.schedules ?? []}
                scroll={{ x: 850 }}
                columns={[
                  { title: tr("name"), dataIndex: "name" },
                  {
                    title: t("operation_team.assignment"),
                    render: (_: any, r: any) =>
                      r.assignmentMode === "DUTY"
                        ? `${t("operation_team.by_duty")}: ${r.dutyKey}`
                        : t("operation_team.fixed"),
                  },
                  {
                    title: tr("local_time"),
                    render: (_: any, r: any) =>
                      `${r.localTime} · ${r.timezone}`,
                  },
                  {
                    title: tr("weekdays"),
                    render: (_: any, r: any) =>
                      r.weekdays
                        .map((d: number) =>
                          tr(
                            ["sun", "mon", "tue", "wed", "thu", "fri", "sat"][
                              d
                            ],
                          ),
                        )
                        .join(", "),
                  },
                  {
                    title: tr("next"),
                    render: (_: any, r: any) => format(r.nextAt),
                  },
                  {
                    title: tr("status"),
                    render: (_: any, r: any) =>
                      tr(r.active ? "active" : "paused"),
                  },
                  {
                    title: tr("actions"),
                    render: (_: any, r: any) =>
                      manage &&
                      r.active && (
                        <Button
                          disabled={busy}
                          onClick={() =>
                            confirmCommand({
                              action: "PAUSE_SCHEDULE",
                              id: r.id,
                              version: r.version,
                            })
                          }
                        >
                          {tr("pause")}
                        </Button>
                      ),
                  },
                ]}
              />
            ),
          },
          {
            key: "actions",
            label: tr("actions"),
            children: (
              <Table
                rowKey="id"
                dataSource={w?.actions ?? []}
                scroll={{ x: 850 }}
                columns={[
                  { title: tr("name"), dataIndex: "name" },
                  { title: tr("instruction"), dataIndex: "instruction" },
                  {
                    title: tr("status"),
                    render: (_: any, r: any) => tr(r.status),
                  },
                  {
                    title: tr("assignee"),
                    render: (_: any, r: any) => staffName(r.assignedTo),
                  },
                  {
                    title: tr("due"),
                    render: (_: any, r: any) => format(r.dueAt),
                  },
                  {
                    title: tr("actions"),
                    render: (_: any, r: any) => actionButtons(r),
                  },
                ]}
              />
            ),
          },
        ]}
      />
      <Drawer
        width="min(940px, 100vw)"
        open={!!selected}
        onClose={() => setSelected(undefined)}
        title={run?.snapshot?.name ?? tr("runs")}
      >
        {detail.error ? (
          <Alert closable type="error" message={tr("failed")} />
        ) : detail.loading ? (
          <Spin />
        ) : (
          run && (
            <>
              <Space wrap>
                <Tag>{tr(run.status)}</Tag>
                <ProductionRunLink runId={run.id}/>
                <ImprovementRunContext runId={run.id}/>
                <MaterialRunContext runId={run.id}/>
                <QualityRunContext runId={run.id}/>
                <span>
                  {branchName(run.locationId)} · {format(run.dueAt)}
                </span>
                <span>{staffName(run.assignedTo)}</span>
                <Button onClick={() => detail.refetch()}>
                  {tr("refresh")}
                </Button>
              </Space>
              {run.assignmentEvidence?.mode === "DUTY" && (
                <p>
                  {t("operation_team.evidence")}:{" "}
                  {run.assignmentEvidence.dutyKey} ·{" "}
                  {run.assignmentEvidence.status} ·{" "}
                  {format(run.assignmentEvidence.effectiveAt)}
                </p>
              )}
              {run.snapshot.items.map((item: any) => (
                <ResultEditor
                  key={`${run.id}:${item.key}:${run.results.find((r: any) => r.itemKey === item.key)?.revision ?? 0}`}
                  item={item}
                  run={run}
                  tr={tr}
                  busy={busy || uncertain}
                  canExecute={
                    execute &&
                    ["OPEN", "IN_PROGRESS", "REJECTED"].includes(run.status) &&
                    (!run.assignedTo || run.assignedTo === w?.actorId)
                  }
                  command={command}
                  errorText={errorText}
                />
              ))}
              <Space wrap className={styles.toolbar}>
                {execute && !["APPROVED", "VOID"].includes(run.status) && (
                  <ChecklistEscalateButton
                    run={run}
                    onDone={async () => {
                      await detail.refetch();
                    }}
                  />
                )}
                {execute &&
                  ["OPEN", "IN_PROGRESS", "REJECTED"].includes(run.status) && (
                    <Button
                      type="primary"
                      disabled={busy}
                      onClick={() =>
                        confirmCommand({
                          action: "SUBMIT",
                          id: run.id,
                          version: run.version,
                        })
                      }
                    >
                      {tr("submit")}
                    </Button>
                  )}
                {review && run.status === "SUBMITTED" && (
                  <>
                    <Button
                      type="primary"
                      disabled={busy}
                      onClick={() =>
                        confirmCommand({
                          action: "APPROVE",
                          id: run.id,
                          version: run.version,
                        })
                      }
                    >
                      {tr("approve")}
                    </Button>
                    <Button onClick={() => openDialog("REJECT", run)}>
                      {tr("reject")}
                    </Button>
                  </>
                )}
                {manage &&
                  ["OPEN", "IN_PROGRESS", "REJECTED"].includes(run.status) && (
                    <Button onClick={() => openDialog("ASSIGN", run)}>
                      {tr("assign")}
                    </Button>
                  )}
                {review && !["APPROVED", "VOID"].includes(run.status) && (
                  <Button danger onClick={() => openDialog("VOID", run)}>
                    {tr("void")}
                  </Button>
                )}
              </Space>
              <Typography.Title level={4}>{tr("actions")}</Typography.Title>
              {run.actions.map((a: any) => (
                <Card key={a.id} size="small" className={styles.item}>
                  <p>
                    {a.instruction} · {tr(a.status)}
                  </p>
                  <p>{a.resolution}</p>
                  {!["VOID", "APPROVED"].includes(run.status) &&
                    actionButtons(a)}
                </Card>
              ))}
              <Typography.Title level={4}>{tr("history")}</Typography.Title>
              <Table
                size="small"
                rowKey="id"
                dataSource={run.history}
                scroll={{ x: 650 }}
                columns={[
                  {
                    title: tr("label"),
                    render: (_: any, r: any) =>
                      run.snapshot.items.find((x: any) => x.key === r.itemKey)
                        ?.label ?? r.itemKey,
                  },
                  {
                    title: tr("value"),
                    render: (_: any, r: any) => String(r.value),
                  },
                  {
                    title: tr("outcome"),
                    render: (_: any, r: any) => tr(r.outcome),
                  },
                  { title: tr("note"), dataIndex: "note" },
                  {
                    title: tr("recorded_by"),
                    render: (_: any, r: any) => staffName(r.recordedBy),
                  },
                  {
                    title: tr("evidence"),
                    render: (_: any, r: any) => (
                      <Space wrap>
                        {r.photoIds.map((id: number) => (
                          <a
                            key={id}
                            href={`/api/bms/operations/evidence/${id}`}
                            target="_blank"
                            rel="noreferrer"
                          >
                            {tr("evidence")} {id}
                          </a>
                        ))}
                      </Space>
                    ),
                  },
                  {
                    title: tr("at"),
                    render: (_: any, r: any) => format(r.recordedAt),
                  },
                ]}
              />
              <Typography.Title level={4}>{tr("events")}</Typography.Title>
              <Table
                size="small"
                rowKey="id"
                dataSource={run.events}
                scroll={{ x: 500 }}
                columns={[
                  { title: tr("actions"), dataIndex: "action" },
                  { title: tr("note"), dataIndex: "note" },
                  {
                    title: tr("recorded_by"),
                    render: (_: any, r: any) => staffName(r.actor),
                  },
                  {
                    title: tr("at"),
                    render: (_: any, r: any) => format(r.createdAt),
                  },
                ]}
              />
            </>
          )
        )}
      </Drawer>
      <Modal
        open={!!dialog}
        title={
          dialog
            ? tr(
                (
                  {
                    CREATE_RUN: "create_run",
                    SAVE_SCHEDULE: "schedule",
                    ASSIGN: "assign",
                    ACTION_ASSIGN: "assign",
                    ACTION_RESOLVE: "resolve",
                    ACTION_REOPEN: "reopen",
                    REJECT: "reject",
                    VOID: "void",
                  } as any
                )[dialog.kind],
              )
            : ""
        }
        onCancel={() => setDialog(null)}
        onOk={submitDialog}
        confirmLoading={busy}
        okText={tr("confirm")}
        cancelText={tr("cancel")}
        destroyOnClose
      >
        <Form name="operationChecklistCommand" form={form} layout="vertical">
          {["CREATE_RUN", "SAVE_SCHEDULE"].includes(dialog?.kind) && (
            <>
              <Form.Item
                name="assignmentMode"
                label={t("operation_team.assignment")}
              >
                <Select
                  aria-label={t("operation_team.assignment")}
                  options={[
                    { value: "FIXED", label: t("operation_team.fixed") },
                    { value: "DUTY", label: t("operation_team.by_duty") },
                  ]}
                />
              </Form.Item>
              <Form.Item
                noStyle
                shouldUpdate={(a, b) => a.assignmentMode !== b.assignmentMode}
              >
                {({ getFieldValue }) =>
                  getFieldValue("assignmentMode") === "DUTY" ? (
                    <Form.Item
                      name="dutyKey"
                      label={t("operation_team.duty_key")}
                      rules={[{ required: true }]}
                    >
                      <Input
                        aria-label={t("operation_team.duty_key")}
                        maxLength={60}
                      />
                    </Form.Item>
                  ) : null
                }
              </Form.Item>
            </>
          )}
          <p>
            {dialog?.row?.name ??
              dialog?.row?.snapshot?.name ??
              dialog?.row?.instruction}
          </p>
          {["CREATE_RUN", "ASSIGN", "ACTION_ASSIGN", "SAVE_SCHEDULE"].includes(
            dialog?.kind,
          ) &&
            (!["CREATE_RUN", "SAVE_SCHEDULE"].includes(dialog?.kind) ||
              assignmentMode !== "DUTY") && (
              <Form.Item name="assignedTo" label={tr("assignee")}>
                <Select
                  allowClear
                  options={w?.staff.map((u: any) => ({
                    label: u.name,
                    value: u.id,
                  }))}
                />
              </Form.Item>
            )}
          {["CREATE_RUN", "ASSIGN", "ACTION_ASSIGN"].includes(dialog?.kind) && (
            <Form.Item
              name="dueAt"
              label={tr("due")}
              rules={[{ required: true }]}
            >
              <Input type="datetime-local" />
            </Form.Item>
          )}
          {dialog?.kind === "SAVE_SCHEDULE" && (
            <>
              <Form.Item
                name="timezone"
                label={tr("timezone")}
                rules={[{ required: true }]}
              >
                <Input />
              </Form.Item>
              <Form.Item
                name="localTime"
                label={tr("local_time")}
                rules={[{ required: true }]}
              >
                <Input type="time" />
              </Form.Item>
              <Form.Item
                name="weekdays"
                label={tr("weekdays")}
                rules={[{ required: true }]}
              >
                <Select
                  mode="multiple"
                  options={[
                    "sun",
                    "mon",
                    "tue",
                    "wed",
                    "thu",
                    "fri",
                    "sat",
                  ].map((d, i) => ({ label: tr(d), value: i }))}
                />
              </Form.Item>
              <Form.Item
                name="dueMinutes"
                label={tr("due_minutes")}
                rules={[{ required: true }]}
              >
                <InputNumber min={1} max={10080} />
              </Form.Item>
            </>
          )}
          {["REJECT", "VOID", "ACTION_RESOLVE", "ACTION_REOPEN"].includes(
            dialog?.kind,
          ) && (
            <Form.Item
              name="note"
              label={tr("note")}
              rules={[{ required: true, whitespace: true }]}
            >
              <Input.TextArea maxLength={2000} />
            </Form.Item>
          )}
        </Form>
      </Modal>
      <Drawer
        width="min(880px, 100vw)"
        open={!!draft}
        title={tr("new_template")}
        onClose={() => setDraft(null)}
        extra={
          <Button type="primary" loading={busy} onClick={saveTemplate}>
            {tr("save_draft")}
          </Button>
        }
      >
        {draft && (
          <Form layout="vertical">
            <Form.Item label={tr("name")} required>
              <Input
                aria-label={tr("name")}
                value={draft.name}
                maxLength={200}
                onChange={(e) => setDraft({ ...draft, name: e.target.value })}
              />
            </Form.Item>
            <Form.Item label={tr("category")}>
              <Input
                value={draft.category}
                maxLength={60}
                onChange={(e) =>
                  setDraft({ ...draft, category: e.target.value })
                }
              />
            </Form.Item>
            <Form.Item label={tr("branch")} required>
              <Select
                aria-label={tr("branch")}
                disabled={!!draft.id}
                value={draft.locationId}
                options={w?.locations
                  .filter((l: any) => l.active)
                  .map((l: any) => ({ label: l.name, value: l.id }))}
                onChange={(v) =>
                  setDraft({ ...draft, locationId: v, stationId: null })
                }
              />
            </Form.Item>
            <Form.Item label={tr("station")}>
              <Select
                allowClear
                value={draft.stationId ?? undefined}
                options={w?.stations
                  .filter(
                    (s: any) =>
                      !s.locationId || s.locationId === draft.locationId,
                  )
                  .map((s: any) => ({ label: s.name, value: s.id }))}
                onChange={(v) => setDraft({ ...draft, stationId: v ?? null })}
              />
            </Form.Item>
            <Form.Item label={tr("separate")}>
              <Switch
                checked={draft.separateReviewer}
                onChange={(v) => setDraft({ ...draft, separateReviewer: v })}
              />
            </Form.Item>
            {draft.items.map((item: any, index: number) => {
              const change = (k: string, v: any) =>
                setDraft({
                  ...draft,
                  items: draft.items.map((x: any, n: number) =>
                    n === index ? { ...x, [k]: v } : x,
                  ),
                });
              return (
                <Card
                  key={item.key}
                  className={styles.item}
                  title={`${tr("label")} ${index + 1}`}
                  extra={
                    <Button
                      onClick={() =>
                        setDraft({
                          ...draft,
                          items: draft.items.filter(
                            (_: any, n: number) => n !== index,
                          ),
                        })
                      }
                    >
                      {tr("remove")}
                    </Button>
                  }
                >
                  <Form.Item label={tr("label")}>
                    <Input
                      value={item.label}
                      maxLength={300}
                      onChange={(e) => change("label", e.target.value)}
                    />
                  </Form.Item>
                  <Form.Item label={tr("type")}>
                    <Select
                      value={item.type}
                      options={TYPES.map((x) => ({ label: tr(x), value: x }))}
                      onChange={(v) => change("type", v)}
                    />
                  </Form.Item>
                  <Space wrap>
                    {["required", "photoRequired", "allowNa"].map((key, i) => (
                      <label key={key}>
                        {tr(["required", "photo_required", "allow_na"][i])}{" "}
                        <Switch
                          size="small"
                          checked={item[key]}
                          onChange={(v) => change(key, v)}
                        />
                      </label>
                    ))}
                  </Space>
                  {["NUMBER", "TEMPERATURE"].includes(item.type) && (
                    <div className={styles.fields}>
                      <Form.Item label={tr("min")}>
                        <InputNumber
                          value={item.min}
                          onChange={(v) => change("min", v)}
                        />
                      </Form.Item>
                      <Form.Item label={tr("max")}>
                        <InputNumber
                          value={item.max}
                          onChange={(v) => change("max", v)}
                        />
                      </Form.Item>
                      <Form.Item label={tr("unit")}>
                        <Input
                          value={item.unit}
                          maxLength={30}
                          onChange={(e) => change("unit", e.target.value)}
                        />
                      </Form.Item>
                    </div>
                  )}
                  {item.type === "CHOICE" && (
                    <Form.Item label={tr("choices")}>
                      <Input
                        value={item.choicesText}
                        onChange={(e) => change("choicesText", e.target.value)}
                      />
                    </Form.Item>
                  )}
                  <Form.Item label={tr("instruction")}>
                    <Input.TextArea
                      value={item.instruction}
                      maxLength={2000}
                      onChange={(e) => change("instruction", e.target.value)}
                    />
                  </Form.Item>
                </Card>
              );
            })}
            <Button
              disabled={draft.items.length >= 50}
              onClick={() =>
                setDraft({ ...draft, items: [...draft.items, newItem()] })
              }
            >
              {tr("add_item")}
            </Button>
          </Form>
        )}
      </Drawer>
    </div>
  );
}

function ResultEditor({
  item,
  run,
  tr,
  busy,
  canExecute,
  command,
  errorText,
}: any) {
  const existing = run.results.find((r: any) => r.itemKey === item.key);
  const [value, setValue] = useState<any>(existing?.value ?? null),
    [note, setNote] = useState(existing?.note ?? ""),
    [uploading, setUploading] = useState(false);
  const [photos, setPhotos] = useState<number[]>(
    existing?.photoIds ??
      run.evidence
        .filter((e: any) => e.itemKey === item.key)
        .map((e: any) => e.fileId),
  );
  async function upload(file: File) {
    if (file.size > 5 * 1024 * 1024) {
      message.error(tr("bad_input"));
      return;
    }
    setUploading(true);
    try {
      const q = new URLSearchParams({
        runId: run.id,
        itemKey: item.key,
        version: String(run.version),
      });
      const response = await fetch(`/api/bms/operations/evidence?${q}`, {
        method: "POST",
        headers: { "Content-Type": file.type },
        body: file,
      });
      const result = await response.json();
      if (!response.ok || result.status !== "OK")
        throw new Error(result.status);
      setPhotos((p) => [...p, result.fileId]);
    } catch (e) {
      message.error(errorText((e as Error).message));
    } finally {
      setUploading(false);
    }
  }
  let control;
  if (item.type === "BOOLEAN")
    control = (
      <Select
        aria-label={tr("value")}
        value={value}
        options={[
          { value: true, label: tr("yes") },
          { value: false, label: tr("no") },
        ]}
        onChange={setValue}
      />
    );
  else if (item.type === "PASS_FAIL" || item.type === "CHOICE")
    control = (
      <Select
        aria-label={tr("value")}
        value={value}
        options={(item.type === "PASS_FAIL"
          ? ["PASS", "FAIL"]
          : item.choices
        ).map((x: string) => ({
          value: x,
          label: item.type === "PASS_FAIL" ? tr(x) : x,
        }))}
        onChange={setValue}
      />
    );
  else if (item.type === "NUMBER" || item.type === "TEMPERATURE")
    control = (
      <InputNumber
        aria-label={tr("value")}
        value={value === "NA" ? null : value}
        onChange={setValue}
      />
    );
  else if (item.type === "PHOTO")
    control = <Switch checked={value === true} onChange={setValue} />;
  else
    control = (
      <Input.TextArea
        aria-label={tr("value")}
        value={value ?? ""}
        maxLength={2000}
        onChange={(e) => setValue(e.target.value)}
      />
    );
  return (
    <Card
      size="small"
      className={styles.item}
      title={
        <span>
          {item.label}
          {item.required ? " *" : ""}
        </span>
      }
      extra={
        existing && (
          <Tag color={existing.outcome === "FAIL" ? "red" : "default"}>
            {tr(existing.outcome)}
          </Tag>
        )
      }
    >
      {(item.min !== null || item.max !== null) && (
        <p>
          {tr("min")}: {item.min ?? "—"} · {tr("max")}: {item.max ?? "—"}{" "}
          {item.unit}
        </p>
      )}
      <Form layout="vertical" disabled={!canExecute || busy || uploading}>
        <Form.Item label={tr("value")}>{control}</Form.Item>
        {item.allowNa && (
          <label>
            <input
              type="checkbox"
              checked={value === "NA"}
              disabled={!canExecute || busy}
              onChange={(e) => setValue(e.target.checked ? "NA" : null)}
            />{" "}
            {tr("NA")}
          </label>
        )}
        <Form.Item label={tr("note")}>
          <Input.TextArea
            value={note}
            maxLength={2000}
            onChange={(e) => setNote(e.target.value)}
          />
        </Form.Item>
      </Form>
      <Space wrap>
        {photos.map((id) => (
          <a
            key={id}
            href={`/api/bms/operations/evidence/${id}`}
            target="_blank"
            rel="noreferrer"
          >
            <img
              alt={tr("evidence")}
              src={`/api/bms/operations/evidence/${id}`}
              width={80}
              height={60}
              style={{ objectFit: "cover" }}
            />
          </a>
        ))}
      </Space>
      {canExecute && (
        <Space wrap className={styles.toolbar}>
          <label>
            {tr("attach")}
            <input
              type="file"
              accept="image/png,image/jpeg,image/webp"
              disabled={busy || uploading || photos.length >= 5}
              onChange={(e) => {
                if (e.target.files?.[0]) void upload(e.target.files[0]);
                e.target.value = "";
              }}
            />
          </label>
          <Button
            type="primary"
            loading={uploading}
            disabled={busy || value === null}
            onClick={() =>
              command({
                action: "RECORD",
                id: run.id,
                version: run.version,
                itemKey: item.key,
                value,
                note,
                photoIds: photos,
              })
            }
          >
            {tr("save")}
          </Button>
        </Space>
      )}
    </Card>
  );
}
