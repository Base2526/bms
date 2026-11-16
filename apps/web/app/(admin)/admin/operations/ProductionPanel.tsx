"use client";

import { useUiText } from "@/lib/useUiText";
import { gql, useApolloClient, useQuery } from "@apollo/client";
import { useDeferredValue, useState, useEffect } from "react";
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
  Tag,
  message,
} from "antd";
import { useI18n } from "@/lib/i18nContext";
import { useBmsPermissions } from "@/app/hooks/useBmsPermissions";
import { useTeamCommand } from "@/components/operations/useTeamCommand";
import styles from "./operations.module.css";
const WORK = gql`
  query ProductionWorkspace($filter: BmsProductionFilter) {
    bmsProductionWorkspace(filter: $filter)
  }
`;
const DETAIL = gql`
  query ProductionDetail($id: ID!) {
    bmsProductionDetail(id: $id)
  }
`;
const PREVIEW = gql`
  query ProductionPreview($input: BmsProductionPreviewInput!) {
    bmsProductionPreview(input: $input)
  }
`;
const COMMAND = gql`
  mutation ProductionCommand($input: BmsProductionInput!) {
    bmsProductionCommand(input: $input) {
      status
      id
      version
    }
  }
`;
const FOR_RUN = gql`
  query ProductionForRun($id: ID!) {
    bmsProductionForRun(id: $id)
  }
`;
const QC_POLICY = gql`
  query FactoryQcPolicy($locationId: ID!, $sku: String!, $size: String!) {
    bmsFactoryQcPolicy(locationId: $locationId, sku: $sku, size: $size)
  }
`;
const SET_QC_POLICY = gql`
  mutation SetFactoryQcPolicy($input: BmsFactoryQcPolicyInput!) {
    bmsSetFactoryQcPolicy(input: $input) { status version }
  }
`;
const BOM_DETAIL = gql`
  query FactoryBomDetail($id: ID!) { bmsFactoryBomDetail(id: $id) }
`;
const SAVE_BOM = gql`
  mutation SaveFactoryBom($input: BmsFactoryBomInput!) {
    bmsSaveFactoryBom(input: $input) { status id version }
  }
`;
const DEMANDS = gql`
  query FactoryDemands($locationId: ID, $search: String, $offset: Int) {
    bmsFactoryDemandWorkspace(locationId: $locationId, search: $search, offset: $offset)
  }
`;
const DEMAND_CUSTOMERS = gql`
  query FactoryDemandCustomers($search: String!) { bmsFactoryDemandCustomers(search: $search) }
`;
const DEMAND_COMMAND = gql`
  mutation FactoryDemandCommand($input: BmsFactoryDemandInput!) {
    bmsFactoryDemandCommand(input: $input) { status id version }
  }
`;
const MACHINES = gql`
  query FactoryMachines($locationId: ID!, $search: String) {
    bmsFactoryMachines(locationId: $locationId, search: $search)
  }
`;
const SAVE_MACHINE = gql`
  mutation SaveFactoryMachine($input: BmsFactoryMachineInput!) {
    bmsSaveFactoryMachine(input: $input) { status id version }
  }
`;
type CatalogOption = { value: string; label: string };
function withSelection(options: CatalogOption[], selected?: CatalogOption) {
  return selected && !options.some((x) => x.value === selected.value)
    ? [selected, ...options]
    : options;
}
export function ProductionRunLink({ runId }: { runId: string }) {
  const { can } = useBmsPermissions(),
    { t } = useI18n(),
    q = useQuery(FOR_RUN, {
      variables: { id: runId },
      skip: !can("product.view"),
    });
  return q.data?.bmsProductionForRun ? (
    <Button href={`/admin/operations?production=${q.data.bmsProductionForRun}`}>
      {t("operation_production.detail")}
    </Button>
  ) : null;
}
export default function ProductionPanel({
  locationId,
  templates,
  staff,
  onOpenRun,
}: {
  locationId?: string;
  templates: any[];
  staff: any[];
  onOpenRun: (id: string) => void;
}) {
  const uiText = useUiText();
  const { t } = useI18n(),
    tr = (k: string) => t(`operation_production.${k}`),
    { can } = useBmsPermissions(),
    client = useApolloClient();
  const [search, setSearch] = useState(""),
    term = useDeferredValue(search),
    [page, setPage] = useState(1),
    [mine, setMine] = useState(false),
    [status, setStatus] = useState("");
  const [from, setFrom] = useState(""),
    [to, setTo] = useState("");
  const [recipeSearch, setRecipeSearch] = useState(""),
    recipeTerm = useDeferredValue(recipeSearch),
    [outputSearch, setOutputSearch] = useState(""),
    outputTerm = useDeferredValue(outputSearch),
    [recipeOption, setRecipeOption] = useState<CatalogOption>(),
    [outputOption, setOutputOption] = useState<CatalogOption>();
  const [selected, setSelected] = useState<string>(),
    [editor, setEditor] = useState<"CREATE" | "POST" | "WASTE" | null>(null),
    [pending, setPending] = useState<any>(null),
    [preview, setPreview] = useState<any>(null),
    [previewing, setPreviewing] = useState(false),
    [form] = Form.useForm();
  const [bomForm] = Form.useForm();
  const [demandForm] = Form.useForm();
  const [machineForm] = Form.useForm();
  const [bomOpen, setBomOpen] = useState(false),
    [bomPending, setBomPending] = useState<any>(null),
    [bomOutputOption, setBomOutputOption] = useState<CatalogOption>();
  const [demandOpen, setDemandOpen] = useState(false),
    [demandCreate, setDemandCreate] = useState(false),
    [demandPending, setDemandPending] = useState<any>(null),
    [demandSearch, setDemandSearch] = useState(""),
    demandTerm = useDeferredValue(demandSearch),
    [demandPage, setDemandPage] = useState(1),
    [customerSearch, setCustomerSearch] = useState("");
  const [machineOpen, setMachineOpen] = useState(false),
    [machinePending, setMachinePending] = useState<any>(null),
    [machineSearch, setMachineSearch] = useState("");
  const machineTerm = useDeferredValue(machineSearch);
  const customerTerm = useDeferredValue(customerSearch);
  const [qcOpen, setQcOpen] = useState(false),
    [qcOutput, setQcOutput] = useState<string>(),
    [qcRequired, setQcRequired] = useState(false),
    [qcDueMinutes, setQcDueMinutes] = useState(1440),
    [qcReviewerId, setQcReviewerId] = useState<string>(),
    [qcPending, setQcPending] = useState<any>(null);
  const qcIdentity = qcOutput ? JSON.parse(qcOutput) as [string, string] : null;
  const qcPolicy = useQuery(QC_POLICY, {
    variables: { locationId: locationId ?? "", sku: qcIdentity?.[0] ?? "", size: qcIdentity?.[1] ?? "" },
    skip: !qcOpen || !locationId || !qcIdentity,
    fetchPolicy: "network-only",
  });
  useEffect(() => {
    const policy = qcPolicy.data?.bmsFactoryQcPolicy;
    if (!policy) return;
    setQcRequired(policy.required === true);
    setQcDueMinutes(policy.dueMinutes ?? 1440);
    setQcReviewerId(policy.reviewerId ?? undefined);
  }, [qcPolicy.data]);
  useEffect(() => {
    const id = new URLSearchParams(window.location.search).get("production");
    if (id) setSelected(id);
  }, []);
  const q = useQuery(WORK, {
    variables: {
      filter: {
        locationId,
        search: term,
        recipeSearch: recipeTerm,
        outputSearch: outputTerm,
        offset: (page - 1) * 25,
        mine,
        status,
        ...(from && to ? { from, to } : {}),
      },
    },
    skip: !can("product.view"),
    fetchPolicy: "network-only",
  });
  const demands = useQuery(DEMANDS, {
    variables: { locationId, search: demandTerm, offset: (demandPage - 1) * 25 },
    skip: !locationId || !can("operations.production.manage") ||
      !can("order.create") || !can("customer.view") ||
      (!demandOpen && editor !== "CREATE"),
    fetchPolicy: "network-only",
  });
  const customers = useQuery(DEMAND_CUSTOMERS, {
    variables: { search: customerTerm },
    skip: !demandCreate || !can("customer.view"), fetchPolicy: "network-only",
  });
  const machines = useQuery(MACHINES, {
    variables: { locationId: locationId ?? "", search: machineTerm },
    skip: !locationId || !can("operations.production.manage"),
    fetchPolicy: "network-only",
  });
  const detail = useQuery(DETAIL, {
      variables: { id: selected },
      skip: !selected,
      fetchPolicy: "network-only",
    }),
    w = q.data?.bmsProductionWorkspace,
    d = detail.data?.bmsProductionDetail;
  const m = useTeamCommand(
    async () => {
      await q.refetch();
      if (selected) await detail.refetch();
    },
    () => {
      setEditor(null);
      setPending(null);
      setPreview(null);
    },
    { document: COMMAND, field: "bmsProductionCommand" },
  );
  const qcCommand = useTeamCommand(
    async () => { await qcPolicy.refetch(); await q.refetch(); },
    () => { setQcPending(null); setQcOpen(false); },
    { document: SET_QC_POLICY, field: "bmsSetFactoryQcPolicy" },
  );
  const bomCommand = useTeamCommand(
    async () => { await q.refetch(); },
    () => { setBomPending(null); setBomOpen(false); bomForm.resetFields(); },
    { document: SAVE_BOM, field: "bmsSaveFactoryBom" },
  );
  const demandCommand = useTeamCommand(
    async () => { await demands.refetch(); await q.refetch(); },
    () => { setDemandPending(null); setDemandCreate(false); demandForm.resetFields(); },
    { document: DEMAND_COMMAND, field: "bmsFactoryDemandCommand" },
  );
  const machineCommand = useTeamCommand(
    async () => { await machines.refetch(); },
    () => { setMachinePending(null); machineForm.resetFields(); },
    { document: SAVE_MACHINE, field: "bmsSaveFactoryMachine" },
  );
  const blocked = m.busy || m.uncertain || previewing;
  function open(kind: "CREATE" | "POST" | "WASTE") {
    setRecipeSearch("");
    setOutputSearch("");
    setRecipeOption(undefined);
    setOutputOption(undefined);
    setPreview(null);
    setPending(null);
    form.resetFields();
    setEditor(kind);
    if (kind === "POST")
      form.setFieldsValue({
        actualQty: d.planned_qty,
        ingredients: d.snapshot.ingredients.map((x: any) => ({
          sku: x.sku,
          size: x.size,
          qty: x.qty,
        })),
        producedOn: new Date().toLocaleDateString("en-CA", {
          timeZone: "Asia/Bangkok",
        }),
      });
    if (kind === "CREATE") form.setFieldsValue({ plannedQty: 1 });
  }
  async function review(values: any) {
    if (blocked) return;
    let input: any;
    try {
      if (editor === "CREATE") {
        const [outputSku, outputSize] = JSON.parse(values.output),
          dueAt = new Date(values.dueAt).toISOString();
        const source = values.recipeId.startsWith("F:")
          ? { factoryBomId: values.recipeId.slice(2) }
          : { recipeId: values.recipeId };
        input = {
          action: "CREATE",
          locationId,
          templateId: values.templateId,
          ...source,
          plannedQty: values.plannedQty,
          factoryDemandId: values.factoryDemandId || null,
          machineId: values.machineId || null,
          outputSku,
          outputSize,
          dueAt,
          ...(values.dutyKey
            ? { dutyKey: values.dutyKey }
            : { assignedTo: values.assignedTo || null }),
          note: values.note,
          confirmed: true,
        };
        setPreviewing(true);
        const result = await client.query({
          query: PREVIEW,
          variables: {
            input: {
              locationId,
              ...source,
              plannedQty: values.plannedQty,
              outputSku,
              outputSize,
            },
          },
          fetchPolicy: "network-only",
        });
        setPreview(result.data.bmsProductionPreview);
      } else
        input = {
          action: editor,
          id: d.id,
          version: d.version,
          confirmed: true,
          ...values,
          ...(editor === "POST" ? {
            startedAt: values.startedAt ? new Date(values.startedAt).toISOString() : null,
            endedAt: values.endedAt ? new Date(values.endedAt).toISOString() : null,
          } : {}),
        };
      setPending(input);
    } catch {
      message.error(tr("failed"));
    } finally {
      setPreviewing(false);
    }
  }
  async function loadBom(id: string) {
    try {
      const result = await client.query({ query: BOM_DETAIL, variables: { id }, fetchPolicy: "network-only" });
      const bom = result.data.bmsFactoryBomDetail;
      const output = JSON.stringify([bom.output_sku, bom.output_size]);
      setBomOutputOption({ value: output, label: `${bom.output_sku} / ${bom.output_size}` });
      bomForm.setFieldsValue({
        output, outputQty: bom.output_qty,
        ingredients: bom.ingredients.map((x: any) => ({
          product: JSON.stringify([x.sku, x.size]), qty: x.qty,
        })),
        sopSteps: bom.sop_steps.join("\n"),
      });
    } catch { message.error(tr("failed")); }
  }
  if (!can("product.view"))
    return <Alert closable type="warning" message={tr("permission")} />;
  return (
    <Space direction="vertical" style={{ width: "100%" }} size="middle">
      <Alert
        closable
        type="info"
        showIcon
        message={tr("hint")}
        description={tr("scope")}
      />
      {!locationId && (
        <Alert closable type="warning" message={tr("choose_branch")} />
      )}
      {(q.error || detail.error) && (
        <Alert closable type="error" message={tr("failed")} />
      )}
      <Space wrap>
        <label>
          {tr("from")}
          <Input
            type="date"
            aria-label={tr("from")}
            value={from}
            onChange={(e) => {
              setFrom(e.target.value);
              setPage(1);
            }}
          />
        </label>
        <label>
          {tr("to")}
          <Input
            type="date"
            aria-label={tr("to")}
            value={to}
            onChange={(e) => {
              setTo(e.target.value);
              setPage(1);
            }}
          />
        </label>
        <Input
          aria-label={tr("search")}
          placeholder={tr("search")}
          value={search}
          onChange={(e) => {
            setSearch(e.target.value);
            setPage(1);
          }}
          style={{ width: 240 }}
        />
        <Select
          aria-label={tr("status")}
          value={status}
          style={{ width: 170 }}
          options={["", "DRAFT", "READY", "POSTED", "CANCELLED"].map((x) => ({
            value: x,
            label: tr(x || "all"),
          }))}
          onChange={(v) => {
            setStatus(v);
            setPage(1);
          }}
        />
        <Space>
          <Switch
            checked={mine}
            onChange={(v) => {
              setMine(v);
              setPage(1);
            }}
          />
          {tr("mine")}
        </Space>
        <Button
          onClick={() => q.refetch().catch(() => message.error(tr("failed")))}
        >
          {tr("refresh")}
        </Button>
        {can("operations.production.manage") &&
          can("operations.checklist.manage") && (
            <Button
              type="primary"
              disabled={!locationId || blocked}
              onClick={() => open("CREATE")}
            >
              {tr("create")}
            </Button>
          )}
        {can("operations.production.manage") && can("operations.quality.manage") && (
          <Button disabled={!locationId || blocked || qcCommand.busy || qcCommand.uncertain}
            onClick={() => { setQcOutput(undefined); setQcRequired(false); setQcReviewerId(undefined); setQcDueMinutes(1440); setQcOpen(true); }}>
            {tr("qc_policy")}
          </Button>
        )}
        {can("operations.production.manage") && can("product.edit") && (
          <Button disabled={blocked || bomCommand.busy || bomCommand.uncertain}
            onClick={() => { bomForm.resetFields(); setBomOutputOption(undefined); setBomPending(null); setBomOpen(true); }}>
            {tr("factory_bom")}
          </Button>
        )}
        {can("operations.production.manage") && can("order.create") && can("customer.view") && (
          <Button disabled={!locationId || blocked || demandCommand.busy || demandCommand.uncertain}
            onClick={() => { setDemandSearch(""); setDemandPage(1); setDemandOpen(true); }}>
            {tr("factory_demands")}
          </Button>
        )}
        {can("operations.production.manage") && (
          <Button disabled={!locationId || blocked || machineCommand.busy || machineCommand.uncertain}
            onClick={() => { machineForm.resetFields(); setMachineSearch(""); setMachineOpen(true); }}>
            {tr("machines")}
          </Button>
        )}
      </Space>
      {Boolean(from) !== Boolean(to) && (
        <Alert closable type="info" message={tr("date_hint")} />
      )}
      {w?.optionsTruncated && (
        <Alert closable type="warning" message={tr("truncated")} />
      )}
      <div className={styles.tableWrap}>
        <Table
          rowKey="id"
          loading={q.loading}
          dataSource={w?.rows ?? []}
          scroll={{ x: 850 }}
          pagination={{
            current: page,
            pageSize: 25,
            total: w?.total ?? 0,
            onChange: setPage,
            showSizeChanger: false,
          }}
          columns={[
            {
              title: tr("output"),
              dataIndex: "output_sku",
              render: (v: string, r: any) => (
                <Button type="link" onClick={() => setSelected(r.id)}>
                  {v} / {r.output_size}
                </Button>
              ),
            },
            { title: tr("planned"), dataIndex: "planned_qty" },
            {
              title: tr("actual"),
              dataIndex: "actual_qty",
              render: (v: any) => v ?? "—",
            },
            {
              title: tr("status"),
              dataIndex: "status",
              render: (v: string) => <Tag>{tr(v)}</Tag>,
            },
            {
              title: tr("due"),
              dataIndex: "due_at",
              render: (v: string) => new Date(v).toLocaleString(uiText.locale),
            },
            {
              title: tr("work"),
              render: (_: any, r: any) => (
                <Button onClick={() => onOpenRun(r.run_id)}>
                  {tr("open_work")}
                </Button>
              ),
            },
          ]}
        />
      </div>
      <Drawer
        width="min(860px, 100vw)"
        open={!!selected}
        onClose={() => !blocked && setSelected(undefined)}
        title={tr("detail")}
      >
        {detail.loading ? (
          <Spin />
        ) : (
          d && (
            <Space direction="vertical" style={{ width: "100%" }}>
              <h3>
                {d.output_sku} / {d.output_size} — {tr(d.status)}
              </h3>
              <p>
                {tr("batch")}: {d.id}
              </p>
              <p>
                {tr("recipe")}: {d.snapshot.recipeSku} v
                {d.snapshot.recipeVersion} · {tr("planned")}: {d.planned_qty} ·{" "}
                {tr("actual")}: {d.actual_qty ?? "—"}
              </p>
              {d.machine_id && <p>{tr("machine")}: {d.machine_id}</p>}
              {d.status === "POSTED" && <p>
                {tr("run_time")}: {d.started_at ? new Date(d.started_at).toLocaleString(uiText.locale) : "—"}
                {d.ended_at ? ` → ${new Date(d.ended_at).toLocaleString(uiText.locale)}` : ""} ·
                {tr("rejected_qty")}: {d.rejected_qty ?? "—"} ·
                {tr("labor_minutes")}: {d.labor_minutes ?? "—"} ·
                {tr("energy_kwh")}: {d.energy_kwh ?? "—"}
              </p>}
              <Button onClick={() => onOpenRun(d.run_id)}>
                {tr("open_work")}
              </Button>
              <Alert closable type="info" message={tr("independent")} />
              <Space wrap>
                {d.status === "DRAFT" &&
                  can("operations.production.manage") && (
                    <Button
                      disabled={blocked}
                      onClick={() =>
                        setPending({
                          action: "READY",
                          id: d.id,
                          version: d.version,
                          confirmed: true,
                        })
                      }
                    >
                      {tr("ready")}
                    </Button>
                  )}
                {["DRAFT", "READY"].includes(d.status) &&
                  can("operations.production.manage") && (
                    <Button
                      disabled={blocked}
                      onClick={() => {
                        setEditor(null);
                        setPending({
                          action: "CANCEL",
                          id: d.id,
                          version: d.version,
                          confirmed: true,
                          note: "",
                        });
                      }}
                    >
                      {tr("cancel_batch")}
                    </Button>
                  )}
                {d.status === "READY" && can("operations.production.post") && (
                  <Button
                    type="primary"
                    disabled={blocked}
                    onClick={() => open("POST")}
                  >
                    {tr("post")}
                  </Button>
                )}
                {d.status === "POSTED" &&
                  can("operations.production.post") &&
                  can("stock.adjust") && (
                    <Button
                      danger
                      disabled={blocked}
                      onClick={() => open("WASTE")}
                    >
                      {tr("waste")}
                    </Button>
                  )}
              </Space>
              <Card size="small" title={tr("cost")}>
                <p>
                  {d.costVisible
                    ? uiText("admin_ui.en_thb_thb_c3c5a", { v0: tr("total"), v1: d.value ?? tr("unknown"), v2: tr("per_unit"), v3: d.unitCost ?? tr("unknown") })
                    : tr("cost_permission")}
                </p>
                <p>{tr("cost_hint")}</p>
              </Card>
              {d.lot && (
                <Card size="small" title={tr("lot")}>
                  <p>{d.lot.lot_no}</p>
                  <p>
                    {tr("remaining")}: {d.lot.qty} · {tr("produced")}:{" "}
                    {d.produced_on} · {tr("expiry")}: {d.expiry_date || tr("no_expiry")}
                  </p>
                  <p>{tr("expiry_hint")}</p>
                </Card>
              )}
              <Card size="small" title={tr("sop")}>
                <ol>
                  {d.snapshot.sop.map((x: string, n: number) => (
                    <li key={n}>{x}</li>
                  ))}
                </ol>
              </Card>
              <div className={styles.tableWrap}>
                <Table
                  size="small"
                  pagination={false}
                  rowKey={(r: any) =>
                    JSON.stringify([r.sku ?? r.product_sku, r.size])
                  }
                  scroll={{ x: 600 }}
                  dataSource={
                    d.inputs.length ? d.inputs : d.snapshot.ingredients
                  }
                  columns={[
                    {
                      title: tr("ingredient"),
                      render: (_: any, r: any) =>
                        `${r.sku ?? r.product_sku} / ${r.size}`,
                    },
                    { title: tr("quantity"), dataIndex: "qty" },
                    {
                      title: tr("source_lots"),
                      render: (_: any, r: any) =>
                        r.lots?.length
                          ? r.lots
                              .map((l: any) => `${l.id}: ${l.qty}`)
                              .join(", ")
                          : tr("untracked"),
                    },
                  ]}
                />
              </div>
              <p>
                {tr("note")}: {d.note || "—"}
              </p>
              <Card size="small" title={tr("waste")}>
                {d.waste.map((x: any) => (
                  <p key={x.id}>
                    {x.qty} — {x.reason}
                    {x.action_id ? ` (${x.action_id})` : ""}
                  </p>
                ))}
              </Card>
              <Card size="small" title={tr("history")}>
                {d.events.map((e: any, n: number) => (
                  <p key={n}>
                    {e.action} — {e.note} —{" "}
                    {new Date(e.created_at).toLocaleString(uiText.locale)}
                  </p>
                ))}
              </Card>
              {d.historyTruncated && (
                <Alert closable type="warning" message={tr("truncated")} />
              )}
            </Space>
          )
        )}
      </Drawer>
      <Modal
        width={700}
        open={!!editor && !pending}
        title={tr(
          editor === "CREATE" ? "create" : editor === "POST" ? "post" : "waste",
        )}
        onCancel={() => !blocked && setEditor(null)}
        footer={null}
        destroyOnClose
      >
        <Form
          form={form}
          layout="vertical"
          disabled={blocked}
          onFinish={review}
        >
          {editor === "CREATE" && (
            <>
              <Alert closable type="info" message={tr("catalog_search_hint")} />
              {w?.optionsTruncated && (
                <Alert closable type="warning" message={tr("truncated")} />
              )}
              <Form.Item
                name="recipeId"
                label={tr("recipe")}
                rules={[{ required: true }]}
              >
                <Select
                  showSearch
                  filterOption={false}
                  onSearch={setRecipeSearch}
                  loading={q.loading}
                  onChange={(_, option) => {
                    setRecipeOption(option as CatalogOption);
                    setRecipeSearch("");
                    const bom = (w?.factoryBoms ?? []).find((x: any) => `F:${x.id}` === _);
                    if (bom) {
                      const value = JSON.stringify([bom.output_sku, bom.output_size]);
                      setOutputOption({ value, label: `${bom.output_sku} / ${bom.output_size}` });
                      form.setFieldsValue({ output: value });
                    }
                  }}
                  options={withSelection(
                    [
                      ...(w?.factoryBoms ?? []).map((r: any) => ({
                        value: `F:${r.id}`,
                        label: `${tr("factory_bom")}: ${r.output_sku} / ${r.output_size} v${r.version}`,
                      })),
                      ...(w?.recipes ?? []).map((r: any) => ({
                      value: r.id,
                      label: `${r.product_sku} / ${r.size} v${r.version}`,
                      })),
                    ],
                    recipeOption,
                  )}
                />
              </Form.Item>
              <Form.Item
                name="output"
                label={tr("output")}
                rules={[{ required: true }]}
              >
                <Select
                  showSearch
                  filterOption={false}
                  onSearch={setOutputSearch}
                  loading={q.loading}
                  onChange={(_, option) => {
                    setOutputOption(option as CatalogOption);
                    setOutputSearch("");
                  }}
                  options={withSelection(
                    (w?.outputs ?? []).map((r: any) => ({
                      value: JSON.stringify([r.product_sku, r.size]),
                      label: `${r.product_sku} / ${r.size} (${r.base_unit})`,
                    })),
                    outputOption,
                  )}
                />
              </Form.Item>
              <Alert closable message={tr("output_hint")} type="info" />
              <Form.Item
                name="plannedQty"
                label={tr("planned")}
                rules={[{ required: true }]}
              >
                <InputNumber min={1} max={2147483647} precision={0} />
              </Form.Item>
              {can("order.create") && can("customer.view") && (
                <Form.Item name="factoryDemandId" label={tr("linked_demand")}>
                  <Select allowClear showSearch filterOption={false}
                    onSearch={(value) => { setDemandSearch(value); setDemandPage(1); }}
                    loading={demands.loading}
                    onChange={(id) => {
                      const demand = (demands.data?.bmsFactoryDemandWorkspace?.rows ?? [])
                        .find((x: any) => x.id === id);
                      if (demand) form.setFieldsValue({
                        output: JSON.stringify([demand.output_sku, demand.output_size]),
                        plannedQty: demand.qty,
                      });
                      if (demand) setOutputOption({
                        value: JSON.stringify([demand.output_sku, demand.output_size]),
                        label: `${demand.output_sku} / ${demand.output_size}`,
                      });
                    }}
                    options={(demands.data?.bmsFactoryDemandWorkspace?.rows ?? [])
                      .filter((x: any) => x.status === "OPEN")
                      .map((x: any) => ({ value: x.id,
                        label: `${x.output_sku} / ${x.output_size} · ${x.qty} · ${x.customer_name ?? "—"}` }))} />
                </Form.Item>
              )}
              <Form.Item name="machineId" label={tr("machine")}>
                <Select allowClear showSearch filterOption={false} onSearch={setMachineSearch}
                  options={(machines.data?.bmsFactoryMachines?.rows ?? [])
                  .filter((x: any) => x.active)
                  .map((x: any) => ({ value: x.id, label: `${x.code} · ${x.name}` }))} />
              </Form.Item>
              <Form.Item
                name="templateId"
                label={tr("template")}
                rules={[{ required: true }]}
              >
                <Select
                  options={templates
                    .filter(
                      (x) =>
                        x.locationId === locationId && x.status === "ACTIVE",
                    )
                    .map((x) => ({ value: x.id, label: x.name }))}
                />
              </Form.Item>
              <Form.Item
                name="dueAt"
                label={tr("due")}
                rules={[{ required: true }]}
              >
                <Input type="datetime-local" />
              </Form.Item>
              <Form.Item name="assignedTo" label={tr("assignee")}>
                <Select
                  allowClear
                  options={staff.map((x) => ({ value: x.id, label: x.name }))}
                />
              </Form.Item>
              <Form.Item name="dutyKey" label={tr("duty")}>
                <Input />
              </Form.Item>
              <p>{tr("duty_hint")}</p>
            </>
          )}
          {editor === "POST" && (
            <>
              <Alert closable type="warning" message={tr("posting_hint")} />
              <Form.Item
                name="actualQty"
                label={tr("actual")}
                rules={[{ required: true }]}
              >
                <InputNumber min={1} max={2147483647} precision={0} />
              </Form.Item>
              <Space wrap align="start">
                <Form.Item name="startedAt" label={tr("started_at")}>
                  <Input type="datetime-local" />
                </Form.Item>
                <Form.Item name="endedAt" label={tr("ended_at")}>
                  <Input type="datetime-local" />
                </Form.Item>
              </Space>
              <Space wrap align="start">
                <Form.Item name="rejectedQty" label={tr("rejected_qty")}>
                  <InputNumber min={0} max={2147483647} precision={0} />
                </Form.Item>
                <Form.Item name="laborMinutes" label={tr("labor_minutes")}>
                  <InputNumber min={0} max={2147483647} precision={0} />
                </Form.Item>
                <Form.Item name="energyKwh" label={tr("energy_kwh")}>
                  <InputNumber min={0} max={999999999} precision={3} />
                </Form.Item>
              </Space>
              <p>{tr("machine_evidence_hint")}</p>
              <Form.List name="ingredients">
                {(fields) =>
                  fields.map((f) => (
                    <Space key={f.key} wrap>
                      <Form.Item
                        name={[f.name, "sku"]}
                        label={tr("ingredient")}
                      >
                        <Input readOnly />
                      </Form.Item>
                      <Form.Item name={[f.name, "size"]} label={tr("size")}>
                        <Input readOnly />
                      </Form.Item>
                      <Form.Item
                        name={[f.name, "qty"]}
                        label={tr("quantity")}
                        rules={[{ required: true }]}
                      >
                        <InputNumber min={1} max={2147483647} precision={0} />
                      </Form.Item>
                    </Space>
                  ))
                }
              </Form.List>
              <Form.Item
                name="producedOn"
                label={tr("produced")}
                rules={[{ required: true }]}
              >
                <Input type="date" />
              </Form.Item>
              <Form.Item
                name="expiryDate"
                label={tr("expiry")}
                rules={d?.outputExpiryTracking ? [{ required: true }] : []}
              >
                <Input type="date" />
              </Form.Item>
              <p>{tr("expiry_hint")}</p>
            </>
          )}
          {editor === "WASTE" && (
            <>
              <Alert closable type="warning" message={tr("waste_hint")} />
              <Form.Item
                name="qty"
                label={tr("quantity")}
                rules={[{ required: true }]}
              >
                <InputNumber min={1} precision={0} />
              </Form.Item>
              <Form.Item name="actionId" label={tr("action_id")}>
                <Input />
              </Form.Item>
            </>
          )}
          <Form.Item
            name="note"
            label={tr("note")}
            rules={editor === "CREATE" ? [] : [{ required: true }]}
          >
            <Input.TextArea maxLength={2000} />
          </Form.Item>
          <Button type="primary" htmlType="submit" loading={previewing}>
            {tr("review")}
          </Button>
        </Form>
      </Modal>
      <Modal
        open={!!pending}
        title={tr("confirm")}
        onCancel={() => !blocked && setPending(null)}
        onOk={() => m.command(pending)}
        confirmLoading={m.busy}
        okButtonProps={{
          disabled:
            m.uncertain ||
            (pending?.action === "CANCEL" && !pending.note?.trim()),
        }}
        cancelButtonProps={{ disabled: blocked }}
        maskClosable={!blocked}
        closable={!blocked}
        width={720}
      >
        {pending && (
          <>
            <p>
              {tr("command")}: {pending.action} ·{" "}
              {pending.outputSku ?? d?.output_sku} /{" "}
              {pending.outputSize ?? d?.output_size}
            </p>
            <p>
              {tr("quantity")}:{" "}
              {pending.actualQty ?? pending.plannedQty ?? pending.qty ?? "—"}
            </p>
            {pending.action === "POST" && (
              <>
                <p>
                  {tr("produced")}: {pending.producedOn} · {tr("expiry")}:{" "}
                  {pending.expiryDate || tr("no_expiry")}
                </p>
                {pending.ingredients.map((x: any) => (
                  <p key={x.sku + x.size}>
                    {x.sku} / {x.size}: {x.qty}
                  </p>
                ))}
              </>
            )}
            {preview && (
              <>
                <p>
                  {tr("remaining")}: {preview.output.available ?? tr("unknown")}
                </p>
                {preview.ingredients.map((x: any) => (
                  <p key={x.sku + x.size}>
                    {x.sku} / {x.size} — {tr("required")}: {x.qty} ·{" "}
                    {tr("available")}: {x.available ?? tr("unknown")}
                  </p>
                ))}
                <p>{tr("preview_hint")}</p>
              </>
            )}
            {pending.action === "CANCEL" ? (
              <Input.TextArea
                aria-label={tr("note")}
                value={pending.note}
                onChange={(e) =>
                  setPending({ ...pending, note: e.target.value })
                }
              />
            ) : (
              <p>{pending.note}</p>
            )}
            <Alert
              closable
              message={
                pending.action === "POST"
                  ? tr("posting_hint")
                  : tr("independent")
              }
              type="warning"
            />
          </>
        )}
      </Modal>
      <Modal open={qcOpen} title={tr("qc_policy")}
        onCancel={() => !qcCommand.busy && !qcCommand.uncertain && setQcOpen(false)}
        onOk={() => {
          if (!locationId || !qcIdentity || (qcRequired && !qcReviewerId) ||
              qcPolicy.loading || qcPolicy.error) return;
          setQcPending({ locationId, sku: qcIdentity[0], size: qcIdentity[1],
            required: qcRequired, dueMinutes: qcDueMinutes,
            reviewerId: qcRequired ? qcReviewerId : null, confirmed: true });
        }}
        okButtonProps={{ disabled: !qcIdentity || (qcRequired && !qcReviewerId) || qcPolicy.loading || !!qcPolicy.error || qcCommand.busy || qcCommand.uncertain }}
        maskClosable={false}>
        <Space direction="vertical" style={{ width: "100%" }}>
          <p>{tr("qc_policy_hint")}</p>
          <Select showSearch filterOption={false} style={{ width: "100%" }}
            aria-label={tr("output")} placeholder={tr("output")}
            value={qcOutput} loading={q.loading} onSearch={setOutputSearch}
            onChange={(value) => { setQcOutput(value); setOutputSearch(""); }}
            options={(w?.outputs ?? []).map((r: any) => ({
              value: JSON.stringify([r.product_sku, r.size]),
              label: `${r.product_sku} / ${r.size} (${r.base_unit})`,
            }))} />
          {qcPolicy.error && <Alert closable type="error" message={tr("failed")} />}
          <Space><Switch checked={qcRequired} onChange={setQcRequired} />{tr("qc_required")}</Space>
          <label>{tr("qc_reviewer")}<Select allowClear style={{ width: "100%" }}
            value={qcReviewerId} onChange={setQcReviewerId}
            options={staff.map((x) => ({ value: x.id, label: x.name }))} /></label>
          <label>{tr("qc_due_minutes")}{" "}
            <InputNumber min={1} max={10080} precision={0} value={qcDueMinutes}
              onChange={(value) => setQcDueMinutes(value ?? 1440)} />
          </label>
        </Space>
      </Modal>
      <Modal open={!!qcPending} title={tr("qc_policy_confirm")}
        onCancel={() => !qcCommand.busy && !qcCommand.uncertain && setQcPending(null)}
        onOk={() => qcCommand.command(qcPending)}
        confirmLoading={qcCommand.busy} maskClosable={false}
        okButtonProps={{ disabled: qcCommand.uncertain }}>
        {qcPending && <p>{qcPending.sku} / {qcPending.size} · {qcPending.required ? tr("qc_required") : tr("qc_not_required")} · {qcPending.dueMinutes} {tr("qc_minutes")} · {tr("qc_reviewer")}: {staff.find((x) => x.id === qcPending.reviewerId)?.name ?? "—"}</p>}
      </Modal>
      {qcCommand.retry}
      <Modal open={bomOpen} title={tr("factory_bom")} footer={null} width={760}
        onCancel={() => !bomCommand.busy && !bomCommand.uncertain && setBomOpen(false)}
        maskClosable={false} destroyOnClose>
        <Form form={bomForm} layout="vertical" onFinish={(values) => {
          try {
            const [outputSku, outputSize] = JSON.parse(values.output);
            setBomPending({ outputSku, outputSize, outputQty: values.outputQty,
              ingredients: values.ingredients.map((x: any) => {
                const [sku, size] = JSON.parse(x.product);
                return { sku, size, qty: x.qty };
              }),
              sopSteps: String(values.sopSteps ?? "").split("\n").map((x: string) => x.trim()).filter(Boolean),
              confirmed: true });
          } catch { message.error(tr("failed")); }
        }}>
          <p>{tr("factory_bom_hint")}</p>
          <Form.Item label={tr("copy_bom")}>
            <Select allowClear showSearch filterOption={false} onSearch={setRecipeSearch}
              onChange={(id) => { if (id) void loadBom(id); }}
              options={(w?.factoryBoms ?? []).map((x: any) => ({ value: x.id,
                label: `${x.output_sku} / ${x.output_size} v${x.version}` }))} />
          </Form.Item>
          <Form.Item name="output" label={tr("output")} rules={[{ required: true }]}>
            <Select showSearch filterOption={false} onSearch={setOutputSearch}
              onChange={(_, option) => { setBomOutputOption(option as CatalogOption); setOutputSearch(""); }}
              options={withSelection((w?.outputs ?? []).map((x: any) => ({
                value: JSON.stringify([x.product_sku, x.size]),
                label: `${x.product_sku} / ${x.size} (${x.base_unit})`,
              })), bomOutputOption)} />
          </Form.Item>
          <Form.Item name="outputQty" label={tr("bom_yield")} rules={[{ required: true }]}>
            <InputNumber min={1} max={2147483647} precision={0} />
          </Form.Item>
          <Form.List name="ingredients" rules={[{ validator: async (_, items) => {
            if (!items?.length) throw new Error(tr("required"));
          } }]}>
            {(fields, { add, remove }, { errors }) => <>
              {fields.map((field) => <Space key={field.key} wrap align="start">
                <Form.Item name={[field.name, "product"]} label={tr("ingredient")} rules={[{ required: true }]}>
                  <Select showSearch filterOption={false} style={{ minWidth: 280 }} onSearch={setOutputSearch}
                    options={(w?.outputs ?? []).map((x: any) => ({
                      value: JSON.stringify([x.product_sku, x.size]),
                      label: `${x.product_sku} / ${x.size} (${x.base_unit})`,
                    }))} />
                </Form.Item>
                <Form.Item name={[field.name, "qty"]} label={tr("required")} rules={[{ required: true }]}>
                  <InputNumber min={1} max={2147483647} precision={0} />
                </Form.Item>
                <Button onClick={() => remove(field.name)}>{tr("remove")}</Button>
              </Space>)}
              <Form.ErrorList errors={errors} />
              <Button onClick={() => add()}>{tr("add_ingredient")}</Button>
            </>}
          </Form.List>
          <Form.Item name="sopSteps" label={tr("bom_sop")}>
            <Input.TextArea rows={3} />
          </Form.Item>
          <Button type="primary" htmlType="submit">{tr("review")}</Button>
        </Form>
      </Modal>
      <Modal open={!!bomPending} title={tr("factory_bom_confirm")}
        onCancel={() => !bomCommand.busy && !bomCommand.uncertain && setBomPending(null)}
        onOk={() => bomCommand.command(bomPending)} confirmLoading={bomCommand.busy}
        okButtonProps={{ disabled: bomCommand.uncertain }} maskClosable={false}>
        {bomPending && <>
          <p>{bomPending.outputSku} / {bomPending.outputSize} · {tr("bom_yield")}: {bomPending.outputQty}</p>
          {bomPending.ingredients.map((x: any) => <p key={x.sku + x.size}>
            {x.sku} / {x.size}: {x.qty}
          </p>)}
          <p>{tr("bom_sop")}: {bomPending.sopSteps.join("; ") || "—"}</p>
        </>}
      </Modal>
      {bomCommand.retry}
      <Modal open={demandOpen} title={tr("factory_demands")} width={980}
        onCancel={() => !demandCommand.busy && !demandCommand.uncertain && setDemandOpen(false)}
        footer={null} maskClosable={false}>
        <Space direction="vertical" style={{ width: "100%" }}>
          <Alert closable type="info" message={tr("demand_hint")} />
          <Space wrap>
            <Input.Search value={demandSearch} onChange={(e) => { setDemandSearch(e.target.value); setDemandPage(1); }}
              placeholder={tr("search")} style={{ width: 270 }} />
            <Button type="primary" onClick={() => { demandForm.resetFields(); setDemandCreate(true); }}>
              {tr("new_demand")}
            </Button>
          </Space>
          {demands.error && <Alert closable type="error" message={tr("failed")} />}
          <Table rowKey="id" loading={demands.loading} size="small" scroll={{ x: 850 }}
            dataSource={demands.data?.bmsFactoryDemandWorkspace?.rows ?? []}
            pagination={{ current: demandPage, pageSize: 25,
              total: demands.data?.bmsFactoryDemandWorkspace?.total ?? 0,
              onChange: setDemandPage, showSizeChanger: false }}
            columns={[
              { title: tr("output"), render: (_, r: any) => `${r.output_sku} / ${r.output_size}` },
              { title: tr("customer"), dataIndex: "customer_name", render: (v: string) => v || "—" },
              { title: tr("planned"), dataIndex: "qty" },
              { title: tr("produced_qty"), dataIndex: "produced_qty" },
              { title: tr("due"), dataIndex: "due_at", render: (v: string) => new Date(v).toLocaleString(uiText.locale) },
              { title: tr("status"), dataIndex: "status", render: (v: string) => <Tag>{v}</Tag> },
              { title: tr("order_id"), dataIndex: "order_id", render: (v: string) => v || "—" },
              { title: tr("work"), render: (_, r: any) => r.status === "OPEN" ? <Space>
                  <Button disabled={r.produced_qty < r.qty || !r.customer_id} onClick={() => setDemandPending({
                    action: "CONVERT", id: r.id, version: r.version, confirmed: true, row: r,
                  })}>{tr("convert_demand")}</Button>
                  <Button onClick={() => setDemandPending({
                    action: "CANCEL", id: r.id, version: r.version, confirmed: true, note: "", row: r,
                  })}>{tr("cancel_demand")}</Button>
                </Space> : null },
            ]} />
        </Space>
      </Modal>
      <Modal open={demandCreate} title={tr("new_demand")} footer={null}
        onCancel={() => !demandCommand.busy && !demandCommand.uncertain && setDemandCreate(false)}
        maskClosable={false} destroyOnClose>
        <Form form={demandForm} layout="vertical" onFinish={(values) => {
          try {
            const [outputSku, outputSize] = JSON.parse(values.output);
            setDemandPending({ action: "CREATE", locationId, customerId: values.customerId,
              outputSku, outputSize, qty: values.qty,
              dueAt: new Date(values.dueAt).toISOString(), note: values.note ?? "", confirmed: true });
          } catch { message.error(tr("failed")); }
        }}>
          {(customers.data?.bmsFactoryDemandCustomers?.length ?? 0) > 50 &&
            <Alert closable type="warning" message={tr("truncated")} />}
          <Form.Item name="customerId" label={tr("customer")} rules={[{ required: true }]}>
            <Select allowClear showSearch filterOption={false} onSearch={setCustomerSearch}
              loading={customers.loading}
              options={(customers.data?.bmsFactoryDemandCustomers ?? []).slice(0, 50)
                .map((x: any) => ({ value: x.id, label: `${x.name}${x.phone ? ` · ${x.phone}` : ""}` }))} />
          </Form.Item>
          <Form.Item name="output" label={tr("output")} rules={[{ required: true }]}>
            <Select showSearch filterOption={false} onSearch={setOutputSearch}
              options={(w?.outputs ?? []).map((x: any) => ({ value: JSON.stringify([x.product_sku, x.size]),
                label: `${x.product_sku} / ${x.size}` }))} />
          </Form.Item>
          <Form.Item name="qty" label={tr("planned")} rules={[{ required: true }]}>
            <InputNumber min={1} max={2147483647} precision={0} />
          </Form.Item>
          <Form.Item name="dueAt" label={tr("due")} rules={[{ required: true }]}>
            <Input type="datetime-local" />
          </Form.Item>
          <Form.Item name="note" label={tr("note")}><Input.TextArea /></Form.Item>
          <Button type="primary" htmlType="submit">{tr("review")}</Button>
        </Form>
      </Modal>
      <Modal open={!!demandPending} title={tr("demand_confirm")}
        onCancel={() => !demandCommand.busy && !demandCommand.uncertain && setDemandPending(null)}
        onOk={() => {
          if (!demandPending) return;
          const { row, ...input } = demandPending;
          demandCommand.command(input);
        }}
        confirmLoading={demandCommand.busy} maskClosable={false}
        okButtonProps={{ disabled: demandCommand.uncertain ||
          (demandPending?.action === "CANCEL" && !demandPending?.note?.trim()) }}>
        {demandPending && <>
          <p>{demandPending.action} · {demandPending.outputSku ?? demandPending.row?.output_sku} /
            {demandPending.outputSize ?? demandPending.row?.output_size} · {demandPending.qty ?? demandPending.row?.qty}</p>
          <p>{tr("demand_confirm_hint")}</p>
          {demandPending.action === "CANCEL" && <Input.TextArea value={demandPending.note}
            onChange={(e) => setDemandPending({ ...demandPending, note: e.target.value })} />}
        </>}
      </Modal>
      {demandCommand.retry}
      <Modal open={machineOpen} title={tr("machines")} width={700} footer={null}
        onCancel={() => !machineCommand.busy && !machineCommand.uncertain && setMachineOpen(false)}
        maskClosable={false}>
        <Space direction="vertical" style={{ width: "100%" }}>
          <p>{tr("machine_hint")}</p>
          <Input.Search value={machineSearch} onChange={(e) => setMachineSearch(e.target.value)}
            placeholder={tr("search")} />
          {machines.data?.bmsFactoryMachines?.truncated &&
            <Alert closable type="warning" message={tr("truncated")} />}
          <Table rowKey="id" size="small" dataSource={machines.data?.bmsFactoryMachines?.rows ?? []}
            pagination={false} scroll={{ y: 240 }} columns={[
              { title: tr("machine_code"), dataIndex: "code" },
              { title: tr("machine_name"), dataIndex: "name" },
              { title: tr("status"), dataIndex: "active", render: (v: boolean) => v ? tr("active") : tr("inactive") },
              { title: tr("work"), render: (_, r: any) => <Button onClick={() => machineForm.setFieldsValue({
                id: r.id, version: r.version, code: r.code, name: r.name, active: r.active,
              })}>{tr("edit")}</Button> },
            ]} />
          <Form form={machineForm} layout="vertical" initialValues={{ active: true }}
            onFinish={(v) => setMachinePending({ ...v, locationId, confirmed: true })}>
            <Form.Item name="id" hidden><Input /></Form.Item>
            <Form.Item name="version" hidden><InputNumber /></Form.Item>
            <Form.Item name="code" label={tr("machine_code")} rules={[{ required: true }]}>
              <Input maxLength={40} />
            </Form.Item>
            <Form.Item name="name" label={tr("machine_name")} rules={[{ required: true }]}>
              <Input maxLength={120} />
            </Form.Item>
            <Form.Item name="active" label={tr("active")} valuePropName="checked"><Switch /></Form.Item>
            <Space><Button onClick={() => machineForm.resetFields()}>{tr("new_machine")}</Button>
              <Button type="primary" htmlType="submit">{tr("review")}</Button></Space>
          </Form>
        </Space>
      </Modal>
      <Modal open={!!machinePending} title={tr("machine_confirm")}
        onCancel={() => !machineCommand.busy && !machineCommand.uncertain && setMachinePending(null)}
        onOk={() => machineCommand.command(machinePending)} confirmLoading={machineCommand.busy}
        okButtonProps={{ disabled: machineCommand.uncertain }} maskClosable={false}>
        {machinePending && <p>{machinePending.code} · {machinePending.name} ·
          {machinePending.active ? tr("active") : tr("inactive")}</p>}
      </Modal>
      {machineCommand.retry}
      {m.retry}
    </Space>
  );
}
