"use client";
import { gql, useQuery, useApolloClient } from "@apollo/client";
import { useState, useEffect, useDeferredValue } from "react";
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
  Table,
  Tag,
  message,
} from "antd";
import { useI18n } from "@/lib/i18nContext";
import { useBmsPermissions } from "@/app/hooks/useBmsPermissions";
import { useTeamCommand } from "@/components/operations/useTeamCommand";
import { Catalog } from "./MaterialPanel";
const WORK = gql`
  query QualityWorkspace($filter: BmsMaterialFilter) {
    bmsQualityWorkspace(filter: $filter)
  }
`;
const DETAIL = gql`
  query QualityDetail($id: ID!) {
    bmsQualityDetail(id: $id)
  }
`;
const LOTS = gql`
  query QualityLots($locationId: ID!, $search: String) {
    bmsQualityLots(locationId: $locationId, search: $search)
  }
`;
const TRACE = gql`
  query QualityTrace($lotId: ID!) {
    bmsQualityTrace(lotId: $lotId)
  }
`;
const COMMAND = gql`
  mutation QualityCommand($input: BmsQualityInput!) {
    bmsQualityCommand(input: $input) {
      status
      id
      version
    }
  }
`;
const CONTEXT = gql`
  query QualityForRun($id: ID!) {
    bmsQualityForRun(id: $id)
  }
`;
const bangkokMinute = (value: string) =>
  new Date(Date.parse(value) + 7 * 3600000).toISOString().slice(0, 16);
