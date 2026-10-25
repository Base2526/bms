"use client";
import { gql, useQuery } from "@apollo/client";
import { Alert, Tag, Space } from "antd";
import { useI18n } from "@/lib/i18nContext";
const READINESS = gql`
  query StandardReadiness($locationId: ID!, $staffId: ID!, $dutyKey: String) {
    bmsOperationReadiness(
      locationId: $locationId
      staffId: $staffId
      dutyKey: $dutyKey
    )
  }
`;
export default function StandardReadiness({
  locationId,
  staffId,
  dutyKey,
}: {
  locationId?: string;
  staffId?: string;
  dutyKey?: string;
}) {
  const { t } = useI18n(),
    tr = (k: string) => t(`operation_improvement.${k}`);
  const q = useQuery(READINESS, {
    variables: { locationId, staffId, dutyKey },
    skip:
      !locationId ||
      !staffId ||
      !dutyKey ||
      !/^[a-zA-Z0-9][a-zA-Z0-9_-]*$/.test(dutyKey),
    fetchPolicy: "network-only",
  });
  if (!locationId || !staffId || !dutyKey) return null;
  if (q.error)
    return (
      <Alert closable type="warning" message={tr("readiness_unavailable")} />
    );
  const d = q.data?.bmsOperationReadiness;
  if (!d) return null;
  return (
    <Alert
      closable
      type={d.ready ? "success" : "warning"}
      message={tr(d.ready ? "ready" : "not_ready")}
      description={
        <>
          <p>{tr("readiness_hint")}</p>
          {!d.configured ? (
            <p>{tr("not_configured")}</p>
          ) : (
            d.standards.map((x: any) => (
              <div key={x.id}>
                <Space wrap>
                  {x.title} · v{x.version}
                  <Tag>
                    {tr(x.acknowledged ? "acknowledged" : "not_acknowledged")}
                  </Tag>
                  {x.training_required && (
                    <Tag>{tr(x.trained ? "trained" : "not_trained")}</Tag>
                  )}
                  <Tag>
                    {tr(
                      !x.training_required
                        ? "training_optional"
                        : x.assessment === "PASS"
                          ? "passed"
                          : x.assessment === "PRACTICE"
                            ? "practice"
                            : "not_assessed",
                    )}
                  </Tag>
                </Space>
              </div>
            ))
          )}
        </>
      }
    />
  );
}
