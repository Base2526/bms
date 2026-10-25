"use client";
import { Button, Card, Space, Table, Tabs, Typography } from "antd";
import { useI18n } from "@/lib/i18nContext";
export default function WeeklyOperationsReport({
  data,
  locations,
  staff,
  onOpenRun,
}: {
  data: any;
  locations: any[];
  staff: any[];
  onOpenRun: (id: string) => void;
}) {
  const { t } = useI18n(),
    tr = (k: string) => t(`operation_improvement.${k}`),
    branch = (id: string) => locations.find((x) => x.id === id)?.name ?? id,
    person = (id: string) => staff.find((x) => x.id === id)?.name ?? id;
  const run = (id: string) => (
    <Button onClick={() => onOpenRun(id)}>{tr("open_run")}</Button>
  );
  const production = (id: string) => (
    <Button href={`/admin/operations?production=${id}`}>{tr("detail")}</Button>
  );
  return (
    <Space direction="vertical" style={{ width: "100%" }}>
      <Typography.Text>
        {tr("as_of")}: {data.asOf} · {data.week.from} — {data.week.to}
      </Typography.Text>
      <Table
        rowKey="locationId"
        dataSource={data.branches}
        pagination={false}
        scroll={{ x: 760 }}
        columns={[
          {
            title: tr("locationId"),
            render: (_: any, x: any) => branch(x.locationId),
          },
          {
            title: tr("on_time"),
            render: (_: any, x: any) =>
              `${x.onTime}/${x.due} (${x.onTimePercent == null ? "—" : x.onTimePercent.toFixed(1) + "%"})`,
          },
          { title: tr("cancelled"), dataIndex: "cancelled" },
          { title: tr("future"), dataIndex: "future" },
          {
            title: tr("backlog"),
            render: (_: any, x: any) => x.backlog.length,
          },
          {
            title: tr("waste_value"),
            render: (_: any, x: any) =>
              `${x.wasteValue.known} THB · ${tr("unknown")}: ${x.wasteValue.unknown}`,
          },
        ]}
      />
      {data.branches.map((b: any) => (
        <Card key={b.locationId} title={branch(b.locationId)}>
          <Tabs
            items={[
              {key:'quality',label:t('operation_quality.weekly'),children:<Space direction="vertical" style={{width:'100%'}}>
                <Table rowKey="id" dataSource={b.sources.quality??[]} scroll={{x:700}} columns={[{title:t('operation_quality.title'),dataIndex:'title',render:(v,x:any)=><Button href={`/admin/operations?quality=${x.id}`}>{v}</Button>},{title:tr('status'),dataIndex:'status'},{title:t('operation_quality.dueAt'),dataIndex:'due_at'}]}/>
                <Table rowKey="id" dataSource={b.sources.qualityDisposals??[]} scroll={{x:700}} columns={[{title:t('operation_quality.lot'),render:(_,x:any)=>`${x.product_sku} / ${x.size} · ${x.base_unit}`},{title:t('operation_quality.qty'),dataIndex:'qty'},{title:t('operation_quality.value'),dataIndex:'amount',render:v=>v??tr('unknown')}]}/>
              </Space>},
              {
                key: "materials",
                label: t("operation_material.weekly"),
                children: (
                  <Space direction="vertical" style={{ width: "100%" }}>
                    <Table
                      rowKey="id"
                      dataSource={b.sources.materials ?? []}
                      scroll={{ x: 650 }}
                      columns={[
                        {
                          title: t("operation_material.title"),
                          dataIndex: "title",
                        },
                        { title: tr("status"), dataIndex: "status" },
                        { title: tr("version"), dataIndex: "version" },
                        {
                          title: tr("sourceId"),
                          render: (_, x: any) => run(x.run_id),
                        },
                      ]}
                    />
                    <Table
                      rowKey="id"
                      dataSource={b.sources.receiving ?? []}
                      scroll={{ x: 800 }}
                      columns={[
                        {
                          title: t("operation_material.ingredient"),
                          render: (_, x: any) =>
                            `${x.product_sku} / ${x.size} · ${x.base_unit}`,
                        },
                        {
                          title: t("operation_material.acceptedQty"),
                          dataIndex: "accepted_qty",
                        },
                        {
                          title: t("operation_material.rejectedQty"),
                          dataIndex: "rejected_qty",
                        },
                        { title: tr("status"), dataIndex: "status" },
                        {
                          title: tr("sourceId"),
                          render: (_, x: any) => run(x.run_id),
                        },
                      ]}
                    />
                  </Space>
                ),
              },
              {
                key: "runs",
                label: tr("runs"),
                children: (
                  <Table
                    rowKey="id"
                    dataSource={b.sources.runs}
                    scroll={{ x: 600 }}
                    columns={[
                      {
                        title: tr("sourceId"),
                        render: (_: any, x: any) => run(x.id),
                      },
                      { title: tr("status"), dataIndex: "status" },
                      { title: tr("dueAt"), dataIndex: "due_at" },
                      { title: tr("approved_at"), dataIndex: "reviewed_at" },
                    ]}
                  />
                ),
              },
              {
                key: "backlog",
                label: tr("backlog"),
                children: (
                  <Table
                    rowKey="id"
                    dataSource={b.backlog}
                    scroll={{ x: 650 }}
                    columns={[
                      {
                        title: tr("sourceId"),
                        render: (_: any, x: any) => run(x.run_id),
                      },
                      { title: tr("severity"), dataIndex: "severity" },
                      { title: tr("age"), dataIndex: "ageDays" },
                      { title: tr("status"), dataIndex: "status" },
                      { title: tr("dueAt"), dataIndex: "due_at" },
                    ]}
                  />
                ),
              },
              {
                key: "repeats",
                label: tr("repeats"),
                children: (
                  <>
                    {b.repeats.length === 0 ? (
                      <p>{tr("none")}</p>
                    ) : (
                      b.repeats.map((x: any) => (
                        <p key={`${x.familyId}:${x.version}:${x.itemKey}`}>
                          {x.category} · {x.itemKey} · v{x.version} ·{" "}
                          {x.runIds.length} {tr("runs")}{" "}
                          <Space wrap>
                            {x.runIds.map((id: string) => (
                              <span key={id}>{run(id)}</span>
                            ))}
                          </Space>
                        </p>
                      ))
                    )}
                  </>
                ),
              },
              {
                key: "yield",
                label: tr("yield"),
                children: (
                  <Table
                    rowKey={(x: any) => `${x.recipeId}:${x.sku}:${x.size}`}
                    dataSource={b.yields}
                    scroll={{ x: 700 }}
                    columns={[
                      {
                        title: tr("recipe"),
                        render: (_: any, x: any) =>
                          `${x.sku} / ${x.size} · v${x.recipeVersion}`,
                      },
                      { title: tr("unit"), dataIndex: "unit" },
                      { title: tr("planned"), dataIndex: "planned" },
                      { title: tr("actual"), dataIndex: "actual" },
                      {
                        title: tr("detail"),
                        render: (_: any, x: any) => (
                          <Space wrap>
                            {x.productionIds.map((id: string) => (
                              <span key={id}>{production(id)}</span>
                            ))}
                          </Space>
                        ),
                      },
                    ]}
                  />
                ),
              },
              {
                key: "waste",
                label: tr("waste"),
                children: (
                  <Table
                    rowKey="id"
                    dataSource={b.sources.waste}
                    scroll={{ x: 700 }}
                    columns={[
                      { title: tr("recipe"), dataIndex: "output_sku" },
                      { title: tr("unit"), dataIndex: "base_unit" },
                      { title: tr("qty"), dataIndex: "qty" },
                      {
                        title: tr("waste_value"),
                        render: (_: any, x: any) => x.amount ?? tr("unknown"),
                      },
                      { title: tr("note"), dataIndex: "reason" },
                      {
                        title: tr("detail"),
                        render: (_: any, x: any) => production(x.production_id),
                      },
                    ]}
                  />
                ),
              },
              {
                key: "handover",
                label: tr("handover"),
                children: (
                  <>
                    <p>
                      {tr("on_time")}: {b.handover.onTime} · {tr("late")}:{" "}
                      {b.handover.late} · {tr("waiting")}: {b.handover.waiting}{" "}
                      · {tr("cancelled")}: {b.handover.cancelled} ·{" "}
                      {tr("missing_handover")}: {b.handover.missing}
                    </p>
                    <Table
                      rowKey="id"
                      dataSource={b.sources.handovers}
                      scroll={{ x: 600 }}
                      columns={[
                        {
                          title: tr("sourceId"),
                          render: (_: any, x: any) => (
                            <Button href={`/admin/operations?handover=${x.id}`}>
                              {tr("detail")}
                            </Button>
                          ),
                        },
                        { title: tr("status"), dataIndex: "status" },
                        { title: tr("dueAt"), dataIndex: "due_at" },
                        { title: tr("received_at"), dataIndex: "received_at" },
                      ]}
                    />
                  </>
                ),
              },
              {
                key: "readiness",
                label: tr("readiness"),
                children: (
                  <>
                    <p>{tr("readiness_hint")}</p>
                    <Table
                      rowKey={(x: any) => `${x.roster_id}:${x.standard_id}`}
                      dataSource={b.sources.readiness}
                      scroll={{ x: 650 }}
                      columns={[
                        {
                          title: tr("staffId"),
                          render: (_: any, x: any) => person(x.assigned_to),
                        },
                        { title: tr("dutyKey"), dataIndex: "duty_key" },
                        {
                          title: tr("acknowledged"),
                          render: (_: any, x: any) =>
                            tr(
                              !x.standard_id
                                ? "not_configured"
                                : x.acknowledged
                                  ? "acknowledged"
                                  : "not_acknowledged",
                            ),
                        },
                        {
                          title: tr("training"),
                          render: (_: any, x: any) =>
                            tr(
                              !x.standard_id
                                ? "not_configured"
                                : !x.training_required
                                  ? "training_optional"
                                  : x.trained
                                    ? "trained"
                                    : "not_trained",
                            ),
                        },
                        {
                          title: tr("assessment"),
                          render: (_: any, x: any) =>
                            tr(
                              !x.standard_id
                                ? "not_configured"
                                : !x.training_required
                                  ? "training_optional"
                                  : x.assessment === "PASS"
                                    ? "passed"
                                    : x.assessment === "PRACTICE"
                                      ? "practice"
                                      : "not_assessed",
                            ),
                        },
                      ]}
                    />
                  </>
                ),
              },
            ]}
          />
        </Card>
      ))}
    </Space>
  );
}
