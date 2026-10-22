"use client";

import { gql, useMutation, useQuery } from "@apollo/client";
import {
  Alert,
  Button,
  Card,
  Drawer,
  Empty,
  Form,
  Input,
  InputNumber,
  Modal,
  Select,
  Space,
  Spin,
  Table,
  Tag,
  Timeline,
  Typography,
  message,
} from "antd";
import { useDeferredValue, useRef, useState, useEffect } from "react";
import Link from "next/link";
import { useBmsPermissions } from "@/app/hooks/useBmsPermissions";
import { useI18n } from "@/lib/i18nContext";
import styles from "./requisitions.module.css";

const FIELDS = gql`
  fragment RequisitionFields on BmsRequisition {
    id
    requestNo
    locationId
    locationName
    status
    version
    neededOn
    priority
    note
    creator
    latestActor
    createdAt
    items {
      id
      sku
      size
      name
      requested
      approved
      reviewNote
      drafts
      transit
      received
      discrepancy
      remaining
      status
      transfers {
        id
        number
        status
        qty
        received
        damaged
      }
      purchases {
        id
        status
        qty
        ordered
        received
      }
    }
  }
`;
const LIST = gql`
  query BranchRequests($filter: BmsRequisitionFilter) {
    bmsBranchRequisitions(filter: $filter) {
      total
      locations {
        id
        name
        active
      }
      rows {
        ...RequisitionFields
      }
    }
  }
  ${FIELDS}
`;
const EVENTS = gql`
  query RequestEvents($id: ID!) {
    bmsBranchRequisitionEvents(id: $id) {
      action
      note
      actor
      at
    }
  }
`;
const CATALOG = gql`
  query RequestCatalog($search: String!) {
    bmsBranchRequisitionCatalog(search: $search) {
      sku
      size
      name
    }
  }
`;
const AVAILABILITY = gql`
  query RequestAvailability($sku: String!, $size: String!) {
    bmsBranchRequisitionAvailability(sku: $sku, size: $size) {
      id
      name
      stock
      reserved
      quarantine
      available
    }
  }
`;
const DEMAND = gql`
  query RequestDemand($search: String, $offset: Int) {
    bmsBranchRequisitionDemand(search: $search, offset: $offset) {
      total
      rows {
        sku
        size
        name
        remaining
        requests
      }
    }
  }
`;
const SUPPLIERS = gql`
  query RequisitionSuppliers {
    bmsSuppliers {
      id
      name
    }
  }
`;
const POS = gql`
  query RequisitionPOs($search: String) {
    bmsPurchaseOrders(search: $search, limit: 30) {
      id
      status
      supplier {
        name
      }
    }
  }
`;
const COMMAND = gql`
  mutation RequestCommand($input: BmsRequisitionCommandInput!) {
    bmsBranchRequisitionCommand(input: $input) {
      status
      id
      transferId
      poId
    }
  }
`;
const METRICS = gql`
  query RequisitionMetrics {
    bmsBranchRequisitionMetrics {
      submittedRequests
      requestedUnits
      pendingReview
      reviewedRequests
      approvedRequests
      partialRequests
      approvedUnits
      receivedUnits
      unallocatedUnits
      overdueRequests
      discrepancyUnits
      medianReviewHours
      medianFulfilmentHours
    }
  }
`;
const NOTICES = gql`
  query RequisitionNotices {
    bmsBranchRequisitionNotices {
      id
      requestId
      requestNo
      kind
      at
    }
  }
`;
const DEMAND_REQUESTS = gql`
  query RequisitionDemandRequests($sku: String!, $size: String!, $offset: Int) {
    bmsBranchRequisitionDemandRequests(
      sku: $sku
      size: $size
      offset: $offset
    ) {
      total
      rows {
        id
        requestNo
        branch
        neededOn
        priority
        remaining
      }
    }
  }
`;
function DemandRequests({
  sku,
  size,
  onSelect,
}: {
  sku: string;
  size: string;
  onSelect: (id: string) => void;
}) {
  const { t } = useI18n();
  const [page, setPage] = useState(1);
  const { data, loading, error } = useQuery(DEMAND_REQUESTS, {
    variables: { sku, size, offset: (page - 1) * 20 },
    fetchPolicy: "network-only",
  });
  if (error)
    return <Alert closable type="error" message={t("branch_requisitions.load_error")} />;
  return (
    <Table
      rowKey="id"
      size="small"
      loading={loading}
      dataSource={data?.bmsBranchRequisitionDemandRequests.rows ?? []}
      pagination={{
        current: page,
        pageSize: 20,
        total: data?.bmsBranchRequisitionDemandRequests.total ?? 0,
        onChange: setPage,
        showSizeChanger: false,
      }}
      columns={[
        {
          title: t("branch_requisitions.request"),
          render: (_: unknown, r: any) => (
            <>
              <Button type="link" onClick={() => onSelect(r.id)}>
                {r.requestNo}
              </Button>
              <div>{r.branch}</div>
              <small>
                {r.neededOn ?? "—"} · {t(`branch_requisitions.${r.priority}`)}
              </small>
            </>
          ),
        },
        { title: t("branch_requisitions.remaining"), dataIndex: "remaining" },
      ]}
    />
  );
}
type Line = {
  id?: string;
  sku: string;
  size: string;
  name: string;
  requested: number;
  approved: number | null;
  remaining: number;
  drafts: number;
  transit: number;
  received: number;
  discrepancy: number;
  status: string;
  reviewNote: string;
  transfers: any[];
  purchases: any[];
};
type Request = {
  id: string;
  requestNo: string;
  locationId: string;
  locationName: string;
  status: string;
  version: number;
  neededOn: string | null;
  priority: string;
  note: string;
  creator: string;
  latestActor: string;
  createdAt: string;
  items: Line[];
};
type DraftLine = {
  sku: string;
  size: string;
  name: string;
  qty: number;
  unitCost?: number | null;
  note?: string;
  requested?: number;
};
const STATES = [
  "DRAFT",
  "SUBMITTED",
  "APPROVED",
  "REJECTED",
  "CLOSED",
  "CANCELLED",
];

