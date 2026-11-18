import assert from "node:assert/strict";
import test from "node:test";
import { createRequire } from "node:module";
import { Readable } from "node:stream";
import { readFileSync } from "node:fs";
import path from "node:path";
import {
  readWorkAssistantImage,
  requireBmsScreenshotConfirmation,
  WorkAssistantImageError,
  WORK_ASSISTANT_IMAGE_MAX_BYTES,
} from "../../apps/web/lib/bms/workAssistantImage.ts";
import { supportsAiImageInput } from "../../apps/web/lib/bms/aiProvider.ts";
import { __toolLoopTest, type ToolLoopOptions } from "../../apps/web/lib/bms/tools/runtime.ts";

const require = createRequire(new URL("../../apps/web/package.json", import.meta.url));
const sharp = require("sharp") as typeof import("../../apps/web/node_modules/sharp");
const { ApolloServer } = require("@apollo/server") as typeof import("../../apps/web/node_modules/@apollo/server");
const { makeExecutableSchema } = require("@graphql-tools/schema") as typeof import("../../apps/web/node_modules/@graphql-tools/schema");
const { GraphQLUpload, uploadProcess } = require("graphql-upload-nextjs") as typeof import("../../apps/web/node_modules/graphql-upload-nextjs");
const ROOT = path.resolve(import.meta.dirname, "../..");
const read = (relative: string) => readFileSync(path.join(ROOT, relative), "utf8");

function upload(bytes: Buffer, mimeType = "image/png") {
  // graphql-upload-nextjs resolves Upload with camel-cased `mimeType`.
  return { mimeType, createReadStream: () => Readable.from([bytes]) };
}

test("an image without an explicit BMS source declaration stops before AI usage", () => {
  for (const value of [undefined, null, false, "true", 1]) {
    assert.throws(() => requireBmsScreenshotConfirmation(value),
      (error: unknown) => error instanceof WorkAssistantImageError && error.code === "unconfirmed");
  }
  assert.doesNotThrow(() => requireBmsScreenshotConfirmation(true));
});

test("staff screenshot accepts the PNG shape returned by GraphQL Upload", async () => {
  const png = await sharp({ create: { width: 16, height: 16, channels: 3, background: "#fff" } }).png().toBuffer();
  const result = await readWorkAssistantImage(upload(png));
  assert.equal(result.mediaType, "image/png");
  assert.equal((await sharp(Buffer.from(result.data, "base64")).metadata()).format, "png");
});

test("real multipart GraphQL Upload passes a PNG into the assistant decoder", async () => {
  const png = await sharp({ create: { width: 24, height: 16, channels: 3, background: "#fff" } }).png().toBuffer();
  const form = new FormData();
  form.set("operations", JSON.stringify({
    query: "mutation($image: Upload!) { checkImage(image: $image) }",
    variables: { image: null },
  }));
  form.set("map", JSON.stringify({ "0": ["variables.image"] }));
  form.set("0", new File([png], "screenshot.png", { type: "image/png" }));
  const schema = makeExecutableSchema({
    typeDefs: "scalar Upload\ntype Query { health: String }\ntype Mutation { checkImage(image: Upload!): String! }",
    resolvers: {
      Upload: GraphQLUpload,
      Mutation: {
        checkImage: async (_: unknown, { image }: { image: Promise<import("../../apps/web/lib/bms/workAssistantImage.ts").WorkAssistantUpload> }) =>
          (await readWorkAssistantImage(image)).mediaType,
      },
    },
  });
  const server = new ApolloServer({ schema, csrfPrevention: false });
  try {
    const response = await uploadProcess({ formData: async () => form, headers: { get: () => null } }, {}, server, {
      allowedTypes: ["image/png", "image/jpeg", "image/webp"],
      maxFileSize: WORK_ASSISTANT_IMAGE_MAX_BYTES,
    });
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { data: { checkImage: "image/png" } });
  } finally {
    await server.stop();
  }
});

test("staff screenshot upload is decoded, resized and re-encoded before provider use", async () => {
  const original = await sharp({ create: {
    width: 3000, height: 900, channels: 3, background: "#eef5ff",
  } }).jpeg().toBuffer();
  const result = await readWorkAssistantImage(upload(original, "image/jpeg"));
  assert.equal(result.mediaType, "image/png");
  const normalized = Buffer.from(result.data, "base64");
  const metadata = await sharp(normalized).metadata();
  assert.equal(metadata.format, "png");
  assert.equal(metadata.width, 2560);
  assert.ok((metadata.height ?? 0) > 0 && (metadata.height ?? 0) < 900);
  assert.ok(normalized.length <= 6 * 1024 * 1024);
});

