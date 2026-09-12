import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { bmsMobileOperationsResolvers } from "../apps/web/graphql/bmsMobileOperations";
import { bmsPosDeviceResolvers } from "../apps/web/graphql/bmsPosDevice";
import {
  buildBmsGraphqlSchema,
  validateBmsGraphqlDocument,
} from "../apps/web/graphql/schema";

const doc = readFileSync(
  new URL("../docs/architecture/react-native-graphql-client.md", import.meta.url),
  "utf8",
);

const coreExampleOperations = [
  "bmsPosSession",
  "bmsPosScan",
  "bmsPosCatalogSearch",
  "bmsPosRestaurantMenu",
  "bmsPosRestaurantFloor",
  "bmsPosRestaurantCheck",
  "bmsPosKitchenTickets",
  "bmsPosSale",
  "bmsPosRestaurantOpenCheck",
  "bmsPosShift",
].sort();

function graphqlBlocks(): string[] {
  return [...doc.matchAll(/```graphql\r?\n([\s\S]*?)```/g)].map((match) => match[1]);
}

function operationsInCoverageRow(label: string): string[] {
  const line = doc.split(/\r?\n/).find((candidate) => candidate.startsWith(`| ${label} |`));
  assert.ok(line, `coverage table must have a ${label} row`);
  return [...line.matchAll(/`(bms[A-Za-z0-9]+)`/g)].map((match) => match[1]).sort();
}

function mobileOutputOperations(outputTypeName: string): string[] {
  const schema = buildBmsGraphqlSchema();
  const names = new Set<string>();
  const resolverSets = [bmsPosDeviceResolvers, bmsMobileOperationsResolvers];
  for (const resolvers of resolverSets) {
    for (const kind of ["Query", "Mutation"] as const) {
      const root = kind === "Query" ? schema.getQueryType() : schema.getMutationType();
      assert.ok(root, `${kind} root must exist`);
      for (const name of Object.keys(resolvers[kind])) {
        const field = root.getFields()[name];
        assert.ok(field, `${kind}.${name} must exist`);
        if (String(field.type).replace(/[\[\]!]/g, "") === outputTypeName) names.add(name);
      }
    }
  }
  return [...names].sort();
}

test("every documented GraphQL example validates against the executable schema", () => {
  const blocks = graphqlBlocks();
  assert.ok(blocks.length >= 9, "expected subscription plus typed screen examples");
  for (const [index, block] of blocks.entries()) {
    assert.deepEqual(
      validateBmsGraphqlDocument(block),
      [],
      `GraphQL example block ${index + 1} must validate`,
    );
  }
});

test("the client guide includes a real field selection for every core RN screen flow", () => {
  const examples = graphqlBlocks().join("\n");
  for (const operation of coreExampleOperations) {
    assert.match(
      examples,
      new RegExp(`\\b${operation}\\s*(?:\\(|\\{)`),
      `${operation} needs an executable client example`,
    );
  }
});

test("the typed/JSON coverage table matches the executable mobile schema exactly", () => {
  const resolverCount = [bmsPosDeviceResolvers, bmsMobileOperationsResolvers]
    .flatMap((resolvers) => [Object.keys(resolvers.Query), Object.keys(resolvers.Mutation)])
    .flat().length;
  assert.equal(resolverCount, 100, "the documented typed count must cover the complete mobile/POS surface");
  assert.deepEqual(mobileOutputOperations("JSON"), [], "the executable schema must have no opaque output roots");
  assert.deepEqual(operationsInCoverageRow("Typed (100)"), []);
  assert.deepEqual(operationsInCoverageRow("JSON compatibility (0)"), []);
});
