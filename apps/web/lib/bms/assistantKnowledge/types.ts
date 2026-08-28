import type { BmsPermission } from "../permissions";

export type AssistantLocale = "th" | "en";

export type LocalizedText = Readonly<Record<AssistantLocale, string>>;

export type CapabilityStatus =
  | "AVAILABLE"
  | "CONDITIONAL"
  | "BETA"
  | "MOCK"
  | "UNAVAILABLE";

export type AssistantKnowledgeKind = "capability" | "guide" | "troubleshooting";
export type AssistantAccessRequirement = "any_staff" | "tenant_administrator" | "platform_administrator";

export type SystemCapability = Readonly<{
  id: string;
  module: string;
  title: LocalizedText;
  description: LocalizedText;
  aliases: Readonly<Record<AssistantLocale, readonly string[]>>;
  status: CapabilityStatus;
  route: string | null;
  requiredPermissions: readonly BmsPermission[];
  anyOfPermissions?: readonly BmsPermission[];
  accessRequirement?: AssistantAccessRequirement;
  configurationDependencies: readonly string[];
  limitations: LocalizedText;
  formats?: readonly string[];
}>;

export type SystemGuide = Readonly<{
  id: string;
  module: string;
  pageId: string;
  /** Linkable destination. Must be a real page — the assistant hands this to the user as a link. */
  route: string;
  /**
   * Extra route prefixes this guide documents but must never link to, for subtrees whose parent
   * has no index page (e.g. `/admin/post/[id]` exists, `/admin/post` 404s).
   */
  coversRoutePrefixes?: readonly string[];
  title: LocalizedText;
  summary: LocalizedText;
  aliases: Readonly<Record<AssistantLocale, readonly string[]>>;
  requiredPermissions: readonly BmsPermission[];
  anyOfPermissions?: readonly BmsPermission[];
  accessRequirement?: AssistantAccessRequirement;
  prerequisites: Readonly<Record<AssistantLocale, readonly string[]>>;
  steps: Readonly<Record<AssistantLocale, readonly string[]>>;
  warnings: Readonly<Record<AssistantLocale, readonly string[]>>;
  relatedCapabilityIds: readonly string[];
}>;

export type AssistantKnowledgeContext = Readonly<{
  locale: AssistantLocale;
  currentPath?: string | null;
  pageId?: string | null;
  permissions?: ReadonlySet<string>;
  role?: string | null;
  isPlatformAdmin?: boolean;
  kind?: "all" | "capability" | "guide";
  limit?: number;
}>;

export type AssistantKnowledgeResult = Readonly<{
  kind: AssistantKnowledgeKind;
  id: string;
  title: string;
  summary: string;
  route: string | null;
  score: number;
  requiredPermissions: readonly BmsPermission[];
  missingPermissions: readonly BmsPermission[];
  accessible: boolean;
  accessRequirement: AssistantAccessRequirement;
  accessNote: string | null;
  /**
   * true = the query itself matched this entry's title/aliases/body.
   * false = it only surfaced because the actor is standing on its page.
   *
   * Proximity re-ranks, it must never invent a match: the current-page bonus alone is larger
   * than any relevance floor, so without this flag every guide on the current page scores as
   * an answer to any question — and the "no verified guide matched" branch becomes unreachable.
   */
  matchedQuery: boolean;
  capabilityStatus?: CapabilityStatus;
}>;