export default function BranchRequisitionsPage() {
  const { t } = useI18n();
  const { can, loading: permsLoading } = useBmsPermissions();
  const view = can("inventory.requisition.view"),
    create = can("inventory.requisition.create"),
    review = can("inventory.requisition.review");
  const [search, setSearch] = useState("");
  const deferredSearch = useDeferredValue(search);
  const [status, setStatus] = useState<string | undefined>();
  const [branch, setBranch] = useState<string | undefined>();
  const [priority, setPriority] = useState<string | undefined>();
  const [neededFrom, setNeededFrom] = useState("");
  const [neededTo, setNeededTo] = useState("");
  const [page, setPage] = useState(1);
  const [tab, setTab] = useState("requests");
  const [demandPage, setDemandPage] = useState(1);
  const [selected, setSelected] = useState<string>();
  useEffect(() => {
    const id = new URLSearchParams(window.location.search).get("id");
    if (
      id &&
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)
    )
      setSelected(id);
  }, []);
  const list = useQuery(LIST, {
    variables: {
      filter: {
        search: deferredSearch,
        status: tab === "review" ? "SUBMITTED" : status,
        priority,
        neededFrom: neededFrom || null,
        neededTo: neededTo || null,
        locationId: branch,
        limit: 20,
        offset: (page - 1) * 20,
      },
    },
    skip: !view,
    fetchPolicy: "network-only",
  });
  const detail = useQuery(LIST, {
    variables: { filter: { id: selected } },
    skip: !selected || !view,
    fetchPolicy: "network-only",
  });
  const events = useQuery(EVENTS, {
    variables: { id: selected },
    skip: !selected || !view,
    fetchPolicy: "network-only",
  });
  const demand = useQuery(DEMAND, {
    variables: { search: deferredSearch, offset: (demandPage - 1) * 20 },
    skip: !review || tab !== "demand",
    fetchPolicy: "network-only",
  });
  const row: Request | undefined = detail.data?.bmsBranchRequisitions.rows[0];
  const metrics = useQuery(METRICS, {
    skip: !view || !review || tab !== "metrics",
    fetchPolicy: "network-only",
  });
  const notices = useQuery(NOTICES, {
    skip: !view,
    fetchPolicy: "network-only",
    pollInterval: 60000,
  });
  const locations: { id: string; name: string; active: boolean }[] =
    list.data?.bmsBranchRequisitions.locations ?? [];
  const [mode, setMode] = useState<string>();
  const [editing, setEditing] = useState<Request>();
  const [lines, setLines] = useState<DraftLine[]>([]);
  const [form] = Form.useForm();
  const [catalogSearch, setCatalogSearch] = useState("");
  const catalog = useQuery(CATALOG, {
    variables: { search: useDeferredValue(catalogSearch) },
    skip: mode !== "SAVE" || !create,
  });
  const [stockLine, setStockLine] = useState<{ sku: string; size: string }>();
  const availability = useQuery(AVAILABILITY, {
    variables: { sku: stockLine?.sku, size: stockLine?.size },
    skip: !stockLine || !view,
    fetchPolicy: "network-only",
  });
  const suppliers = useQuery(SUPPLIERS, {
    skip: mode !== "CREATE_PO" || !can("purchase.view"),
  });
  const [poSearch, setPoSearch] = useState("");
  const pos = useQuery(POS, {
    variables: { search: useDeferredValue(poSearch) },
    skip: mode !== "LINK_PO" || !can("purchase.view"),
    fetchPolicy: "network-only",
  });
  const [mutate, { loading: busy }] = useMutation(COMMAND);
  const retry = useRef<{ body: string; key: string } | null>(null);
  const tr = (s: string) => t(`branch_requisitions.${s}`);
  const refresh = async () => {
    try {
      await list.refetch();
      void notices.refetch().catch(() => {});
      if (selected) {
        await detail.refetch();
        await events.refetch();
      }
      if (tab === "demand" && review) await demand.refetch();
      if (tab === "metrics" && review) await metrics.refetch();
    } catch {
      // A failed read does not turn an already-confirmed mutation into an unknown write.
      message.error(tr("load_error"));
    }
  };
  function open(action: string, r?: Request) {
    setMode(action);
    setEditing(r);
    retry.current = null;
    setLines(
      (r?.items ?? []).map((i) => ({
        sku: i.sku,
        size: i.size,
        name: i.name,
        qty: ["SAVE", "REVIEW", "SUBMIT"].includes(action)
          ? i.requested
          : i.remaining,
        unitCost: null,
        requested: i.requested,
        note: "",
      })),
    );
    form.resetFields();
    form.setFieldsValue({
      locationId: r?.locationId,
      neededOn: r?.neededOn,
      priority: r?.priority ?? "NORMAL",
      note: action === "SAVE" ? r?.note : "",
    });
  }
  async function execute(input: Record<string, unknown>) {
    const body = JSON.stringify(input);
    if (retry.current?.body !== body)
      retry.current = { body, key: crypto.randomUUID() };
    try {
      const result = await mutate({
        variables: { input: { ...input, idempotencyKey: retry.current.key } },
      });
      const outcome = result.data?.bmsBranchRequisitionCommand;
      if (outcome?.status !== "OK") {
        retry.current = null;
        message.error(tr(outcome?.status ?? "INVALID_INPUT"));
        if (outcome?.status === "STALE_VERSION") {
          setMode(undefined);
          await refresh();
        }
        return false;
      }
      retry.current = null;
      setMode(undefined);
      message.success(tr("saved"));
      if (outcome.id) setSelected(outcome.id);
      await refresh();
      return true;
    } catch {
      message.error(tr("network_error"));
      return false;
    }
  }
  async function submitForm() {
    const values = await form.validateFields().catch(() => null);
    if (!values || !mode) return;
    const input = {
      action: mode,
      ...(editing ? { id: editing.id, version: editing.version } : {}),
      ...values,
      ...(["SAVE", "REVIEW", "TRANSFER", "LINK_PO", "CREATE_PO"].includes(mode)
        ? {
            items: lines
              .filter((l) => ["SAVE", "REVIEW"].includes(mode) || l.qty > 0)
              .map((line) => ({
                sku: line.sku,
                size: line.size,
                qty: line.qty,
                ...(mode === "REVIEW" ? { note: line.note } : {}),
                ...(mode === "CREATE_PO" ? { unitCost: line.unitCost } : {}),
              })),
          }
        : {}),
    };
    if (mode === "SAVE") {
      await execute(input);
      return;
    }
    Modal.confirm({
      title: tr("confirm"),
      content: (
        <div>
          <p>
            {tr(mode)} · {editing?.requestNo}
          </p>
          {values.sourceId && (
            <p>
              {tr("source")}:{" "}
              {locations.find((l) => l.id === values.sourceId)?.name} →{" "}
              {editing?.locationName}
            </p>
          )}
          {values.supplierId && (
            <p>
              {tr("supplier")}:{" "}
              {
                suppliers.data?.bmsSuppliers.find(
                  (s: any) => s.id === values.supplierId,
                )?.name
              }
            </p>
          )}
          {values.poId && <p>PO: {values.poId}</p>}
          {["SUBMIT", "REVIEW", "TRANSFER", "LINK_PO", "CREATE_PO"].includes(
            mode,
          ) &&
            lines
              .filter((l) => mode === "REVIEW" || l.qty > 0)
              .map((l) => (
                <p key={`${l.sku}:${l.size}`}>
                  {l.name} · {l.sku}/{l.size}: {l.qty}
                  {mode === "CREATE_PO" ? ` × ${l.unitCost ?? "—"}` : ""}
                  {l.note ? ` · ${l.note}` : ""}
                </p>
              ))}
          {values.note && <p>{values.note}</p>}
        </div>
      ),
      okText: tr("confirm"),
      cancelText: tr("back"),
      onOk: async () => {
        if (!(await execute({ ...input, confirmed: true })))
          throw new Error("Refused");
      },
    });
  }
  if (permsLoading) return <Spin />;
  if (!view) return <Alert closable type="warning" message={tr("denied")} />;
  return (
    <div className={styles.page}>
      <div className={styles.toolbar}>
        <div>
          <Typography.Title level={3}>{tr("title")}</Typography.Title>
          <Typography.Text type="secondary">{tr("help")}</Typography.Text>
        </div>
        <Space wrap>
          <Button onClick={() => void refresh()} loading={list.loading}>
            {tr("refresh")}
          </Button>
          {create && (
            <Button type="primary" onClick={() => open("SAVE")}>
              {tr("new")}
            </Button>
          )}
        </Space>
      </div>
      {list.error && (
        <Alert closable type="error" showIcon message={tr("load_error")} />
      )}
      {notices.error && <Alert closable type="warning" message={tr("notices_error")} />}
      {(notices.data?.bmsBranchRequisitionNotices.length ?? 0) > 0 && (
        <details>
          <summary>{tr("notices")}</summary>
          {notices.data.bmsBranchRequisitionNotices.map((n: any) => (
            <div key={n.id}>
              <Button type="link" onClick={() => setSelected(n.requestId)}>
                {n.requestNo} · {tr(n.kind)}
              </Button>
              <small>{new Date(n.at).toLocaleString()}</small>
            </div>
          ))}
        </details>
      )}
      {!list.loading && locations.filter((l) => l.active).length < 2 && (
        <Alert closable type="info" message={tr("branch_help")} />
      )}
      <Space wrap>
        <Button
          type={tab === "requests" ? "primary" : "default"}
          onClick={() => setTab("requests")}
        >
          {tr("requests")}
        </Button>
        {review && (
          <Button
            type={tab === "demand" ? "primary" : "default"}
            onClick={() => setTab("demand")}
          >
            {tr("demand")}
          </Button>
        )}
        {review && (
          <Button
            type={tab === "review" ? "primary" : "default"}
            onClick={() => {
              setTab("review");
              setPage(1);
            }}
          >
            {tr("review_queue")}
          </Button>
        )}
        {review && (
          <Button
            type={tab === "metrics" ? "primary" : "default"}
            onClick={() => setTab("metrics")}
          >
            {tr("metrics")}
          </Button>
        )}
      </Space>
      {tab !== "metrics" && (
        <div className={styles.filters}>
          <Input
            value={search}
            placeholder={tr("search")}
            onChange={(e) => {
              setSearch(e.target.value);
              setPage(1);
              setDemandPage(1);
            }}
            allowClear
          />
          {["requests", "review"].includes(tab) && (
            <>
              <Select
                disabled={tab === "review"}
                allowClear
                placeholder={tr("status")}
                value={tab === "review" ? "SUBMITTED" : status}
                onChange={(v) => {
                  setStatus(v);
                  setPage(1);
                }}
                options={STATES.map((s) => ({ value: s, label: tr(s) }))}
              />
              <Select
                allowClear
                placeholder={tr("branch")}
                value={branch}
                onChange={(v) => {
                  setBranch(v);
                  setPage(1);
                }}
                options={locations.map((l) => ({ value: l.id, label: l.name }))}
              />
              <Select
                allowClear
                placeholder={tr("priority")}
                value={priority}
                onChange={(v) => {
                  setPriority(v);
                  setPage(1);
                }}
                options={["NORMAL", "URGENT"].map((v) => ({
                  value: v,
                  label: tr(v),
                }))}
              />
              <label>
                {tr("needed_from")}
                <Input
                  type="date"
                  aria-label={tr("needed_from")}
                  value={neededFrom}
                  onChange={(e) => {
                    setNeededFrom(e.target.value);
                    setPage(1);
                  }}
                />
              </label>
              <label>
                {tr("needed_to")}
                <Input
                  type="date"
                  aria-label={tr("needed_to")}
                  value={neededTo}
                  onChange={(e) => {
                    setNeededTo(e.target.value);
                    setPage(1);
                  }}
                />
              </label>
            </>
          )}
        </div>
      )}
      {tab === "metrics" ? (
        <>
          <Alert closable type="info" message={tr("metrics_help")} />
          {metrics.error ? (
            <Alert closable type="error" message={tr("load_error")} />
          ) : metrics.loading ? (
            <Spin />
          ) : (
            metrics.data &&
            (() => {
              const m = metrics.data.bmsBranchRequisitionMetrics;
              const ratio = (n: number, d: number) =>
                d > 0 ? `${((n / d) * 100).toFixed(1)}%` : "—";
              const facts: [string, number | string][] = [
                ["submitted_total", m.submittedRequests],
                ["requested", m.requestedUnits],
                ["review_queue", m.pendingReview],
                [
                  "approval_rate",
                  ratio(m.approvedRequests, m.reviewedRequests),
                ],
                ["partial_rate", ratio(m.partialRequests, m.reviewedRequests)],
                ["fill_rate", ratio(m.receivedUnits, m.approvedUnits)],
                ["approved", m.approvedUnits],
                ["received", m.receivedUnits],
                ["remaining", m.unallocatedUnits],
                ["overdue", m.overdueRequests],
                ["discrepancy", m.discrepancyUnits],
                [
                  "review_hours",
                  m.medianReviewHours == null
                    ? "—"
                    : Number(m.medianReviewHours).toFixed(1),
                ],
                [
                  "fulfilment_hours",
                  m.medianFulfilmentHours == null
                    ? "—"
                    : Number(m.medianFulfilmentHours).toFixed(1),
                ],
              ];
              return (
                <div className={styles.metrics}>
                  {facts.map(([label, value]) => (
                    <Card key={label} size="small" title={tr(label)}>
                      <Typography.Title level={3}>{value}</Typography.Title>
                    </Card>
                  ))}
                </div>
              );
            })()
          )}
        </>
      ) : tab !== "demand" ? (
        <Table<Request>
          rowKey="id"
          loading={list.loading}
          dataSource={list.data?.bmsBranchRequisitions.rows ?? []}
          pagination={{
            current: page,
            pageSize: 20,
            total: list.data?.bmsBranchRequisitions.total ?? 0,
            onChange: setPage,
            showSizeChanger: false,
          }}
          columns={[
            {
              title: tr("request"),
              render: (_, r) => (
                <>
                  <Button type="link" onClick={() => setSelected(r.id)}>
                    {r.requestNo}
                  </Button>
                  <div>
                    {r.locationName} · <Tag>{tr(r.priority)}</Tag>
                  </div>
                  <small>{r.neededOn || "—"}</small>
                  <div>
                    <small>
                      {tr("requested")}:{" "}
                      {r.items.reduce((n, l) => n + l.requested, 0)} ·{" "}
                      {tr("line_count")}: {r.items.length}
                    </small>
                  </div>
                </>
              ),
            },
            {
              title: tr("status"),
              render: (_, r) => (
                <>
                  <Tag>{tr(r.status)}</Tag>
                  <div>
                    {r.items.reduce((n, l) => n + l.received, 0)} /{" "}
                    {r.items.reduce((n, l) => n + (l.approved ?? 0), 0)}{" "}
                    {tr("received")}
                  </div>
                </>
              ),
            },
            {
              title: tr("latest_actor"),
              dataIndex: "latestActor",
              responsive: ["md"],
            },
          ]}
        />
      ) : (
        <>
          <Alert closable type="info" message={tr("demand_help")} />
          {demand.error && (
            <Alert closable type="error" message={tr("load_error")} />
          )}
          <Table
            rowKey={(r: any) => `${r.sku}:${r.size}`}
            loading={demand.loading}
            dataSource={demand.data?.bmsBranchRequisitionDemand.rows ?? []}
            expandable={{
              expandedRowRender: (r: any) => (
                <DemandRequests
                  key={`${r.sku}:${r.size}`}
                  sku={r.sku}
                  size={r.size}
                  onSelect={setSelected}
                />
              ),
            }}
            pagination={{
              current: demandPage,
              pageSize: 20,
              total: demand.data?.bmsBranchRequisitionDemand.total ?? 0,
              onChange: setDemandPage,
              showSizeChanger: false,
            }}
            columns={[
              {
                title: tr("product"),
                render: (_: unknown, r: any) => (
                  <Button
                    type="link"
                    onClick={() => {
                      setSearch(r.sku);
                      setStatus("APPROVED");
                      setBranch(undefined);
                      setTab("requests");
                      setPage(1);
                    }}
                  >
                    {r.name}
                    <br />
                    {r.sku} / {r.size}
                  </Button>
                ),
              },
              { title: tr("remaining"), dataIndex: "remaining" },
              {
                title: tr("requests"),
                dataIndex: "requests",
                responsive: ["md"],
              },
              {
                title: tr("stock"),
                render: (_: unknown, r: any) => (
                  <Button onClick={() => setStockLine(r)}>
                    {tr("check_stock")}
                  </Button>
                ),
              },
            ]}
          />
        </>
      )}
      <Drawer
        open={!!selected}
        onClose={() => setSelected(undefined)}
        width={760}
        title={row?.requestNo ?? tr("request")}
      >
        {detail.loading ? (
          <Spin />
        ) : detail.error ? (
          <Alert closable type="error" message={tr("load_error")} />
        ) : !row ? (
          <Empty />
        ) : (
          <Space direction="vertical" className={styles.full} size="large">
            <div>
              <Tag>{tr(row.status)}</Tag>
              <Tag>{tr(row.priority)}</Tag>
              <p>
                {row.locationName} · {row.neededOn || "—"}
              </p>
              <p>
                {tr("actor")}: {row.creator}
              </p>
              <p>{row.note}</p>
            </div>
            <Space wrap>
              {row.status === "DRAFT" && create && (
                <>
                  <Button onClick={() => open("SAVE", row)}>
                    {tr("edit")}
                  </Button>
                  <Button type="primary" onClick={() => open("SUBMIT", row)}>
                    {tr("SUBMIT")}
                  </Button>
                </>
              )}
              {row.status === "SUBMITTED" && review && (
                <Button type="primary" onClick={() => open("REVIEW", row)}>
                  {tr("REVIEW")}
                </Button>
              )}
              {row.status === "APPROVED" && review && (
                <>
                  {can("inventory.transfer") && (
                    <Button
                      type="primary"
                      onClick={() => open("TRANSFER", row)}
                    >
                      {tr("TRANSFER")}
                    </Button>
                  )}
                  {can("purchase.edit") && can("purchase.view") && (
                    <>
                      <Button onClick={() => open("CREATE_PO", row)}>
                        {tr("CREATE_PO")}
                      </Button>
                      <Button onClick={() => open("LINK_PO", row)}>
                        {tr("LINK_PO")}
                      </Button>
                    </>
                  )}
                  <Button onClick={() => open("CLOSE", row)}>
                    {tr("CLOSE")}
                  </Button>
                </>
              )}
              {["DRAFT", "SUBMITTED", "APPROVED"].includes(row.status) &&
                create && (
                  <Button danger onClick={() => open("CANCEL", row)}>
                    {tr("CANCEL")}
                  </Button>
                )}
            </Space>
            {row.items.map((i) => (
              <Card
                key={i.id}
                size="small"
                title={`${i.name} · ${i.sku} / ${i.size}`}
              >
                <div className={styles.facts}>
                  <span>
                    {tr("requested")}: {i.requested}
                  </span>
                  <span>
                    {tr("approved")}: {i.approved ?? "—"}
                  </span>
                  <span>
                    {tr("drafts")}: {i.drafts}
                  </span>
                  <span>
                    {tr("transit")}: {i.transit}
                  </span>
                  <span>
                    {tr("received")}: {i.received}
                  </span>
                  <span>
                    {tr("remaining")}: {i.remaining}
                  </span>
                </div>
                {i.discrepancy > 0 && (
                  <Alert
                    closable
                    type="warning"
                    message={`${tr("discrepancy")}: ${i.discrepancy}`}
                  />
                )}
                <p>{i.reviewNote}</p>
                {view && (
                  <Button onClick={() => setStockLine(i)}>
                    {tr("check_stock")}
                  </Button>
                )}
                {i.transfers.map((x) => (
                  <p key={x.id}>
                    {can("inventory.transfer") ? (
                      <Link
                        href={`/admin/stock-transfers?id=${encodeURIComponent(x.id)}`}
                      >
                        {x.number}
                      </Link>
                    ) : (
                      x.number
                    )}{" "}
                    · {tr(x.status)} · {x.qty} / {x.received ?? 0}
                  </p>
                ))}
                {i.purchases.length > 0 && (
                  <>
                    <Alert closable type="info" message={tr("po_evidence")} />
                    {i.purchases.map((p) => (
                      <p key={p.id}>
                        <Link
                          href={`/admin/purchase?id=${encodeURIComponent(p.id)}`}
                        >
                          PO {p.id.slice(0, 8)}
                        </Link>{" "}
                        · {tr(p.status)} · {tr("linked_qty")}: {p.qty}
                        <br />
                        {tr("po_line_received")}: {p.received} / {p.ordered}
                      </p>
                    ))}
                  </>
                )}
              </Card>
            ))}
            <Typography.Title level={5}>{tr("timeline")}</Typography.Title>
            {events.error && (
              <Alert closable type="error" message={tr("load_error")} />
            )}
            <Timeline
              items={(events.data?.bmsBranchRequisitionEvents ?? []).map(
                (e: any) => ({
                  children: (
                    <>
                      <strong>{tr(e.action)}</strong>
                      <p>
                        {e.actor} · {new Date(e.at).toLocaleString()}
                      </p>
                      <p>{e.note}</p>
                    </>
                  ),
                }),
              )}
            />
          </Space>
        )}
      </Drawer>
      <Modal
        open={!!mode}
        width={760}
        title={mode ? tr(mode) : ""}
        onCancel={() => setMode(undefined)}
        onOk={() => void submitForm()}
        confirmLoading={busy}
        okText={mode === "SAVE" ? tr("save") : tr("review_confirm")}
        cancelText={tr("back")}
        destroyOnClose
      >
        <Form form={form} layout="vertical" preserve={false}>
          {mode === "SAVE" && (
            <>
              <Form.Item
                name="locationId"
                label={tr("branch")}
                rules={[{ required: true }]}
              >
                <Select
                  options={locations
                    .filter((l) => l.active)
                    .map((l) => ({ value: l.id, label: l.name }))}
                />
              </Form.Item>
              <Form.Item name="neededOn" label={tr("needed_on")}>
                <Input type="date" />
              </Form.Item>
              <Form.Item name="priority" label={tr("priority")}>
                <Select
                  options={["NORMAL", "URGENT"].map((v) => ({
                    value: v,
                    label: tr(v),
                  }))}
                />
              </Form.Item>
              <Select
                className={styles.full}
                showSearch
                filterOption={false}
                value={null}
                placeholder={tr("add_product")}
                onSearch={setCatalogSearch}
                loading={catalog.loading}
                options={(catalog.data?.bmsBranchRequisitionCatalog ?? []).map(
                  (p: any) => ({
                    value: JSON.stringify([p.sku, p.size]),
                    label: `${p.name} · ${p.sku}/${p.size}`,
                  }),
                )}
                onSelect={(v) => {
                  const p = catalog.data?.bmsBranchRequisitionCatalog.find(
                    (p: any) => JSON.stringify([p.sku, p.size]) === v,
                  );
                  if (
                    p &&
                    !lines.some((l) => l.sku === p.sku && l.size === p.size)
                  )
                    setLines([
                      ...lines,
                      { sku: p.sku, size: p.size, name: p.name, qty: 1 },
                    ]);
                }}
              />
              {catalog.error && (
                <Alert closable type="error" message={tr("load_error")} />
              )}
            </>
          )}
          {mode === "TRANSFER" && (
            <>
              <Alert closable type="info" message={tr("transfer_help")} />
              <Form.Item
                name="sourceId"
                label={tr("source")}
                rules={[{ required: true }]}
              >
                <Select
                  options={locations
                    .filter((l) => l.active && l.id !== editing?.locationId)
                    .map((l) => ({ value: l.id, label: l.name }))}
                />
              </Form.Item>
            </>
          )}
          {mode === "CREATE_PO" && (
            <Form.Item
              name="supplierId"
              label={tr("supplier")}
              rules={[{ required: true }]}
            >
              <Select
                loading={suppliers.loading}
                options={(suppliers.data?.bmsSuppliers ?? []).map((s: any) => ({
                  value: s.id,
                  label: s.name,
                }))}
              />
            </Form.Item>
          )}
          {mode === "LINK_PO" && (
            <Form.Item name="poId" label="PO" rules={[{ required: true }]}>
              <Select
                showSearch
                filterOption={false}
                onSearch={setPoSearch}
                loading={pos.loading}
                options={(pos.data?.bmsPurchaseOrders ?? [])
                  .filter((p: any) => ["OPEN", "PARTIAL"].includes(p.status))
                  .map((p: any) => ({
                    value: p.id,
                    label: `${p.id.slice(0, 8)} · ${p.supplier?.name ?? "—"} · ${p.status}`,
                  }))}
              />
            </Form.Item>
          )}
          {((mode === "CREATE_PO" && suppliers.error) ||
            (mode === "LINK_PO" && pos.error)) && (
            <Alert closable type="error" message={tr("load_error")} />
          )}
          {["CREATE_PO", "LINK_PO"].includes(mode ?? "") && (
            <Alert closable type="info" message={tr("po_evidence")} />
          )}
          {["SAVE", "REVIEW", "TRANSFER", "LINK_PO", "CREATE_PO"].includes(
            mode ?? "",
          ) && (
            <div className={styles.lines}>
              {lines.map((l, n) => (
                <div key={`${l.sku}:${l.size}`} className={styles.line}>
                  <div>
                    {l.name}
                    <br />
                    <Typography.Text type="secondary">
                      {l.sku} / {l.size}
                    </Typography.Text>
                    {mode === "REVIEW" && (
                      <div>
                        {tr("requested")}: {l.requested}
                      </div>
                    )}
                    {(mode === "SAVE" || mode === "REVIEW") && (
                      <Button size="small" onClick={() => setStockLine(l)}>
                        {tr("check_stock")}
                      </Button>
                    )}
                  </div>
                  <label>
                    {tr("qty")}
                    <InputNumber
                      aria-label={`${tr("qty")} ${l.sku}`}
                      min={mode === "SAVE" ? 1 : 0}
                      max={mode === "REVIEW" ? l.requested : 1_000_000}
                      precision={0}
                      value={l.qty}
                      onChange={(v) =>
                        setLines(
                          lines.map((x, i) =>
                            i === n ? { ...x, qty: v ?? 0 } : x,
                          ),
                        )
                      }
                    />
                  </label>
                  {mode === "CREATE_PO" && (
                    <label>
                      {tr("unit_cost")}
                      <InputNumber
                        aria-label={`${tr("unit_cost")} ${l.sku}`}
                        min={0}
                        precision={2}
                        value={l.unitCost}
                        onChange={(v) =>
                          setLines(
                            lines.map((x, i) =>
                              i === n ? { ...x, unitCost: v } : x,
                            ),
                          )
                        }
                      />
                    </label>
                  )}
                  {mode === "REVIEW" && (
                    <Input
                      aria-label={`${tr("line_reason")} ${l.sku}`}
                      placeholder={tr("line_reason")}
                      maxLength={2000}
                      value={l.note}
                      onChange={(e) =>
                        setLines(
                          lines.map((x, i) =>
                            i === n ? { ...x, note: e.target.value } : x,
                          ),
                        )
                      }
                    />
                  )}
                  {mode === "SAVE" && (
                    <Button
                      danger
                      onClick={() => setLines(lines.filter((_, i) => i !== n))}
                    >
                      {tr("remove")}
                    </Button>
                  )}
                </div>
              ))}
            </div>
          )}
          <Form.Item
            name="note"
            label={tr("note")}
            rules={[{ required: ["CANCEL", "CLOSE"].includes(mode ?? "") }]}
          >
            <Input.TextArea rows={3} maxLength={2000} />
          </Form.Item>
          {mode === "REVIEW" && (
            <Alert closable type="info" message={tr("review_help")} />
          )}
        </Form>
      </Modal>
      <Modal
        open={!!stockLine}
        title={`${tr("stock")} · ${stockLine?.sku ?? ""} / ${stockLine?.size ?? ""}`}
        onCancel={() => setStockLine(undefined)}
        footer={
          <Button onClick={() => setStockLine(undefined)}>{tr("back")}</Button>
        }
      >
        <Alert closable type="info" message={tr("availability_help")} />
        {availability.error && (
          <Alert closable type="error" message={tr("load_error")} />
        )}
        {availability.loading ? (
          <Spin />
        ) : (
          (availability.data?.bmsBranchRequisitionAvailability ?? []).map(
            (s: any) => (
              <Card key={s.id} size="small" title={s.name}>
                <div className={styles.facts}>
                  <span>
                    {tr("available")}: {s.available}
                  </span>
                  <span>
                    {tr("reserved")}: {s.reserved}
                  </span>
                  <span>
                    {tr("quarantine")}: {s.quarantine}
                  </span>
                </div>
              </Card>
            ),
          )
        )}
      </Modal>
    </div>
  );
}