test("staff screenshot upload rejects false MIME, corrupt, empty and oversized files", async () => {
  const png = await sharp({ create: { width: 16, height: 16, channels: 3, background: "#fff" } }).png().toBuffer();
  await assert.rejects(() => readWorkAssistantImage(upload(png, "image/jpeg")), WorkAssistantImageError);
  await assert.rejects(() => readWorkAssistantImage(upload(Buffer.from("not an image"))), WorkAssistantImageError);
  await assert.rejects(() => readWorkAssistantImage(upload(Buffer.alloc(0))), WorkAssistantImageError);
  await assert.rejects(() => readWorkAssistantImage(upload(Buffer.alloc(WORK_ASSISTANT_IMAGE_MAX_BYTES + 1))),
    (error: unknown) => error instanceof WorkAssistantImageError && /10 MB/.test(error.message));
});

test("vision routing accepts Flash aliases and Claude, and rejects DeepSeek Pro", () => {
  for (const model of ["deepseek-flash", "deepseek-v4-flash", "deepseek-v4-flash-vision-exp"]) {
    assert.equal(supportsAiImageInput("deepseek", model), true);
  }
  assert.equal(supportsAiImageInput("anthropic", "claude-haiku-4-5-20251001"), true);
  assert.equal(supportsAiImageInput("anthropic", "claude-sonnet-4-6"), true);
  assert.equal(supportsAiImageInput("deepseek", "deepseek-v4-pro"), false);
  assert.equal(supportsAiImageInput("deepseek", "unknown-model"), false);
});

test("staff tool loop forwards image blocks to the selected provider without changing tool authority", async () => {
  const imageBlock = { type: "image", source: { type: "base64", media_type: "image/png", data: "FAKE-image-data" } };
  const options: ToolLoopOptions = {
    tenantId: "FAKE-tenant",
    requiresVision: true,
    system: "test-only",
    messages: [{ role: "user", content: [{ type: "text", text: "What is this error?" }, imageBlock] }],
    tools: [],
    execCtx: { tenantId: "FAKE-tenant", surface: "staff", actor: "FAKE-admin", locale: "en" },
  };
  let calls = 0;
  const result = await __toolLoopTest.run(options, {
    resolveCredentials: async (_tenant, usage) => {
      assert.equal(usage?.requiresVision, true);
      return { apiKey: "FAKE-never-sent", model: "deepseek-flash", provider: "deepseek",
        baseUrl: "https://example.invalid", source: "byok", usageEventId: "FAKE-event" };
    },
    callProvider: async (_creds, _system, messages) => {
      calls++;
      assert.deepEqual(messages.at(-1)?.content, options.messages[0].content);
      return { stop_reason: "end_turn", content: [{ type: "text", text: "I can see an error banner." }],
        usage: { input_tokens: 20, output_tokens: 8 } };
    },
    recordProviderAttempt: async () => undefined,
    finalizeUsage: async () => undefined,
    auditAttempt: async () => undefined,
    reportFailure: async () => undefined,
  });
  assert.equal(calls, 1);
  assert.equal(result.reply, "I can see an error banner.");
  assert.deepEqual(result.trace, []);
  assert.deepEqual(result.proposals, []);
});

test("both staff surfaces send a transient Upload, while the resolver does not bypass vision", () => {
  const schema = read("apps/web/graphql/typeDefs.ts");
  const artifact = read("schema.graphql");
  const resolver = read("apps/web/graphql/bmsAssistant.ts");
  const drawer = read("apps/web/components/work-assistant/WorkAssistantDrawer.tsx");
  const page = read("apps/web/app/(admin)/admin/assistant/page.tsx");
  assert.match(schema, /input BmsWorkAssistantInput\s*\{[^}]*image: Upload/);
  assert.match(schema, /input BmsWorkAssistantInput\s*\{[^}]*imageBmsConfirmed: Boolean/);
  assert.match(artifact, /input BmsWorkAssistantInput\s*\{[^}]*image: Upload/);
  assert.match(artifact, /input BmsWorkAssistantInput\s*\{[^}]*imageBmsConfirmed: Boolean/);
  assert.ok(resolver.indexOf("requireBmsScreenshotConfirmation(input.imageBmsConfirmed)") < resolver.indexOf("readWorkAssistantImage(input.image)"));
  assert.match(resolver, /readWorkAssistantImage\(input\.image\)/);
  assert.match(resolver, /requiresVision: Boolean\(image\)/);
  assert.match(resolver, /type: "image", source: \{ type: "base64"/);
  assert.match(resolver, /if \(!image && currentPath && isCurrentPageHelpRequest/);
  assert.match(resolver, /if \(image\) return \{/);
  for (const surface of [drawer, page]) {
    assert.match(surface, /image: attached\?\.file/);
    assert.match(surface, /imageBmsConfirmed: attached\?\.confirmedBms/);
    assert.match(surface, /AssistantImageAttachmentControls/);
    assert.match(surface, /onConfirmBms=\{image\.confirmBms\}/);
    assert.match(surface, /onPaste=\{image\.pasteImage\}/);
    assert.match(surface, /AssistantSentImage/);
  }
  assert.match(drawer, /return messages\.map\(\(\{ role, text, imageName,/);
  assert.match(page, /JSON\.stringify\(chat\.map\(\(\{ imagePreviewUrl, imageFile, \.\.\.bubble \}\)/);
});
