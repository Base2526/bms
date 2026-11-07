import { GraphQLError } from "graphql/error/index.js";
import type {
  DocumentNode,
  FragmentDefinitionNode,
  OperationDefinitionNode,
  SelectionSetNode,
} from "graphql/language/ast.js";
import type { ASTVisitor } from "graphql/language/visitor.js";
import type { ASTValidationContext } from "graphql/validation/ValidationContext.js";

export const GRAPHQL_MAX_DEPTH = 30;
export const GRAPHQL_MAX_FIELDS = 2_500;
export const GRAPHQL_MAX_ALIASES = 200;

type Cost = { depth: number; fields: number; aliases: number };

function measureSelectionSet(
  selectionSet: SelectionSetNode,
  fragments: Map<string, FragmentDefinitionNode>,
  activeFragments: Set<string>,
  depth: number,
  cost: Cost
): void {
  cost.depth = Math.max(cost.depth, depth);
  if (cost.fields > GRAPHQL_MAX_FIELDS || cost.aliases > GRAPHQL_MAX_ALIASES) return;

  for (const selection of selectionSet.selections) {
    if (selection.kind === "Field") {
      cost.fields += 1;
      if (selection.alias) cost.aliases += 1;
      if (selection.selectionSet) {
        measureSelectionSet(selection.selectionSet, fragments, activeFragments, depth + 1, cost);
      }
      continue;
    }

    if (selection.kind === "InlineFragment") {
      measureSelectionSet(selection.selectionSet, fragments, activeFragments, depth, cost);
      continue;
    }

    const name = selection.name.value;
    const fragment = fragments.get(name);
    if (!fragment || activeFragments.has(name)) continue;
    activeFragments.add(name);
    measureSelectionSet(fragment.selectionSet, fragments, activeFragments, depth, cost);
    activeFragments.delete(name);
  }
}

function operationCost(
  operation: OperationDefinitionNode,
  fragments: Map<string, FragmentDefinitionNode>
): Cost {
  const cost: Cost = { depth: 0, fields: 0, aliases: 0 };
  measureSelectionSet(operation.selectionSet, fragments, new Set(), 1, cost);
  return cost;
}

/**
 * Bound expanded operation cost, including fragments each time they are used.
 * Limits are deliberately generous for existing admin screens; their purpose
 * is to reject pathological depth/alias/fan-out before a resolver or DB query.
 */
export function graphqlRequestLimitsRule(context: ASTValidationContext): ASTVisitor {
  return {
    Document: {
      leave(node: DocumentNode) {
        const fragments = new Map<string, FragmentDefinitionNode>();
        for (const definition of node.definitions) {
          if (definition.kind === "FragmentDefinition") {
            fragments.set(definition.name.value, definition);
          }
        }

        for (const definition of node.definitions) {
          if (definition.kind !== "OperationDefinition") continue;
          const cost = operationCost(definition, fragments);
          const operationName = definition.name?.value || "anonymous";
          if (cost.depth > GRAPHQL_MAX_DEPTH) {
            context.reportError(
              new GraphQLError(
                `Operation ${operationName} exceeds maximum depth ${GRAPHQL_MAX_DEPTH}`,
                { nodes: definition }
              )
            );
          }
          if (cost.fields > GRAPHQL_MAX_FIELDS) {
            context.reportError(
              new GraphQLError(
                `Operation ${operationName} exceeds maximum field count ${GRAPHQL_MAX_FIELDS}`,
                { nodes: definition }
              )
            );
          }
          if (cost.aliases > GRAPHQL_MAX_ALIASES) {
            context.reportError(
              new GraphQLError(
                `Operation ${operationName} exceeds maximum alias count ${GRAPHQL_MAX_ALIASES}`,
                { nodes: definition }
              )
            );
          }
        }
      },
    },
  };
}
