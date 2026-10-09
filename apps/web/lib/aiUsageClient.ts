import { ApolloLink, Observable, type ApolloClient, type NormalizedCacheObject } from "@apollo/client/core/index.js";
import { Kind } from "graphql/language/kinds";
import { getOperationAST } from "graphql/utilities/getOperationAST";
import type { DocumentNode, SelectionSetNode } from "graphql/language/ast";

const USAGE_FIELDS = new Set(["bmsAiUsage", "bmsAiCreditLedger", "bmsAiUsageBreakdown", "bmsAiUsageEvents"]);

export function rootFields(document: DocumentNode, operationName?: string): string[] {
  const operation = getOperationAST(document, operationName);
  if (!operation) return [];
  const visited = new Set<string>();
  const walk = (set: SelectionSetNode): string[] => set.selections.flatMap(selection => {
    if (selection.kind === Kind.FIELD) return [selection.name.value];
    if (selection.kind === Kind.INLINE_FRAGMENT) return walk(selection.selectionSet);
    if (visited.has(selection.name.value)) return [];
    visited.add(selection.name.value);
    const fragment = document.definitions.find(d => d.kind === Kind.FRAGMENT_DEFINITION && d.name.value === selection.name.value);
    return fragment?.kind === Kind.FRAGMENT_DEFINITION ? walk(fragment.selectionSet) : [];
  });
  return walk(operation.selectionSet);
}

/** Read server balances; never subtract a guessed credit in the browser. */
export function refreshAiUsage(client: ApolloClient<NormalizedCacheObject>): Promise<unknown[]> {
  const queries = [...client.getObservableQueries("active").values()]
    .filter(query => rootFields(query.options.query).some(field => USAGE_FIELDS.has(field)));
  return Promise.all(queries.map(query => query.refetch().catch(() => undefined)));
}

/** All admin BMS mutations may invoke approved AI indirectly (e.g. a report).
 * Customer insights is a query that can generate a summary on cache miss.
 * Refresh on errors too: a failed reply may still have spent provider money.
 */
export function aiUsageRefreshLink(refresh: () => void): ApolloLink {
  return new ApolloLink((operation, forward) => {
    const definition = getOperationAST(operation.query, operation.operationName);
    const fields = rootFields(operation.query, operation.operationName);
    const affectsUsage = definition?.operation === "mutation"
      ? fields.some(field => field.startsWith("bms"))
      : fields.includes("bmsCustomerInsights") && !fields.some(field => USAGE_FIELDS.has(field));
    if (!affectsUsage) return forward(operation);
    return new Observable(observer => {
      let refreshed = false;
      const done = () => {
        if (refreshed) return;
        refreshed = true;
        // Run after Apollo has delivered the operation result to its caller.
        queueMicrotask(refresh);
      };
      const subscription = forward(operation).subscribe({
        next: value => observer.next(value),
        error: error => { done(); observer.error(error); },
        complete: () => { done(); observer.complete(); },
      });
      return () => subscription.unsubscribe();
    });
  });
}

export function aiCreditCapacity(usage: { grantedCredits: number; bonusCredits: number; adjustedCredits: number; unlimited: boolean } | undefined): number {
  return !usage || usage.unlimited ? 0 : Math.max(0, usage.grantedCredits + usage.bonusCredits + usage.adjustedCredits);
}
