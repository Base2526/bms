"use client";
import { gql, useQuery } from "@apollo/client";
import { useDeferredValue, useState, useEffect } from "react";
import {
  Alert,
  Button,
  Drawer,
  Form,
  Input,
  Modal,
  Select,
  Space,
  Spin,
  Switch,
  Table,
  Tabs,
  Tag,
  Typography,
} from "antd";
import { useI18n } from "@/lib/i18nContext";
import { useBmsPermissions } from "@/app/hooks/useBmsPermissions";
import { useTeamCommand } from "@/components/operations/useTeamCommand";
import StandardReadiness from "@/components/operations/StandardReadiness";
import WeeklyOperationsReport from "./WeeklyOperationsReport";
const WORK = gql`
  query ImprovementWorkspace($filter: BmsImprovementFilter) {
    bmsImprovementWorkspace(filter: $filter)
  }
`;
const DETAIL = gql`
  query ImprovementDetail($id: ID!, $kind: String!) {
    bmsImprovementDetail(id: $id, kind: $kind)
  }
`;
const WEEK = gql`
  query OperationWeeklyReport($from: String!, $locationId: ID) {
    bmsOperationWeeklyReport(from: $from, locationId: $locationId)
  }
`;
const COMMAND = gql`
  mutation ImprovementCommand($input: BmsImprovementInput!) {
    bmsImprovementCommand(input: $input) {
      status
      id
      version
    }
  }
`;
const SOURCES = gql`
  query ImprovementSources($filter: BmsImprovementFilter) {
    bmsImprovementSources(filter: $filter)
  }
`;
const CATALOG = gql`
  query ImprovementCatalog($kind: String!, $locationId: ID!, $search: String) {
    bmsImprovementCatalog(kind: $kind, locationId: $locationId, search: $search)
  }
`;
const uuid = /^[a-f\d]{8}(?:-[a-f\d]{4}){3}-[a-f\d]{12}$/i;
export default function ImprovementPanel({
  locationId,
  locations,
  templates,
  staff,
  onOpenRun,
}: {
  locationId?: string;
  locations: any[];
  templates: any[];
  staff: any[];
  onOpenRun: (id: string) => void;
}) {
  const { t } = useI18n(),
    tr = (k: string) => t(`operation_improvement.${k}`),
    { can } = useBmsPermissions();
  const [search, setSearch] = useState(""),
    term = useDeferredValue(search),
    [page, setPage] = useState(1),
    [tab, setTab] = useState("standards"),
    [readinessRevision, setReadinessRevision] = useState(0);
  const [selected, setSelected] = useState<{ id: string; kind: string }>(),
    [dialog, setDialog] = useState<any>(),
    [pending, setPending] = useState<any>(),
    [form] = Form.useForm();
  const [from, setFrom] = useState(""),
    [sourceSearch, setSourceSearch] = useState(""),
    sourceTerm = useDeferredValue(sourceSearch);
  const [catalogSearch, setCatalogSearch] = useState(""),
    catalogTerm = useDeferredValue(catalogSearch),
    formLocation = Form.useWatch("locationId", form),
    sourceType = Form.useWatch("sourceType", form);
  const catalog = useQuery(CATALOG, {
    variables: {
      kind:
        dialog?.action === "CREATE_FOLLOWUP"
          ? "FOLLOWUP"
          : (sourceType ?? "CHECKLIST"),
      locationId: dialog?.row?.location_id ?? formLocation,
      search: catalogTerm,
    },
    skip:
      !["PUBLISH_STANDARD", "CREATE_FOLLOWUP"].includes(dialog?.action) ||
      !(dialog?.row?.location_id ?? formLocation),
    fetchPolicy: "network-only",
  });
  const q = useQuery(WORK, {
    variables: {
      filter: { locationId, search: term, offset: (page - 1) * 25 },
    },
    fetchPolicy: "network-only",
  });
  const detail = useQuery(DETAIL, {
      variables: selected,
      skip: !selected,
      fetchPolicy: "network-only",
    }),
    d = detail.data?.bmsImprovementDetail,
    w = q.data?.bmsImprovementWorkspace;
  const report = useQuery(WEEK, {
      variables: { from, locationId },
      skip:
        !/^\d{4}-\d{2}-\d{2}$/.test(from) ||
        tab !== "weekly" ||
        !can("operations.summary.review") ||
        !can("report.view"),
      fetchPolicy: "network-only",
    }),
    r = report.data?.bmsOperationWeeklyReport;
  const sources = useQuery(SOURCES, {
    variables: {
      filter: {
        locationId: dialog?.row?.location_id ?? locationId,
        search: sourceTerm,
      },
    },
    skip: !["CREATE_ISSUE", "LINK_FAILURE"].includes(dialog?.action),
    fetchPolicy: "network-only",
  });
  const refresh = async () => {
    await q.refetch();
    if (selected) await detail.refetch();
    setReadinessRevision((n) => n + 1);
    if (r) await report.refetch();
  };
  const m = useTeamCommand(
      refresh,
      () => {
        setDialog(undefined);
        setPending(undefined);
      },
      { document: COMMAND, field: "bmsImprovementCommand" },
    ),
    blocked = m.busy || m.uncertain;
  const person = (id: string) => staff.find((x) => x.id === id)?.name ?? id,
    branch = (id: string) => locations.find((x) => x.id === id)?.name ?? id;
  const open = (action: string, row: any = {}) => {
    form.resetFields();
    setPending(undefined);
    setSourceSearch("");
    setCatalogSearch("");
    setDialog({ action, row });
  };
  useEffect(() => {
    if (!dialog) return;
    const row = dialog.row;
    form.setFieldsValue({
      locationId: row.location_id ?? locationId,
      dutyKey: row.duty_key,
      title: row.title,
      body: row.body,
      sourceType: row.source?.type ?? "CHECKLIST",
      sourceId: row.source?.id,
      trainingRequired: row.training_required ?? true,
      carryAcknowledgement: false,
      carryTraining: false,
      category: row.category,
      severity: row.severity ?? "MEDIUM",
      ownerId: row.owner_id,
      hypothesis: row.hypothesis,
      cause: row.cause,
    });
  }, [dialog, form, locationId]);
  const prepare = async () => {
    const values = await form.validateFields();
    const a = dialog.action,
      row = dialog.row;
    const input: any = { action: a, confirmed: true, ...values };
    if (a === "PUBLISH_STANDARD") {
      input.version = row.version ?? 0;
      if (row.family_id) input.familyId = row.family_id;
    } else if (a === "CONFIRM_WEEK") {
      input.locationId = locationId;
      input.from = from;
      input.version =
        r?.reviews?.find((x: any) => x.location_id === locationId)?.version ??
        0;
      input.fingerprint = r.fingerprint;
    } else if (a !== "CREATE_ISSUE") {
      input.id = row.id;
      input.version = row.version;
    }
    if (input.dueAt) input.dueAt = new Date(input.dueAt).toISOString();
    if (input.weeklyReviewId === "") delete input.weeklyReviewId;
    setPending(input);
  };
  const field = (name: string, required = false, multiline = false) => (
    <Form.Item name={name} label={tr(name)} rules={[{ required }]}>
      <Input.TextArea
        aria-label={tr(name)}
        maxLength={name === "body" ? 10000 : 2000}
        rows={multiline ? 4 : 1}
      />
    </Form.Item>
  );
  const idField = (name: string, required = true) => (
    <Form.Item
      name={name}
      label={tr(name)}
      rules={[{ required, pattern: uuid }]}
    >
      <Input aria-label={tr(name)} />
    </Form.Item>
  );
  const staffField = (name: string) => (
    <Form.Item name={name} label={tr(name)} rules={[{ required: true }]}>
      <Select
        aria-label={tr(name)}
        showSearch
        optionFilterProp="label"
        options={staff.map((x) => ({ value: x.id, label: x.name }))}
      />
    </Form.Item>
  );
  const detailButton = (id: string, kind: string, label = tr("detail")) => (
    <Button onClick={() => setSelected({ id, kind })}>{label}</Button>
  );
  const runButton = (id: string) => (
    <Button onClick={() => onOpenRun(id)}>{tr("open_run")}</Button>
  );
  const weeklyView = (data: any) => (
    <WeeklyOperationsReport
      data={data}
      locations={locations}
      staff={staff}
      onOpenRun={onOpenRun}
    />
  );
  return (
    <Space direction="vertical" style={{ width: "100%" }}>
      <Alert closable type="info" message={tr("scope_hint")} />
      <Space wrap>
        <Input.Search
          aria-label={tr("search")}
          placeholder={tr("search")}
          value={search}
          onChange={(e) => {
            setSearch(e.target.value);
            setPage(1);
          }}
        />
        <Button disabled={blocked} onClick={refresh}>
          {tr("refresh")}
        </Button>
      </Space>
      {(q.error ||
        detail.error ||
        report.error ||
        sources.error ||
        catalog.error) && (
        <Alert closable type="error" message={tr("load_error")} />
      )}
      <Tabs
        activeKey={tab}
        onChange={(k) => {
          setTab(k);
          setPage(1);
        }}
        items={[
          {
            key: "standards",
            label: tr("standards"),
            children: (
              <>
                <Space wrap>
                  {can("operations.standard.manage") && (
                    <Button
                      disabled={blocked}
                      onClick={() => open("PUBLISH_STANDARD")}
                    >
                      {tr("PUBLISH_STANDARD")}
                    </Button>
                  )}
                </Space>
                <Table
                  loading={q.loading}
                  rowKey="id"
                  dataSource={w?.standards ?? []}
                  scroll={{ x: 650 }}
                  pagination={{
                    current: page,
                    total: w?.standardTotal ?? 0,
                    pageSize: 25,
                    onChange: setPage,
                    showSizeChanger: false,
                  }}
                  columns={[
                    { title: tr("title"), dataIndex: "title" },
                    {
                      title: tr("locationId"),
                      render: (_: any, x: any) => branch(x.location_id),
                    },
                    { title: tr("dutyKey"), dataIndex: "duty_key" },
                    { title: tr("version"), dataIndex: "version" },
                    {
                      title: tr("detail"),
                      render: (_: any, x: any) =>
                        detailButton(x.id, "STANDARD"),
                    },
                  ]}
                />
              </>
            ),
          },
          ...(can("operations.improvement.manage") ||
          can("operations.checklist.review") ||
          can("operations.summary.review")
            ? [
                {
                  key: "issues",
                  label: tr("issues"),
                  children: (
                    <>
                      {can("operations.improvement.manage") && (
                        <Button
                          disabled={blocked}
                          onClick={() => open("CREATE_ISSUE")}
                        >
                          {tr("CREATE_ISSUE")}
                        </Button>
                      )}
                      <Table
                        loading={q.loading}
                        rowKey="id"
                        dataSource={w?.issues ?? []}
                        scroll={{ x: 750 }}
                        pagination={{
                          current: page,
                          total: w?.issueTotal ?? 0,
                          pageSize: 25,
                          onChange: setPage,
                          showSizeChanger: false,
                        }}
                        columns={[
                          { title: tr("title"), dataIndex: "title" },
                          { title: tr("category"), dataIndex: "category" },
                          { title: tr("severity"), dataIndex: "severity" },
                          {
                            title: tr("ownerId"),
                            render: (_: any, x: any) => person(x.owner_id),
                          },
                          {
                            title: tr("status"),
                            render: (_: any, x: any) => (
                              <>
                                {x.status}
                                {x.status === "CLOSED" && x.needs_followup && (
                                  <Tag color="warning">
                                    {tr("reopen_warning")}
                                  </Tag>
                                )}
                              </>
                            ),
                          },
                          {
                            title: tr("detail"),
                            render: (_: any, x: any) =>
                              detailButton(x.id, "ISSUE"),
                          },
                        ]}
                      />
                    </>
                  ),
                },
              ]
            : []),
          ...(can("operations.summary.review") && can("report.view")
            ? [
                {
                  key: "weekly",
                  label: tr("weekly"),
                  children: (
                    <>
                      <Alert closable type="info" message={tr("cohort_hint")} />
                      <Space wrap>
                        <label>
                          {tr("from")}{" "}
                          <Input
                            aria-label={tr("from")}
                            type="date"
                            value={from}
                            onChange={(e) => setFrom(e.target.value)}
                          />
                        </label>
                        {locationId && r && (
                          <Button
                            disabled={blocked || report.loading}
                            onClick={() => open("CONFIRM_WEEK")}
                          >
                            {tr("CONFIRM_WEEK")}
                          </Button>
                        )}
                      </Space>
                      {report.loading ? (
                        <Spin />
                      ) : (
                        r && (
                          <>
                            {r.reviews.map((x: any) => (
                              <p key={x.id}>
                                {branch(x.location_id)} · {tr("version")}{" "}
                                {x.version}{" "}
                                <Tag color={x.changed ? "warning" : "success"}>
                                  {tr(x.changed ? "changed" : "unchanged")}
                                </Tag>
                                {detailButton(
                                  x.id,
                                  "REVIEW",
                                  tr("saved_snapshot"),
                                )}
                              </p>
                            ))}
                            {weeklyView(r)}
                          </>
                        )
                      )}
                    </>
                  ),
                },
              ]
            : []),
        ]}
      />
      <Drawer
        open={!!selected}
        onClose={() => {
          if (!blocked) setSelected(undefined);
        }}
        width={960}
        title={tr("detail")}
        destroyOnClose
      >
        {detail.loading ? (
          <Spin />
        ) : (
          d && (
            <Space direction="vertical" style={{ width: "100%" }}>
              <Typography.Title level={4}>
                {d.title ?? tr("saved_snapshot")} · v{d.version}
              </Typography.Title>
              {selected?.kind === "STANDARD" && (
                <>
                  <p>
                    {branch(d.location_id)} · {d.duty_key} · {d.status}
                  </p>
                  <Typography.Paragraph style={{ whiteSpace: "pre-wrap" }}>
                    {d.body}
                  </Typography.Paragraph>
                  <p>
                    {tr("sourceId")}: {d.source.type} / {d.source.id} · v
                    {d.source.version}
                  </p>
                  <details>
                    <summary>{tr("pinned_source")}</summary>
                    <pre
                      style={{
                        whiteSpace: "pre-wrap",
                        overflowWrap: "anywhere",
                      }}
                    >
                      {JSON.stringify(d.source, null, 2)}
                    </pre>
                  </details>
                  <StandardReadiness
                    key={`${d.id}:${readinessRevision}`}
                    locationId={d.location_id}
                    staffId={w?.actorId}
                    dutyKey={d.duty_key}
                  />
                  {d.status === "ACTIVE" && (
                    <Space wrap>
                      <Button
                        disabled={blocked}
                        onClick={() => open("ACK_STANDARD", d)}
                      >
                        {tr("ACK_STANDARD")}
                      </Button>
                      {can("operations.standard.assess") &&
                        d.training_required && (
                          <Button
                            disabled={blocked}
                            onClick={() => open("ASSESS_STANDARD", d)}
                          >
                            {tr("ASSESS_STANDARD")}
                          </Button>
                        )}
                      {can("operations.standard.manage") && (
                        <Button
                          disabled={blocked}
                          onClick={() => open("PUBLISH_STANDARD", d)}
                        >
                          {tr("new_version")}
                        </Button>
                      )}
                    </Space>
                  )}
                  <Table
                    rowKey="id"
                    dataSource={d.learning}
                    scroll={{ x: 600 }}
                    columns={[
                      {
                        title: tr("staffId"),
                        render: (_: any, x: any) => person(x.staff_id),
                      },
                      { title: tr("outcome"), dataIndex: "kind" },
                      { title: tr("note"), dataIndex: "evidence" },
                      {
                        title: tr("actor"),
                        render: (_: any, x: any) => person(x.actor),
                      },
                      { title: tr("created_at"), dataIndex: "created_at" },
                    ]}
                  />
                  {d.status === "ACTIVE" &&
                    d.training_required &&
                    can("operations.standard.assess") && (
                      <Button
                        disabled={blocked}
                        onClick={() => open("RECORD_TRAINING", d)}
                      >
                        {tr("RECORD_TRAINING")}
                      </Button>
                    )}
                  <Space wrap>
                    {d.versions.map((x: any) => (
                      <span key={x.id}>
                        {detailButton(
                          x.id,
                          "STANDARD",
                          `v${x.version} · ${x.status}`,
                        )}
                      </span>
                    ))}
                  </Space>
                </>
              )}
              {selected?.kind === "ISSUE" && (
                <>
                  <p>
                    {branch(d.location_id)} · {d.category} · {d.severity} ·{" "}
                    {d.status} · {person(d.owner_id)}
                  </p>
                  <p>
                    {tr("hypothesis")}: {d.hypothesis || "—"}
                  </p>
                  <p>
                    {tr("cause")}: {d.cause || "—"}
                  </p>
                  <Space wrap>
                    {can("operations.improvement.manage") &&
                      (d.status === "OPEN"
                        ? [
                            "UPDATE_ISSUE",
                            "LINK_FAILURE",
                            ...(can("operations.checklist.manage")
                              ? ["CREATE_FOLLOWUP"]
                              : []),
                          ]
                        : ["REOPEN_ISSUE"]
                      ).map((a) => (
                        <Button
                          key={a}
                          disabled={blocked}
                          onClick={() => open(a, d)}
                        >
                          {tr(a)}
                        </Button>
                      ))}
                    {can("operations.checklist.review") &&
                      d.status === "OPEN" && (
                        <Button
                          disabled={blocked}
                          onClick={() => open("CLOSE_ISSUE", d)}
                        >
                          {tr("CLOSE_ISSUE")}
                        </Button>
                      )}
                  </Space>
                  <Alert closable type="info" message={tr("close_hint")} />
                  <Table
                    rowKey="id"
                    dataSource={d.sources}
                    scroll={{ x: 600 }}
                    columns={[
                      {
                        title: tr("sourceId"),
                        render: (_: any, x: any) => runButton(x.run_id),
                      },
                      { title: tr("item"), dataIndex: "item_key" },
                      { title: tr("status"), dataIndex: "status" },
                      { title: tr("dueAt"), dataIndex: "due_at" },
                    ]}
                  />
                  <Table
                    rowKey="run_id"
                    dataSource={d.followups}
                    scroll={{ x: 700 }}
                    columns={[
                      { title: tr("target"), dataIndex: "target" },
                      { title: tr("status"), dataIndex: "status" },
                      {
                        title: tr("assignedTo"),
                        render: (_: any, x: any) => person(x.assigned_to),
                      },
                      { title: tr("dueAt"), dataIndex: "due_at" },
                      {
                        title: tr("detail"),
                        render: (_: any, x: any) => (
                          <Space wrap>
                            {runButton(x.run_id)}
                            {x.weekly_review_id &&
                              can("operations.summary.review") &&
                              can("report.view") &&
                              detailButton(
                                x.weekly_review_id,
                                "REVIEW",
                                tr("saved_snapshot"),
                              )}
                            <details>
                              <summary>{tr("baseline")}</summary>
                              <p>
                                {x.baseline.issue.cause || "—"} ·{" "}
                                {x.baseline.issue.status} · v
                                {x.baseline.issue.version}
                              </p>
                            </details>
                          </Space>
                        ),
                      },
                    ]}
                  />
                </>
              )}
              {selected?.kind === "REVIEW" && (
                <>
                  <Alert closable type="info" message={tr("immutable_hint")} />
                  <p>
                    {d.id} · {d.note} · {person(d.reviewed_by)}
                  </p>
                  {weeklyView(d.snapshot)}
                  {can("operations.improvement.manage") &&
                    can("operations.checklist.manage") && (
                      <p>
                        {tr("review_task_hint")}{" "}
                        {d.snapshot.branches
                          .flatMap((b: any) => b.sources.issues)
                          .map((x: any) => (
                            <span key={x.id}>
                              {detailButton(x.id, "ISSUE", x.title)}{" "}
                            </span>
                          ))}
                      </p>
                    )}
                </>
              )}
              {d.historyTruncated && (
                <Alert closable type="warning" message={tr("history_limit")} />
              )}
              <Table
                rowKey="id"
                dataSource={d.history ?? []}
                scroll={{ x: 600 }}
                columns={[
                  { title: tr("action"), dataIndex: "action" },
                  {
                    title: tr("actor"),
                    render: (_: any, x: any) => person(x.actor),
                  },
                  { title: tr("note"), dataIndex: "note" },
                  { title: tr("created_at"), dataIndex: "created_at" },
                ]}
              />
            </Space>
          )
        )}
      </Drawer>
      <Modal
        open={!!dialog}
        zIndex={2000}
        title={dialog ? tr(dialog.action) : ""}
        width={680}
        onCancel={() => {
          if (!blocked) {
            setDialog(undefined);
            setPending(undefined);
          }
        }}
        maskClosable={false}
        footer={
          <Space>
            <Button
              disabled={blocked}
              onClick={() => {
                setDialog(undefined);
                setPending(undefined);
              }}
            >
              {tr("cancel")}
            </Button>
            <Button
              disabled={blocked}
              onClick={() => prepare().catch(() => {})}
            >
              {tr("preview")}
            </Button>
          </Space>
        }
        forceRender
      >
        <Form form={form} layout="vertical" name="operationImprovementCommand">
          {dialog?.action === "PUBLISH_STANDARD" && (
            <>
              <Form.Item
                name="locationId"
                label={tr("locationId")}
                rules={[{ required: true }]}
              >
                <Select
                  disabled={!!dialog.row.id}
                  aria-label={tr("locationId")}
                  options={locations.map((x) => ({
                    value: x.id,
                    label: x.name,
                  }))}
                />
              </Form.Item>
              {field("dutyKey", true)}
              {field("title", true)}
              {field("body", true, true)}
              <Form.Item name="sourceType" label={tr("sourceType")}>
                <Select
                  aria-label={tr("sourceType")}
                  options={[
                    { value: "CHECKLIST", label: tr("runs") },
                    ...(can("product.view")
                      ? [{ value: "RECIPE", label: tr("recipe") }]
                      : []),
                  ]}
                />
              </Form.Item>
              <Form.Item
                name="sourceId"
                label={tr("sourceId")}
                rules={[{ required: true }]}
              >
                <Select
                  showSearch
                  filterOption={false}
                  onSearch={setCatalogSearch}
                  loading={catalog.loading}
                  aria-label={tr("sourceId")}
                  options={(
                    catalog.data?.bmsImprovementCatalog?.rows ?? []
                  ).map((x: any) => ({
                    value: x.id,
                    label: `${x.name} · v${x.version}`,
                  }))}
                />
              </Form.Item>
              <p>{tr("source_hint")}</p>
              {[
                "trainingRequired",
                "carryAcknowledgement",
                "carryTraining",
              ].map((k) => (
                <Form.Item
                  key={k}
                  name={k}
                  label={tr(k)}
                  valuePropName="checked"
                >
                  <Switch />
                </Form.Item>
              ))}
              <Alert closable type="warning" message={tr("carry_hint")} />
            </>
          )}
          {dialog?.action === "RECORD_TRAINING" && staffField("staffId")}
          {dialog?.action === "ASSESS_STANDARD" && (
            <>
              {staffField("staffId")}
              <Form.Item
                name="outcome"
                label={tr("outcome")}
                rules={[{ required: true }]}
              >
                <Select
                  options={[
                    { value: "PASS", label: tr("passed") },
                    { value: "PRACTICE", label: tr("practice") },
                  ]}
                  aria-label={tr("outcome")}
                />
              </Form.Item>
            </>
          )}
          {["CREATE_ISSUE", "LINK_FAILURE"].includes(dialog?.action) && (
            <>
              <Form.Item
                name="actionId"
                label={tr("actionId")}
                rules={[{ required: true }]}
              >
                <Select
                  showSearch
                  filterOption={false}
                  onSearch={setSourceSearch}
                  loading={sources.loading}
                  aria-label={tr("actionId")}
                  options={(
                    sources.data?.bmsImprovementSources?.rows ?? []
                  ).map((x: any) => ({
                    value: x.id,
                    label: `${branch(x.location_id)} · ${x.name} / ${x.item_key} · ${x.status}`,
                  }))}
                />
              </Form.Item>
              <p>{tr("source_search_hint")}</p>
            </>
          )}
          {["CREATE_ISSUE", "UPDATE_ISSUE"].includes(dialog?.action) && (
            <>
              {field("title", true)}
              {field("category", true)}
              <Form.Item
                name="severity"
                label={tr("severity")}
                rules={[{ required: true }]}
              >
                <Select
                  options={["LOW", "MEDIUM", "HIGH", "CRITICAL"].map((x) => ({
                    value: x,
                    label: tr(x),
                  }))}
                  aria-label={tr("severity")}
                />
              </Form.Item>
              {staffField("ownerId")}
              {field("hypothesis", false, true)}
              {field("cause", false, true)}
            </>
          )}
          {dialog?.action === "CREATE_FOLLOWUP" && (
            <>
              <Form.Item
                name="templateId"
                label={tr("templateId")}
                rules={[{ required: true }]}
              >
                <Select
                  showSearch
                  filterOption={false}
                  onSearch={setCatalogSearch}
                  loading={catalog.loading}
                  options={(catalog.data?.bmsImprovementCatalog?.rows ?? [])
                    .filter(
                      (x: any) => x.status === "ACTIVE" && x.separate_reviewer,
                    )
                    .map((x: any) => ({
                      value: x.id,
                      label: `${x.name} · v${x.version}`,
                    }))}
                  aria-label={tr("templateId")}
                />
              </Form.Item>
              <p>{tr("source_hint")}</p>
              {staffField("assignedTo")}
              <Form.Item
                name="dueAt"
                label={tr("dueAt")}
                rules={[{ required: true }]}
              >
                <Input type="datetime-local" aria-label={tr("dueAt")} />
              </Form.Item>
              {field("target", true, true)}
              {idField("weeklyReviewId", false)}
              <p>{tr("review_link_hint")}</p>
            </>
          )}
          {dialog?.action === "CONFIRM_WEEK" && (
            <p>
              {branch(locationId!)} · {from} · {tr("as_of")} {r?.asOf}
            </p>
          )}
          {field("note", dialog?.action !== "ACK_STANDARD", true)}
        </Form>
      </Modal>
      <Modal
        open={!!pending}
        title={tr("confirm_title")}
        onCancel={() => {
          if (!blocked) setPending(undefined);
        }}
        maskClosable={false}
        onOk={() => m.command(pending)}
        confirmLoading={m.busy}
        okButtonProps={{ disabled: blocked }}
        cancelButtonProps={{ disabled: blocked }}
        zIndex={2500}
      >
        <Alert closable type="warning" message={tr("confirm_hint")} />
        <dl>
          {pending &&
            Object.entries(pending)
              .filter(([k]) => k !== "confirmed")
              .map(([k, v]) => (
                <div key={k}>
                  <dt>{tr(k)}</dt>
                  <dd
                    style={{ whiteSpace: "pre-wrap", overflowWrap: "anywhere" }}
                  >
                    {String(v ?? "")}
                  </dd>
                </div>
              ))}
        </dl>
      </Modal>
      {m.retry}
    </Space>
  );
}
