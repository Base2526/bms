import {
  customerDeliveryResponseV1Schema,
  customerDeliveryStatusV1Schema,
  customerQuoteResponseV1Schema,
  deliveryServiceRequirementV1Schema,
  type CustomerDeliveryResponseV1,
  type CustomerDeliveryStatusV1,
  type CustomerQuoteResponseV1,
  type DeliveryServiceRequirementV1,
} from "@bms/fleet-delivery-contracts";
import { z } from "zod";

const customerActivationSchema = z.object({
  apiBaseUrl: z.string().url(),
  accessToken: z.string().regex(/^[A-Za-z0-9_-]{43}$/),
  expiresAt: z.iso.datetime({ offset: true }),
  syntheticOnly: z.literal(true),
}).strict().superRefine((value, context) => {
  const url = new URL(value.apiBaseUrl);
  const isLoopbackHttp = url.protocol === "http:" && url.hostname === "127.0.0.1";
  if (url.protocol !== "https:" && !isLoopbackHttp) {
    context.addIssue({ code: "custom", path: ["apiBaseUrl"], message: "HTTPS or loopback HTTP required" });
  }
  if (url.username || url.password || url.pathname !== "/" || url.search || url.hash) {
    context.addIssue({ code: "custom", path: ["apiBaseUrl"], message: "API origin required" });
  }
});

export type CustomerActivation = z.infer<typeof customerActivationSchema>;
export type CustomerFlowState =
  | { status: "READY" }
  | { status: "QUOTED"; quote: CustomerQuoteResponseV1 }
  | { status: "DELIVERY_CREATED"; delivery: CustomerDeliveryResponseV1 };

type FetchLike = typeof fetch;

let requestSequence = 0;

function idempotencyKey(prefix: string): string {
  requestSequence += 1;
  return `${prefix}:${Date.now()}:${requestSequence}`;
}

export class CustomerDeliveryClient {
  private readonly activation: CustomerActivation;
  private readonly fetchImplementation: FetchLike;

  constructor(
    activation: CustomerActivation,
    fetchImplementation: FetchLike = fetch,
    private readonly requestTimeoutMs = 15_000,
  ) {
    if (!Number.isFinite(requestTimeoutMs) || requestTimeoutMs <= 0 || requestTimeoutMs > 60_000) {
      throw new Error("INVALID_REQUEST_TIMEOUT");
    }
    this.activation = customerActivationSchema.parse(activation);
    // An activation is an origin; accepting a trailing slash must not produce //v1 paths.
    this.activation.apiBaseUrl = new URL(this.activation.apiBaseUrl).origin;
    this.fetchImplementation = fetchImplementation;
  }

  private async post(path: string, body: unknown, key: string): Promise<unknown> {
    return this.request(path, {
      method: "POST",
      headers: { "content-type": "application/json", "idempotency-key": key },
      body: JSON.stringify(body),
    });
  }

  private async request(path: string, init: RequestInit): Promise<unknown> {
    if (new Date(this.activation.expiresAt).getTime() <= Date.now()) throw new Error("CUSTOMER_SESSION_EXPIRED");
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.requestTimeoutMs);
    try {
      const response = await this.fetchImplementation(`${this.activation.apiBaseUrl}${path}`, {
        ...init,
        headers: { ...init.headers, authorization: `Bearer ${this.activation.accessToken}` },
        signal: controller.signal,
      });
      const responseBody = await response.json().catch(() => undefined) as unknown;
      if (controller.signal.aborted) throw new Error("CUSTOMER_REQUEST_TIMEOUT");
      if (!response.ok) {
        const code = responseBody && typeof responseBody === "object" && "error" in responseBody
          && responseBody.error && typeof responseBody.error === "object" && "code" in responseBody.error
          ? String(responseBody.error.code)
          : `HTTP_${response.status}`;
        throw new Error(code);
      }
      return responseBody;
    } catch (error) {
      if (controller.signal.aborted) throw new Error("CUSTOMER_REQUEST_TIMEOUT");
      throw error;
    } finally {
      clearTimeout(timeout);
    }
  }

  async quote(
    requirement: DeliveryServiceRequirementV1,
    key = idempotencyKey("customer-quote"),
  ): Promise<CustomerQuoteResponseV1> {
    const serviceRequirement = deliveryServiceRequirementV1Schema.parse(requirement);
    return customerQuoteResponseV1Schema.parse(await this.post(
      "/v1/customer/quotes",
      { serviceRequirement },
      key,
    ));
  }

  async createDelivery(
    quoteId: string,
    // Stable across a lost response, a repeated tap and a client/app restart. The server
    // scopes this key to the authenticated grant and binds the request fingerprint.
    key = `customer-delivery:${quoteId}`,
  ): Promise<CustomerDeliveryResponseV1> {
    return customerDeliveryResponseV1Schema.parse(await this.post(
      "/v1/customer/deliveries",
      { quoteId },
      key,
    ));
  }

  async getDeliveryStatus(): Promise<CustomerDeliveryStatusV1> {
    return customerDeliveryStatusV1Schema.parse(await this.request(
      "/v1/customer/deliveries/current", { method: "GET" },
    ));
  }
}

export class CustomerDeliveryFlow {
  state: CustomerFlowState = { status: "READY" };

  constructor(private readonly client: CustomerDeliveryClient) {}

  async requestQuote(requirement: DeliveryServiceRequirementV1): Promise<CustomerFlowState> {
    const quote = await this.client.quote(requirement);
    this.state = { status: "QUOTED", quote };
    return this.state;
  }

  async confirmDelivery(): Promise<CustomerFlowState> {
    if (this.state.status !== "QUOTED") throw new Error("QUOTE_REQUIRED");
    const delivery = await this.client.createDelivery(this.state.quote.quoteId);
    this.state = { status: "DELIVERY_CREATED", delivery };
    return this.state;
  }
}

export { customerActivationSchema };
