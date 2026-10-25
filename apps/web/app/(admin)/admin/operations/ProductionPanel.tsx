"use client";
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
        input = {
          action: "CREATE",
          locationId,
          templateId: values.templateId,
          recipeId: values.recipeId,
          plannedQty: values.plannedQty,
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
              recipeId: values.recipeId,
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
        };
      setPending(input);
    } catch {
      message.error(tr("failed"));
    } finally {
      setPreviewing(false);
    }
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
              render: (v: string) => new Date(v).toLocaleString(),
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
                    ? `${tr("total")}: ${d.value ?? tr("unknown")} THB · ${tr("per_unit")}: ${d.unitCost ?? tr("unknown")} THB`
                    : tr("cost_permission")}
                </p>
                <p>{tr("cost_hint")}</p>
              </Card>
              {d.lot && (
                <Card size="small" title={tr("lot")}>
                  <p>{d.lot.lot_no}</p>
                  <p>
                    {tr("remaining")}: {d.lot.qty} · {tr("produced")}:{" "}
                    {d.produced_on} · {tr("expiry")}: {d.expiry_date}
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
                    {new Date(e.created_at).toLocaleString()}
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
                  }}
                  options={withSelection(
                    (w?.recipes ?? []).map((r: any) => ({
                      value: r.id,
                      label: `${r.product_sku} / ${r.size} v${r.version}`,
                    })),
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
                rules={[{ required: true }]}
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
                  {pending.expiryDate}
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
      {m.retry}
    </Space>
  );
}
