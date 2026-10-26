"use client";
import { gql, useQuery, useApolloClient } from "@apollo/client";
import { useState, useDeferredValue, useEffect } from "react";
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
import styles from "./operations.module.css";
const WORK = gql`
  query MaterialWorkspace($filter: BmsMaterialFilter) {
    bmsMaterialWorkspace(filter: $filter)
  }
`;
const DETAIL = gql`
  query MaterialDetail($id: ID!) {
    bmsMaterialDetail(id: $id)
  }
`;
const PREVIEW = gql`
  query MaterialPreview($input: BmsMaterialPreview!) {
    bmsMaterialPreview(input: $input)
  }
`;
const CATALOG = gql`
  query MaterialCatalog($kind: String!, $locationId: ID!, $search: String) {
    bmsMaterialCatalog(kind: $kind, locationId: $locationId, search: $search)
  }
`;
const TEMPLATES = gql`
  query MaterialTemplates($kind: String!, $locationId: ID!, $search: String) {
    bmsImprovementCatalog(kind: $kind, locationId: $locationId, search: $search)
  }
`;
const COMMAND = gql`
  mutation MaterialCommand($input: BmsMaterialInput!) {
    bmsMaterialCommand(input: $input) {
      status
      id
      version
    }
  }
`;
const CONTEXT = gql`
  query MaterialForRun($id: ID!) {
    bmsMaterialForRun(id: $id)
  }
`;
export function MaterialRunContext({ runId }: { runId: string }) {
  const { t } = useI18n(),
    { can } = useBmsPermissions(),
    q = useQuery(CONTEXT, {
      variables: { id: runId },
      fetchPolicy: "network-only",
    }),
    d = q.data?.bmsMaterialForRun;
  return q.error ? (
    <Alert
      closable
      type="warning"
      message={t("operation_material.load_error")}
    />
  ) : d ? (
    <Alert
      closable
      type="info"
      message={t("operation_material.task_context")}
      description={
        <>
          <p>{d.title}</p>
          {d.inspection && (
            <p>
              {d.inspection.product_sku} / {d.inspection.size} ·{" "}
              {d.inspection.base_unit} · {t("operation_material.acceptedQty")}:{" "}
              {d.inspection.accepted_qty} ·{" "}
              {t("operation_material.rejectedQty")}: {d.inspection.rejected_qty}{" "}
              · {d.inspection.lot_no} · {d.inspection.expiry_date}
              <br />
              {d.inspection.note}
            </p>
          )}
          {can("operations.material.view") && can("product.view") && (
            <Button href={`/admin/operations?material=${d.planId}`}>
              {t("operation_material.detail")}
            </Button>
          )}
        </>
      }
    />
  ) : null;
}
export function Catalog({
  id,
  kind,
  locationId,
  value,
  onChange,
  multiple = false,
}: {
  id?: string;
  kind: string;
  locationId: string;
  value?: any;
  onChange?: (v: any) => void;
  multiple?: boolean;
}) {
  const { t } = useI18n(),
    [search, setSearch] = useState(""),
    term = useDeferredValue(search),
    [selected, setSelected] = useState<any[]>([]);
  const q = useQuery(kind === "TEMPLATE" ? TEMPLATES : CATALOG, {
      variables: {
        kind: kind === "TEMPLATE" ? "FOLLOWUP" : kind,
        locationId,
        search: term,
      },
      skip: !locationId,
      fetchPolicy: "network-only",
    }),
    data =
      q.data?.[
        kind === "TEMPLATE" ? "bmsImprovementCatalog" : "bmsMaterialCatalog"
      ];
  const options = (data?.rows ?? []).map((x: any) => ({
    value: String(x.id),
    label: [x.name, x.product_sku, x.size, x.due_at, x.po_id]
      .filter(Boolean)
      .join(" · "),
  }));
  for (const x of selected)
    if (!options.some((o: any) => o.value === x.value)) options.push(x);
  return (
    <>
      <Select
        id={id}
        style={{ width: "100%" }}
        showSearch
        filterOption={false}
        mode={multiple ? "multiple" : undefined}
        value={value}
        loading={q.loading}
        onSearch={setSearch}
        onChange={(v, o) => {
          setSelected(Array.isArray(o) ? o : [o]);
          onChange?.(v);
        }}
        options={options}
        status={q.error ? "error" : undefined}
      />
      {q.error && (
        <Alert
          closable
          type="error"
          message={t("operation_material.load_error")}
        />
      )}{" "}
      {data?.hasMore && <small>{t("operation_material.search_more")}</small>}
    </>
  );
}
export default function MaterialPanel({
  locationId,
  locationName,
  staff,
  onOpenRun,
}: {
  locationId?: string;
  locationName?: string;
  staff: any[];
  onOpenRun: (id: string) => void;
}) {
  const { t } = useI18n(),
    tr = (k: string) => t(`operation_material.${k}`),
    { can } = useBmsPermissions(),
    client = useApolloClient();
  const [search, setSearch] = useState(""),
    term = useDeferredValue(search),
    [page, setPage] = useState(1),
    [selected, setSelected] = useState<string>(),
    [dialog, setDialog] = useState<any>(null),
    [pending, setPending] = useState<any>(null),
    [preview, setPreview] = useState<any>(null),
    [previewing, setPreviewing] = useState(false),
    [form] = Form.useForm();
  const sourceIds = Form.useWatch("sourceIds", form) ?? [];
  useEffect(() => {
    const id = new URLSearchParams(window.location.search).get("material");
    if (id) setSelected(id);
  }, []);
  const q = useQuery(WORK, {
      variables: {
        filter: { locationId, search: term, offset: (page - 1) * 25 },
      },
      fetchPolicy: "network-only",
    }),
    w = q.data?.bmsMaterialWorkspace;
  const detail = useQuery(DETAIL, {
      variables: { id: selected },
      skip: !selected,
      fetchPolicy: "network-only",
    }),
    d = detail.data?.bmsMaterialDetail;
  const refresh = async () => {
    await q.refetch();
    if (selected) await detail.refetch();
  };
  const m = useTeamCommand(
      refresh,
      () => {
        setDialog(null);
        setPending(null);
        setPreview(null);
      },
      { document: COMMAND, field: "bmsMaterialCommand" },
    ),
    blocked = m.busy || m.uncertain || previewing;
  const permissions: Record<string, string> = {
    CREATE: "operations.material.manage",
    CONFIRM: "operations.material.review",
    REFRESH: "operations.material.manage",
    CLOSE: "operations.material.review",
    CANCEL: "operations.material.manage",
    CREATE_PO: "operations.material.manage",
    LINK_PO: "operations.material.manage",
    LINK_REQUISITION: "operations.material.manage",
    INSPECT: "operations.material.manage",
    RECEIVE: "purchase.receive",
    CANCEL_INSPECTION: "operations.material.manage",
  };
  const allowed = (a: string) =>
    can(permissions[a]) &&
    (!["CREATE", "INSPECT"].includes(a) ||
      can("operations.checklist.manage")) &&
    (!["CREATE_PO", "LINK_PO"].includes(a) ||
      (can("purchase.view") && can("purchase.edit"))) &&
    (a !== "LINK_REQUISITION" || can("inventory.requisition.view"));
  function open(action: string, context: any = {}) {
    form.resetFields();
    setPending(null);
    setPreview(null);
    setDialog({ action, ...context });
    const day = new Date().toLocaleDateString("en-CA", {
      timeZone: "Asia/Bangkok",
    });
    form.setFieldsValue({
      from: day,
      to: day,
      qty: context.line?.uncovered ?? 1,
      acceptedQty: context.link
        ? Math.max(0, context.link.qty - context.link.received)
        : 0,
      rejectedQty: 0,
    });
  }
  function input(values: any) {
    const { sourceIds, priorities, ...v } = values;
    const i: any = { ...v, action: dialog.action, confirmed: true };
    if (v.dueAt) i.dueAt = new Date(v.dueAt).toISOString();
    if (dialog.action === "CREATE") {
      i.locationId = locationId;
      i.sources = sourceIds.map((id: string) => ({
        id,
        priority: priorities?.[id] ?? 2,
      }));
    } else {
      Object.assign(i, {
        id: d.id,
        version: d.version,
        fingerprint: d.live?.fingerprint,
      });
    }
    if (dialog.line)
      Object.assign(i, { sku: dialog.line.sku, size: dialog.line.size });
    if (dialog.link) i.linkId = dialog.link.id;
    if (dialog.inspection)
      Object.assign(i, {
        inspectionId: dialog.inspection.id,
        inspectionVersion: dialog.inspection.version,
        runVersion: dialog.inspection.run_version,
        expectedReceived: d.links.find(
          (l: any) => l.id === dialog.inspection.link_id,
        )?.qty_received,
      });
    return i;
  }
  async function review(values: any) {
    if (blocked) return;
    try {
      const i = input(values);
      if (dialog.action === "CREATE") {
        setPreviewing(true);
        const r = await client.query({
          query: PREVIEW,
          variables: {
            input: {
              locationId: i.locationId,
              from: i.from,
              to: i.to,
              sources: i.sources,
            },
          },
          fetchPolicy: "network-only",
        });
        setPreview(r.data.bmsMaterialPreview);
        i.fingerprint = r.data.bmsMaterialPreview.fingerprint;
      }
      setPending(i);
    } catch {
      message.error(tr("load_error"));
    } finally {
      setPreviewing(false);
    }
  }
  const button = (a: string, context: any = {}) =>
    allowed(a) ? (
      <Button
        key={a}
        disabled={
          blocked ||
          (!!d?.liveError &&
            [
              "CONFIRM",
              "REFRESH",
              "CREATE_PO",
              "LINK_PO",
              "LINK_REQUISITION",
            ].includes(a))
        }
        onClick={() => open(a, context)}
        style={{ whiteSpace: "normal", height: "auto", maxWidth: 180 }}
      >
        {tr(a)}
      </Button>
    ) : null;
  const columns = [
    {
      title: tr("ingredient"),
      render: (_: any, x: any) => `${x.sku} / ${x.size} · ${x.baseUnit}`,
    },
    { title: tr("required"), dataIndex: "required" },
    {
      title: tr("available"),
      dataIndex: "available",
      render: (v: any) => v ?? tr("unknown"),
    },
    {
      title: tr("pending"),
      dataIndex: "pending",
      render: (v: any) => (v === null ? tr("unknown") : (v ?? "—")),
    },
    {
      title: tr("shortage"),
      dataIndex: "shortage",
      render: (v: any) => v ?? tr("unknown"),
    },
    {
      title: tr("uncovered"),
      dataIndex: "uncovered",
      render: (v: any) => (v === null ? tr("unknown") : (v ?? "—")),
    },
    { title: tr("usableThrough"), dataIndex: "usableThrough" },
    {
      title: tr("actions"),
      render: (_: any, x: any) =>
        d?.status === "CONFIRMED" &&
        !d.liveError &&
        x.compatible &&
        x.uncovered > 0 ? (
          <Space wrap>
            {["CREATE_PO", "LINK_PO", "LINK_REQUISITION"].map((a) =>
              button(a, { line: x }),
            )}
          </Space>
        ) : null,
    },
  ];
  const taskFields = (
    <>
      <Form.Item
        name="templateId"
        label={tr("templateId")}
        rules={[{ required: true }]}
      >
        <Catalog
          kind="TEMPLATE"
          locationId={
            dialog?.action === "CREATE"
              ? (locationId ?? "")
              : (d?.location_id ?? "")
          }
        />
      </Form.Item>
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
    </>
  );
  return (
    <Space
      direction="vertical"
      style={{ width: "100%", minWidth: 0 }}
      size="middle"
    >
      <Alert
        closable
        type="info"
        showIcon
        message={tr("planning_only")}
        description={tr("expiry_policy")}
      />
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
        {locationId && button("CREATE")}
        <Button onClick={() => refresh()} disabled={blocked}>
          {tr("reload")}
        </Button>
      </Space>
      {!locationId && (
        <Alert closable message={tr("select_branch")} type="info" />
      )}
      {q.error && <Alert closable message={tr("load_error")} type="error" />}
      <div className={styles.tableWrap}>
        <Table
          rowKey="id"
          loading={q.loading}
          dataSource={w?.rows ?? []}
          scroll={{ x: 720 }}
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
              render: (v, id: any) => (
                <Button type="link" onClick={() => setSelected(id.id)}>
                  {v}
                </Button>
              ),
            },
            {
              title: tr("status"),
              dataIndex: "status",
              render: (v) => <Tag>{tr(v)}</Tag>,
            },
            { title: tr("from"), dataIndex: "from_date" },
            { title: tr("to"), dataIndex: "to_date" },
            { title: tr("version"), dataIndex: "version" },
          ]}
        />
      </div>
      <Drawer
        open={!!selected}
        onClose={() => !blocked && setSelected(undefined)}
        width={1100}
        title={tr("detail")}
        destroyOnClose
      >
        {detail.loading ? (
          <Spin />
        ) : detail.error ? (
          <Alert
            closable
            type="error"
            message={tr("load_error")}
            action={
              <Button onClick={() => detail.refetch()}>{tr("reload")}</Button>
            }
          />
        ) : (
          d && (
            <Space direction="vertical" style={{ width: "100%" }} size="middle">
              <h3>
                {d.title} <Tag>{tr(d.status)}</Tag>
              </h3>
              <p>
                {d.from_date} — {d.to_date} · {tr("version")} {d.version}
              </p>
              {d.changed && (
                <Alert closable type="warning" message={tr("changed")} />
              )}
              <Space wrap>
                <Button onClick={() => onOpenRun(d.run_id)}>
                  {tr("task")}
                </Button>
                <Button onClick={() => detail.refetch()}>{tr("reload")}</Button>
                {["DRAFT", "CONFIRMED"].includes(d.status) && (
                  <>
                    {d.status === "DRAFT" && button("CONFIRM")}
                    {button("REFRESH")}
                    {button("CLOSE")}
                    {button("CANCEL")}
                  </>
                )}
              </Space>
              <Card title={tr(d.live ? "readiness" : "saved_snapshot")}>
                {d.liveError ? (
                  <Alert
                    closable
                    type="warning"
                    message={tr("live_unavailable")}
                    description={d.liveError}
                  />
                ) : (
                  <Alert closable type="info" message={tr("live_hint")} />
                )}
                <Table
                  rowKey={(x) => JSON.stringify([x.sku, x.size])}
                  dataSource={d.live?.lines ?? d.snapshot.lines}
                  columns={columns}
                  pagination={false}
                  scroll={{ x: 1050 }}
                />
                <Table
                  rowKey="id"
                  dataSource={d.live?.sources ?? d.snapshot.sources}
                  pagination={false}
                  columns={[
                    {
                      title: tr("sources"),
                      dataIndex: "outputSku",
                      render: (v, x: any) => (
                        <Button href={`/admin/operations?production=${x.id}`}>
                          {v}
                        </Button>
                      ),
                    },
                    { title: tr("priority"), dataIndex: "priority" },
                    { title: tr("status"), dataIndex: "status" },
                    { title: tr("dueAt"), dataIndex: "dueAt" },
                  ]}
                  scroll={{ x: 600 }}
                />
              </Card>
              <Card title={tr("supplies")}>
                <Table
                  rowKey="id"
                  dataSource={d.links}
                  pagination={false}
                  scroll={{ x: 900 }}
                  columns={[
                    {
                      title: tr("ingredient"),
                      render: (_, x: any) => `${x.product_sku} / ${x.size}`,
                    },
                    {
                      title: tr("reference"),
                      render: (_, x: any) => x.po_id ?? x.requisition_id,
                    },
                    {
                      title: tr("status"),
                      render: (_, x: any) => x.po_status ?? x.request_status,
                    },
                    { title: tr("qty"), dataIndex: "qty" },
                    { title: tr("received"), dataIndex: "received" },
                    {
                      title: tr("pending"),
                      dataIndex: "pending",
                      render: (v) => v ?? tr("unknown"),
                    },
                    {
                      title: tr("unknown_receipts"),
                      dataIndex: "unknownReceipts",
                    },
                    { title: tr("dueAt"), dataIndex: "needed_at" },
                    {
                      title: tr("actions"),
                      render: (_, x: any) =>
                        d.status === "CONFIRMED" &&
                        ["OPEN", "PARTIAL"].includes(x.po_status)
                          ? button("INSPECT", { link: x })
                          : null,
                    },
                  ]}
                />
              </Card>
              <Card title={tr("inspections")}>
                <Alert closable type="info" message={tr("review_hint")} />
                <Table
                  rowKey="id"
                  dataSource={d.inspections}
                  pagination={false}
                  scroll={{ x: 850 }}
                  columns={[
                    { title: tr("acceptedQty"), dataIndex: "accepted_qty" },
                    {
                      title: tr("ingredient"),
                      render: (_, x: any) =>
                        `${x.product_sku} / ${x.size} · ${x.base_unit}`,
                    },
                    { title: tr("rejectedQty"), dataIndex: "rejected_qty" },
                    { title: tr("lotNo"), dataIndex: "lot_no" },
                    {
                      title: tr("expiryDate"),
                      dataIndex: "expiry_date",
                      render: (v) => v?.slice(0, 10),
                    },
                    {
                      title: tr("status"),
                      dataIndex: "status",
                      render: (v) => tr(v),
                    },
                    {
                      title: tr("task"),
                      render: (_, x: any) => (
                        <Button onClick={() => onOpenRun(x.run_id)}>
                          {x.run_status}
                        </Button>
                      ),
                    },
                    {
                      title: tr("actions"),
                      render: (_, x: any) =>
                        d.status === "CONFIRMED" && x.status === "PENDING" ? (
                          <Space wrap>
                            {x.run_status === "APPROVED" &&
                              button("RECEIVE", { inspection: x })}
                            {button("CANCEL_INSPECTION", { inspection: x })}
                          </Space>
                        ) : null,
                    },
                  ]}
                />
              </Card>
              <Card title={tr("receipts")}>
                <Table
                  rowKey="id"
                  dataSource={d.receipts}
                  pagination={false}
                  scroll={{ x: 850 }}
                  columns={[
                    { title: tr("ingredient"), dataIndex: "product_sku" },
                    { title: tr("qty"), dataIndex: "qty" },
                    { title: tr("lotNo"), dataIndex: "lot_no" },
                    {
                      title: tr("expiryDate"),
                      dataIndex: "expiry_date",
                      render: (v) => v?.slice(0, 10),
                    },
                    { title: tr("movement"), dataIndex: "movement_id" },
                    { title: tr("received_at"), dataIndex: "created_at" },
                  ]}
                />
              </Card>
              <Card title={tr("history")}>
                {d.historyTruncated && (
                  <Alert
                    closable
                    message={tr("history_truncated")}
                    type="info"
                  />
                )}
                <Table
                  rowKey={(_, i) => String(i)}
                  dataSource={d.events}
                  pagination={false}
                  scroll={{ x: 600 }}
                  columns={[
                    {
                      title: tr("actions"),
                      dataIndex: "action",
                      render: (v) => tr(v),
                    },
                    {
                      title: tr("version"),
                      render: (_, x: any) => x.details.version,
                    },
                    { title: tr("note"), dataIndex: "note" },
                    { title: tr("received_at"), dataIndex: "created_at" },
                  ]}
                />
              </Card>
            </Space>
          )
        )}
      </Drawer>
      <Modal
        open={!!dialog}
        title={dialog ? tr(dialog.action) : ""}
        footer={null}
        onCancel={() => !blocked && (setDialog(null), setPending(null))}
        width={680}
        destroyOnClose
      >
        <Form
          form={form}
          layout="vertical"
          onFinish={review}
          onValuesChange={() => {
            setPending(null);
            setPreview(null);
          }}
          disabled={blocked}
        >
          <p>
            {t("operation_checklists.branch")}:{" "}
            {dialog?.action === "CREATE"
              ? (locationName ?? locationId)
              : (d?.location_name ?? d?.location_id)}
          </p>
          {dialog?.link && (
            <p>
              {dialog.link.product_sku} / {dialog.link.size} ·{" "}
              {dialog.link.base_unit} · PO {dialog.link.po_id}
            </p>
          )}
          {dialog?.action === "CREATE" && (
            <>
              <Form.Item
                name="title"
                label={tr("title")}
                rules={[{ required: true, max: 160 }]}
              >
                <Input />
              </Form.Item>
              <Form.Item
                name="from"
                label={tr("from")}
                rules={[{ required: true }]}
              >
                <Input type="date" />
              </Form.Item>
              <Form.Item
                name="to"
                label={tr("to")}
                rules={[{ required: true }]}
              >
                <Input type="date" />
              </Form.Item>
              <Form.Item
                name="sourceIds"
                label={tr("sources")}
                rules={[{ required: true }]}
              >
                <Catalog
                  kind="PRODUCTION"
                  locationId={locationId ?? ""}
                  multiple
                />
              </Form.Item>
              {sourceIds.map((id: string) => (
                <Form.Item
                  key={id}
                  name={["priorities", id]}
                  label={`${tr("priority")} · ${id}`}
                  initialValue={2}
                >
                  <Select
                    options={[1, 2, 3].map((v) => ({
                      value: v,
                      label: tr(`priority_${v}`),
                    }))}
                  />
                </Form.Item>
              ))}
            </>
          )}
          {["CREATE", "INSPECT"].includes(dialog?.action) && taskFields}
          {[
            "CREATE",
            "CREATE_PO",
            "LINK_PO",
            "LINK_REQUISITION",
            "INSPECT",
          ].includes(dialog?.action) && (
            <Form.Item
              name="dueAt"
              label={tr("dueAt")}
              rules={[{ required: true }]}
            >
              <Input type="datetime-local" />
            </Form.Item>
          )}
          {dialog?.line && (
            <Alert
              closable
              type="info"
              message={`${dialog.line.sku} / ${dialog.line.size} · ${dialog.line.baseUnit}`}
              description={`${tr("uncovered")}: ${dialog.line.uncovered}`}
            />
          )}
          {["CREATE_PO", "LINK_PO", "LINK_REQUISITION"].includes(
            dialog?.action,
          ) && (
            <Form.Item
              name="qty"
              label={tr("qty")}
              rules={[{ required: true }]}
            >
              <InputNumber min={1} max={2147483647} precision={0} />
            </Form.Item>
          )}
          {dialog?.action === "CREATE_PO" && (
            <>
              <Form.Item
                name="supplierId"
                label={tr("supplierId")}
                rules={[{ required: true }]}
              >
                <Catalog kind="SUPPLIER" locationId={d?.location_id ?? ""} />
              </Form.Item>
              <Form.Item
                name="unitCost"
                label={tr("unitCost")}
                rules={[{ required: true }]}
              >
                <InputNumber min={0} precision={2} />
              </Form.Item>
            </>
          )}
          {dialog?.action === "LINK_PO" && (
            <Form.Item
              name="poItemId"
              label={tr("poItemId")}
              rules={[{ required: true }]}
            >
              <Catalog kind="PO" locationId={d?.location_id ?? ""} />
            </Form.Item>
          )}
          {dialog?.action === "LINK_REQUISITION" && (
            <>
              <Alert closable type="warning" message={tr("request_hint")} />
              <Form.Item
                name="requisitionItemId"
                label={tr("requisitionItemId")}
                rules={[{ required: true }]}
              >
                <Catalog kind="REQUISITION" locationId={d?.location_id ?? ""} />
              </Form.Item>
            </>
          )}
          {dialog?.action === "INSPECT" && (
            <>
              {["acceptedQty", "rejectedQty"].map((k) => (
                <Form.Item
                  key={k}
                  name={k}
                  label={tr(k)}
                  rules={[{ required: true }]}
                >
                  <InputNumber min={0} max={2147483647} precision={0} />
                </Form.Item>
              ))}
              <Form.Item name="lotNo" label={tr("lotNo")}>
                <Input maxLength={100} />
              </Form.Item>
              <Form.Item name="expiryDate" label={tr("expiryDate")}>
                <Input type="date" />
              </Form.Item>
            </>
          )}
          {dialog?.action === "RECEIVE" && (
            <Alert
              closable
              type="warning"
              message={tr("receive_confirm")}
              description={`${dialog.inspection.product_sku} / ${dialog.inspection.size} · ${dialog.inspection.base_unit} · PO ${dialog.inspection.po_id} · ${tr("acceptedQty")}: ${dialog.inspection.accepted_qty} · ${tr("rejectedQty")}: ${dialog.inspection.rejected_qty} · ${tr("lotNo")}: ${dialog.inspection.lot_no ?? "—"} · ${tr("expiryDate")}: ${dialog.inspection.expiry_date?.slice(0, 10) ?? "—"}`}
            />
          )}
          <Form.Item
            name="note"
            label={tr("note")}
            rules={[{ required: true, max: 2000 }]}
          >
            <Input.TextArea rows={3} />
          </Form.Item>
          <Button htmlType="submit" loading={previewing}>
            {tr("preview")}
          </Button>
        </Form>
        {preview && (
          <Table
            rowKey={(x) => JSON.stringify([x.sku, x.size])}
            dataSource={preview.lines}
            columns={columns.slice(0, 7)}
            pagination={false}
            scroll={{ x: 750 }}
          />
        )}
        {pending && (
          <Alert
            closable
            style={{ marginTop: 16 }}
            type="warning"
            message={tr("confirm_hint")}
            action={
              <Button
                type="primary"
                loading={m.busy}
                disabled={blocked}
                onClick={() => m.command(pending)}
              >
                {tr("confirm")}
              </Button>
            }
          />
        )}
      </Modal>
      {m.retry}
    </Space>
  );
}
