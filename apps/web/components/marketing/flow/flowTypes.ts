export type FeatureStatus = "ready" | "config" | "pilot" | "planned";

export type FlowGroup = "chat" | "orderIntake" | "pos" | "core" | "module" | "output" | "loop";

export type ShopScenario = "all" | "retail" | "restaurant" | "boardgame" | "pharmacy";

export type FlowIconName =
  | "bag"
  | "box"
  | "card"
  | "cart"
  | "chart"
  | "chat"
  | "chef"
  | "doc"
  | "gift"
  | "globe"
  | "hist"
  | "lock"
  | "loop"
  | "monitor"
  | "phone"
  | "pulse"
  | "qr"
  | "server"
  | "shield"
  | "spark"
  | "store"
  | "target"
  | "truck"
  | "ucheck"
  | "users";

export type FlowTextKey = `bmsFlow.${string}`;

export interface FlowNode {
  id: string;
  group: FlowGroup;
  icon: FlowIconName;
  labelKey: FlowTextKey;
  shortKey: FlowTextKey;
  detail: {
    whatKey: FlowTextKey;
    exampleKey?: FlowTextKey;
    noteKey?: FlowTextKey;
  };
  status: FeatureStatus;
  scenarios: ShopScenario[];
  compact: boolean;
  href?: string;
}

export interface FlowEdge {
  from: string;
  to: string;
  kind: "main" | "handoff" | "loop";
  labelKey?: FlowTextKey;
}

export interface FlowScenarioStep {
  nodeId: string;
  captionKey: FlowTextKey;
}

export interface FlowScenario {
  id: Exclude<ShopScenario, "all">;
  labelKey: FlowTextKey;
  steps: FlowScenarioStep[];
}

