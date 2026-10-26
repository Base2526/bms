"use client";
import { gql, useQuery } from "@apollo/client";
import { Alert } from "antd";
import { useI18n } from "@/lib/i18nContext";
const CONTEXT = gql`
  query ImprovementForRun($id: ID!) {
    bmsImprovementForRun(id: $id)
  }
`;
export default function ImprovementRunContext({ runId }: { runId: string }) {
  const { t } = useI18n(),
    q = useQuery(CONTEXT, {
      variables: { id: runId },
      fetchPolicy: "network-only",
    }),
    d = q.data?.bmsImprovementForRun;
  if (q.error)
    return (
      <Alert
        closable
        type="warning"
        message={t("operation_improvement.load_error")}
      />
    );
  return d ? (
    <Alert
      closable
      type="info"
      message={d.title}
      description={
        <>
          <strong>{t("operation_improvement.target")}</strong>
          <p style={{ whiteSpace: "pre-wrap" }}>{d.target}</p>
        </>
      }
    />
  ) : null;
}
