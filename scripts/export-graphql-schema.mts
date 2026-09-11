import { writeFile } from "node:fs/promises";

import { renderBmsGraphqlSdl } from "../apps/web/graphql/schema";

const artifact = new URL("../schema.graphql", import.meta.url);

await writeFile(artifact, renderBmsGraphqlSdl(), "utf8");
console.log("wrote schema.graphql from buildBmsGraphqlSchema()");