export function QualityRunContext({ runId }: { runId: string }) {
  const { t } = useI18n(),
    { can } = useBmsPermissions(),
    q = useQuery(CONTEXT, {
      variables: { id: runId },
      fetchPolicy: "network-only",
    }),
    p = q.data?.bmsQualityForRun;
  return q.error ? (
    <Alert
      closable
      type="warning"
      message={t("operation_quality.load_error")}
    />
  ) : p ? (
    <Alert
      closable
      type="info"
      message={t("operation_quality.tab")}
      description={
        <>
          {p.title}{" "}
          {can("operations.quality.view") && can("product.view") && (
            <Button href={`/admin/operations?quality=${p.id}`}>
              {t("operation_quality.detail")}
            </Button>
          )}
        </>
      }
    />
  ) : null;
}
export default function QualityPanel({
  locationId,
  staff,
  onOpenRun,
}: {
  locationId?: string;
  staff: any[];
  onOpenRun: (id: string) => void;
}) {
  const { t } = useI18n(),
    tr = (k: string) => t(`operation_quality.${k}`),
    { can } = useBmsPermissions(),
    client = useApolloClient();
  const [search, setSearch] = useState(""),
    term = useDeferredValue(search),
    [page, setPage] = useState(1),
    [selected, setSelected] = useState<string>(),
    [dialog, setDialog] = useState<any>(),
    [pending, setPending] = useState<any>(),
    [trace, setTrace] = useState<any>(),
    [lotSearch, setLotSearch] = useState(""),
    [pickedLot, setPickedLot] = useState<any>();
  const [form] = Form.useForm();
  useEffect(() => {
    const id = new URLSearchParams(window.location.search).get("quality");
    if (id) setSelected(id);
  }, []);
  const q = useQuery(WORK, {
      variables: {
        filter: { locationId, search: term, offset: (page - 1) * 25 },
      },
      fetchPolicy: "network-only",
    }),
    w = q.data?.bmsQualityWorkspace;
  const detail = useQuery(DETAIL, {
      variables: { id: selected },
      skip: !selected,
      fetchPolicy: "network-only",
    }),
    d = detail.data?.bmsQualityDetail;
  const branch = dialog?.action === "CREATE" ? locationId : d?.location_id;
  const lotQ = useQuery(LOTS, {
    variables: { locationId: branch, search: useDeferredValue(lotSearch) },
    skip: !branch || !["CREATE", "HOLD"].includes(dialog?.action),
    fetchPolicy: "network-only",
  });
  const refresh = async () => {
    await q.refetch();
    if (selected) await detail.refetch();
  };
  const m = useTeamCommand(
      refresh,
      () => {
        setPending(undefined);
        setDialog(undefined);
      },
      { document: COMMAND, field: "bmsQualityCommand" },
    ),
    blocked = m.busy || m.uncertain;
  const allowed = (a: string) =>
    can(
      ["HOLD"].includes(a)
        ? "operations.quality.hold"
        : ["CLOSE", "APPROVE", "REJECT"].includes(a)
          ? "operations.quality.review"
          : "operations.quality.manage",
    ) &&
    (!["ASSIGN_RUN", "UPDATE"].includes(a) ||
      can("operations.checklist.manage"));
  const open = (action: string, context: any = {}) => {
    if (blocked) return;
    setPickedLot(undefined);
    setLotSearch("");
    form.resetFields();
    form.setFieldsValue({
      severity: "NORMAL",
      assignedTo: d?.assigned_to,
      dueAt: d?.due_at ? bangkokMinute(d.due_at) : undefined,
      hypothesis: d?.hypothesis,
      observedCause: d?.observed_cause,
    });
    setDialog({ action, ...context });
  };
  const button = (a: string, context: any = {}) =>
    allowed(a) ? (
      <Button
        key={a}
        disabled={blocked}
        onClick={() => open(a, context)}
        style={{ whiteSpace: "normal", height: "auto" }}
      >
        {tr(a)}
      </Button>
    ) : null;
  async function inspectTrace(id: string) {
    try {
      const r = await client.query({
        query: TRACE,
        variables: { lotId: id },
        fetchPolicy: "network-only",
      });
      setTrace(r.data.bmsQualityTrace);
    } catch {
      message.error(tr("load_error"));
    }
  }
  function preview(v: any) {
    const input: any = { ...v, action: dialog.action, confirmed: true };
    for (const k of Object.keys(input))
      if (input[k] === "" || input[k] === undefined) delete input[k];
    if (v.dueAt)
      input.dueAt =
        dialog.action === "UPDATE" &&
        d?.due_at &&
        v.dueAt === bangkokMinute(d.due_at)
          ? new Date(d.due_at).toISOString()
          : new Date(v.dueAt + "+07:00").toISOString();
    if (dialog.action === "CREATE") input.locationId = locationId;
    else {
      input.id = d.id;
      input.version = d.version;
    }
    if (pickedLot) {
      input.lotId = pickedLot.id;
      input.expectedQty = pickedLot.qty;
    }
    if (dialog.hold) {
      input.holdId = dialog.hold.id;
      input.holdVersion = dialog.hold.version;
      input.expectedQty = dialog.hold.qty;
    }
    if (dialog.decision) input.decisionId = dialog.decision.id;
    if (d?.run) input.runVersion = d.run.version;
    if (dialog.action === "SAVE_TRACE") {
      input.lotId = trace.root;
      input.fingerprint = trace.fingerprint;
    }
    setPending(input);
  }
  const lots = [...(lotQ.data?.bmsQualityLots.rows ?? [])];
  if (pickedLot && !lots.some((x) => x.id === pickedLot.id))
    lots.push(pickedLot);
  const fields = ["CREATE", "UPDATE"].includes(dialog?.action);
  const showLots = ["CREATE", "HOLD"].includes(dialog?.action);
  const lotLabel = (x: any) =>
    `${x.product_sku} / ${x.size} · ${x.lot_no} · ${x.qty} ${x.base_unit}`;
  const holdCols: any[] = [
    { title: tr("lot"), render: (_: any, x: any) => lotLabel(x) },
    {
      title: tr("status"),
      render: (_: any, x: any) => <Tag>{tr(x.status)}</Tag>,
    },
    {
      title: tr("actions"),
      render: (_: any, x: any) => (
        <Space wrap>
          <Button onClick={() => inspectTrace(x.lot_id)}>{tr("trace")}</Button>
          {x.status === "ACTIVE" && d?.status !== "CLOSED" && (
            <>
              {button("PROPOSE_RELEASE", { hold: x })}
              {button("PROPOSE_DISPOSE", { hold: x })}
            </>
          )}
        </Space>
      ),
    },
  ];
  return (
    <Space
      direction="vertical"
      style={{ width: "100%", minWidth: 0 }}
      size="middle"
    >
      <Alert closable type="info" message={tr("scope")} />
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
        <Button onClick={() => refresh()} disabled={blocked}>
          {tr("reload")}
        </Button>
        {locationId && button("CREATE")}
      </Space>
      {!locationId && (
        <Alert closable type="info" message={tr("select_branch")} />
      )}
      {q.error && <Alert closable type="error" message={tr("load_error")} />}
      <Space wrap>
        {["open", "review", "overdue"].map((k) => (
          <Tag key={k}>
            {tr(k)}: {w?.[k] ?? "—"}
          </Tag>
        ))}
      </Space>
      <Table
        rowKey="id"
        loading={q.loading}
        dataSource={w?.rows ?? []}
        scroll={{ x: 700 }}
        pagination={{
          current: page,
          pageSize: 25,
          total: w?.total ?? 0,
          onChange: setPage,
          showSizeChanger: false,
        }}
        columns={[
          {
            title: tr("title"),
            dataIndex: "title",
            render: (v, x: any) => (
              <Button onClick={() => setSelected(x.id)}>{v}</Button>
            ),
          },
          { title: tr("status"), dataIndex: "status", render: (v) => tr(v) },
          {
            title: tr("severity"),
            dataIndex: "severity",
            render: (v) => tr(v),
          },
          { title: tr("dueAt"), dataIndex: "due_at" },
        ]}
      />
      <Drawer
        open={!!selected}
        onClose={() => !blocked && setSelected(undefined)}
        width={1100}
        styles={{ wrapper: { maxWidth: "100vw" } }}
        title={tr("detail")}
        destroyOnClose
      >
        {detail.loading ? (
          <Spin />
        ) : detail.error ? (
          <Alert closable type="error" message={tr("load_error")} />
        ) : (
          d && (
            <Space direction="vertical" style={{ width: "100%" }} size="middle">
              <h3>
                {d.title} <Tag>{tr(d.status)}</Tag>
              </h3>
              <p>
                {tr("facts")}: {d.facts}
              </p>
              <p>
                {tr("hypothesis")}: {d.hypothesis || "—"}
              </p>
              <p>
                {tr("observedCause")}: {d.observed_cause || "—"}
              </p>
              <p>
                {tr("assignedTo")}:{" "}
                {staff.find((x) => x.id === d.assigned_to)?.name ??
                  d.assigned_to}{" "}
                · {tr("dueAt")}: {d.due_at}
              </p>
              <Space wrap>
                {d.run_id && (
                  <Button onClick={() => onOpenRun(d.run_id)}>
                    {tr("task")}
                  </Button>
                )}
                {d.status === "CLOSED" ? (
                  button("REOPEN")
                ) : (
                  <>
                    {button("HOLD")}
                    {button("UPDATE")}
                    {button("ASSIGN_RUN")}
                    {button("SUBMIT")}
                    {button("CLOSE")}
                  </>
                )}
              </Space>
              <Card title={tr("holds")}>
                <Table
                  rowKey="id"
                  dataSource={d.holds}
                  columns={holdCols}
                  scroll={{ x: 800 }}
                />
              </Card>
              <Card title={tr("decisions")}>
                <Table
                  rowKey="id"
                  dataSource={d.decisions}
                  scroll={{ x: 800 }}
                  columns={[
                    {
                      title: tr("kind"),
                      dataIndex: "kind",
                      render: (v) => tr(v),
                    },
                    { title: tr("qty"), dataIndex: "qty" },
                    {
                      title: tr("status"),
                      dataIndex: "status",
                      render: (v) => tr(v),
                    },
                    { title: tr("note"), dataIndex: "note" },
                    {
                      title: tr("actions"),
                      render: (_, x: any) =>
                        x.status === "PENDING" ? (
                          <Space wrap>
                            {button("APPROVE", {
                              decision: x,
                              hold: d.holds.find(
                                (h: any) => h.id === x.hold_id,
                              ) ?? {
                                ...x,
                                id: x.hold_id,
                                qty: x.current_qty,
                                version: x.current_hold_version,
                              },
                            })}
                            {button("REJECT", { decision: x })}
                          </Space>
                        ) : null,
                    },
                  ]}
                />
              </Card>
              <Card title={tr("history")}>
                <Table
                  rowKey={(_, i) => String(i)}
                  dataSource={d.events}
                  scroll={{ x: 650 }}
                  columns={[
                    {
                      title: tr("actions"),
                      dataIndex: "action",
                      render: (v) => tr(v),
                    },
                    { title: tr("note"), dataIndex: "note" },
                    { title: tr("when"), dataIndex: "created_at" },
                    {
                      title: tr("trace"),
                      render: (_: unknown, x: any) =>
                        x.trace ? (
                          <Button
                            onClick={() =>
                              setTrace({ ...x.trace, saved: true })
                            }
                          >
                            {tr("trace")}
                          </Button>
                        ) : null,
                    },
                  ]}
                />
                {d.historyTruncated && (
                  <Alert closable message={tr("truncated")} type="info" />
                )}
              </Card>
            </Space>
          )
        )}
      </Drawer>
      <Modal
        open={!!dialog}
        title={tr(dialog?.action ?? "detail")}
        onCancel={() => !blocked && !pending && setDialog(undefined)}
        footer={null}
        destroyOnClose
        width={680}
      >
        <Form
          form={form}
          layout="vertical"
          onFinish={preview}
          disabled={blocked}
        >
          {dialog?.action === "UPDATE" && (
            <Alert closable type="info" message={tr("edit_hint")} />
          )}
          {dialog?.action === "CREATE" && (
            <>
              {["title", "category", "facts"].map((k) => (
                <Form.Item
                  key={k}
                  name={k}
                  label={tr(k)}
                  rules={[{ required: true }]}
                >
                  <Input.TextArea
                    maxLength={
                      k === "facts" ? 4000 : k === "category" ? 80 : 160
                    }
                  />
                </Form.Item>
              ))}
              <Form.Item name="severity" label={tr("severity")}>
                <Select
                  options={["NORMAL", "URGENT"].map((x) => ({
                    value: x,
                    label: tr(x),
                  }))}
                />
              </Form.Item>
              {["sourceRunId", "sourceInspectionId", "sourceProductionId"].map(
                (k) => (
                  <Form.Item key={k} name={k} label={tr(k)}>
                    <Input />
                  </Form.Item>
                ),
              )}
            </>
          )}
          {fields && (
            <>
              <Form.Item
                name="assignedTo"
                label={tr("assignedTo")}
                rules={[{ required: true }]}
              >
                <Select
                  showSearch
                  optionFilterProp="label"
                  options={staff.map((x) => ({
                    value: x.id,
                    label: x.name || x.email || x.id,
                  }))}
                />
              </Form.Item>
              <Form.Item
                name="dueAt"
                label={tr("dueAtUTC")}
                rules={[{ required: true }]}
              >
                <Input type="datetime-local" />
              </Form.Item>
              <Form.Item name="hypothesis" label={tr("hypothesis")}>
                <Input.TextArea maxLength={2000} />
              </Form.Item>
            </>
          )}
          {(dialog?.action === "UPDATE" || dialog?.action === "SUBMIT") && (
            <Form.Item
              name="observedCause"
              label={tr("observedCause")}
              rules={[{ required: dialog?.action === "SUBMIT" }]}
            >
              <Input.TextArea maxLength={2000} />
            </Form.Item>
          )}
          {showLots && (
            <>
              <Form.Item
                name="lotId"
                label={tr("lot")}
                rules={[{ required: dialog?.action === "HOLD" }]}
              >
                <Select
                  showSearch
                  filterOption={false}
                  loading={lotQ.loading}
                  onSearch={setLotSearch}
                  onChange={(id) => setPickedLot(lots.find((x) => x.id === id))}
                  options={lots.map((x) => ({
                    value: x.id,
                    label: lotLabel(x),
                    disabled: x.held,
                  }))}
                  allowClear
                />
              </Form.Item>
              {lotQ.error && (
                <Alert closable type="error" message={tr("load_error")} />
              )}{" "}
              {lotQ.data?.bmsQualityLots.hasMore && (
                <Alert closable type="info" message={tr("search_more")} />
              )}
            </>
          )}
          {dialog?.action === "ASSIGN_RUN" && (
            <Form.Item
              name="templateId"
              label={tr("templateId")}
              rules={[{ required: true }]}
            >
              <Catalog kind="TEMPLATE" locationId={d?.location_id ?? ""} />
            </Form.Item>
          )}
          {dialog?.action === "PROPOSE_DISPOSE" && (
            <Form.Item
              name="qty"
              label={tr("qty")}
              rules={[{ required: true }]}
            >
              <InputNumber min={1} max={dialog.hold.qty} precision={0} />
            </Form.Item>
          )}
          {dialog?.hold && <p>{lotLabel(dialog.hold)}</p>}
          {dialog?.decision && (
            <p>
              {tr(dialog.decision.kind)} · {dialog.decision.qty} ·{" "}
              {dialog.decision.note}
            </p>
          )}
          <Form.Item
            name="note"
            label={tr("note")}
            rules={[{ required: true }]}
          >
            <Input.TextArea maxLength={2000} />
          </Form.Item>
          <Button htmlType="submit" type="primary" disabled={blocked}>
            {tr("preview")}
          </Button>
        </Form>
      </Modal>
      <Modal
        open={!!pending}
        title={tr("confirm")}
        okText={tr("confirm")}
        onCancel={() => !blocked && setPending(undefined)}
        onOk={() => m.command(pending)}
        confirmLoading={m.busy}
        okButtonProps={{ disabled: blocked }}
        cancelButtonProps={{ disabled: blocked }}
        zIndex={2100}
      >
        <Alert closable type="warning" message={tr("confirm_hint")} />
        <p>
          {tr(pending?.action ?? "detail")} · {branch}
        </p>
        {pickedLot && <p>{lotLabel(pickedLot)}</p>}
        {dialog?.hold && <p>{lotLabel(dialog.hold)}</p>}
        {dialog?.decision && (
          <p>
            {tr(dialog.decision.kind)} · {dialog.decision.qty}
          </p>
        )}
        <pre style={{ whiteSpace: "pre-wrap", overflowWrap: "anywhere" }}>
          {JSON.stringify(pending, null, 2)}
        </pre>
      </Modal>
      <Drawer
        open={!!trace}
        onClose={() => setTrace(undefined)}
        width={1100}
        styles={{ wrapper: { maxWidth: "100vw" } }}
        title={tr("trace")}
      >
        {trace && (
          <Space direction="vertical" style={{ width: "100%" }}>
            {trace.saved && (
              <Alert closable type="info" message={tr("saved_trace")} />
            )}
            <Alert
              closable
              type="warning"
              message={tr("trace_limits")}
              description={trace.restricted ? tr("restricted") : undefined}
            />
            <Table
              rowKey="id"
              dataSource={trace.lots}
              scroll={{ x: 750 }}
              columns={[
                { title: tr("lot"), render: (_, x: any) => lotLabel(x) },
                { title: tr("source_lot"), dataIndex: "id" },
                { title: tr("branch"), dataIndex: "location_id" },
                {
                  title: tr("held"),
                  dataIndex: "held",
                  render: (v) => (v ? tr("ACTIVE") : tr("not_held")),
                },
              ]}
            />
            <h4>{tr("production")}</h4>
            <Table
              rowKey={(_, i) => String(i)}
              dataSource={trace.productions}
              scroll={{ x: 800 }}
              columns={[
                { title: tr("source"), dataIndex: "sourceLotId" },
                {
                  title: tr("production"),
                  dataIndex: "id",
                  render: (v) => (
                    <Button href={`/admin/operations?production=${v}`}>
                      {v}
                    </Button>
                  ),
                },
                { title: tr("output"), dataIndex: "output_sku" },
                { title: tr("qty"), dataIndex: "actual_qty" },
              ]}
            />
            <h4>{tr("sales")}</h4>
            <Table
              rowKey={(_, i) => String(i)}
              dataSource={trace.sales}
              scroll={{ x: 750 }}
              columns={[
                { title: tr("source"), dataIndex: "order_id" },
                { title: tr("source_lot"), dataIndex: "lot_id" },
                { title: tr("output"), dataIndex: "sold_sku" },
                {
                  title: tr("qty"),
                  render: (_, x: any) =>
                    `${x.qty} ${trace.lots.find((l: any) => l.id === x.lot_id)?.base_unit ?? "—"}`,
                },
                { title: tr("status"), dataIndex: "status" },
              ]}
            />
            <h4>{tr("returns")}</h4>
            <Table
              rowKey={(x: any) => `${x.source_id}:${x.destination_id}`}
              dataSource={trace.returns ?? []}
              scroll={{ x: 800 }}
              columns={[
                { title: tr("source_lot"), dataIndex: "source_id" },
                { title: tr("destination_lot"), dataIndex: "destination_id" },
              ]}
            />
            <h4>{tr("receipts")}</h4>
            <Table
              rowKey="id"
              dataSource={trace.receipts}
              scroll={{ x: 700 }}
              columns={[
                { title: tr("source"), dataIndex: "po_id" },
                { title: tr("source_lot"), dataIndex: "lot_id" },
                {
                  title: tr("qty"),
                  render: (_, x: any) =>
                    `${x.qty} ${trace.lots.find((l: any) => l.id === x.lot_id)?.base_unit ?? "—"}`,
                },
                { title: tr("when"), dataIndex: "created_at" },
              ]}
            />
            {d && !trace.saved && button("SAVE_TRACE")}
          </Space>
        )}
      </Drawer>
      {m.retry}
    </Space>
  );
}
