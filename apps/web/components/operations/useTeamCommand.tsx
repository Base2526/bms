"use client";
import { gql, useMutation, type DocumentNode } from "@apollo/client";
import { useRef, useState } from "react";
import { Button, Modal, message } from "antd";
import { useI18n } from "@/lib/i18nContext";
export const TEAM_COMMAND = gql`
  mutation OperationTeamCommand($input: BmsTeamCommandInput!) {
    bmsOperationTeamCommand(input: $input) {
      status
      id
      version
    }
  }
`;
export function useTeamCommand(
  refresh: () => Promise<unknown>,
  onCommitted?: () => void,
  config?: { document: DocumentNode; field: string },
) {
  const { t } = useI18n(),
    tr = (k: string) => t(`operation_team.${k}`),
    [mutate] = useMutation(config?.document ?? TEAM_COMMAND),
    pending = useRef<any>(null),
    [busy, setBusy] = useState(false),
    [uncertain, setUncertain] = useState(false);
  async function command(input?: any) {
    if (busy || (input && pending.current) || (!input && !pending.current))
      return false;
    if (input)
      pending.current = { ...input, idempotencyKey: crypto.randomUUID() };
    setBusy(true);
    try {
      const response = await mutate({ variables: { input: pending.current } }),
        result = response.data?.[config?.field ?? "bmsOperationTeamCommand"];
      if (!result) throw new Error("Missing outcome");
      pending.current = null;
      setUncertain(false);
      if (result.status !== "OK") {
        message.error(
          `${tr(uncertain ? "retry_denied_hint" : "failed")} (${result.status})`,
        );
        await refresh().catch(() => {});
        return false;
      }
      message.success(tr("success"));
      onCommitted?.();
      await refresh().catch(() => message.warning(tr("failed")));
      return true;
    } catch (error: any) {
      const rejected =
        !error.networkError &&
        error.graphQLErrors?.length &&
        error.graphQLErrors.every((e: any) =>
          [
            "FORBIDDEN",
            "UNAUTHENTICATED",
            "GRAPHQL_VALIDATION_FAILED",
            "BAD_USER_INPUT",
          ].includes(e.extensions?.code),
        );
      if (rejected) {
        pending.current = null;
        setUncertain(false);
        message.error(tr(uncertain ? "retry_denied_hint" : "failed"));
        await refresh().catch(() => {});
      } else setUncertain(true);
      return false;
    } finally {
      setBusy(false);
    }
  }
  return {
    command,
    busy,
    uncertain,
    retry: (
      <Modal
        open={uncertain}
        title={tr("uncertain")}
        closable={false}
        maskClosable={false}
        keyboard={false}
        zIndex={4000}
        footer={
          <Button loading={busy} onClick={() => command()}>
            {tr("retry")}
          </Button>
        }
      >
        <p>{tr("retry_hint")}</p>
      </Modal>
    ),
  };
}
