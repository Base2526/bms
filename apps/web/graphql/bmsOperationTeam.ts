import { scope, read } from "./bmsOperationChecklists";
import { commandOperationTeam } from "@/lib/bms/operationTeam";
import {
  operationTeamWorkspace,
  operationTeamRoster,
  operationTeamDetail,
  operationTeamInbox,
  operationTeamSummary,
} from "@/lib/bms/operationTeamReads";
export const bmsOperationTeamTypeDefs = /* GraphQL */ `
  enum BmsTeamAction {
    SAVE_ROSTER
    PUBLISH_ROSTER
    CANCEL_ROSTER
    ACCEPT_DUTY
    END_DUTY
    CREATE_HANDOVER
    REFRESH_HANDOVER
    SUBMIT_HANDOVER
    RECEIVE_HANDOVER
    REROUTE_HANDOVER
    CANCEL_HANDOVER
    APPEND_NOTE
    TRANSFER_ITEM
    CONFIRM_DAY
    READ_NOTICE
    SAVE_SUPERVISOR_DUTY
  }
  enum BmsTeamNoticeSource {
    TEAM
    CHECKLIST
  }
  enum BmsTeamItemKind {
    RUN
    ACTION
  }
  input BmsTeamCommandInput {
    action: BmsTeamAction!
    idempotencyKey: String!
    confirmed: Boolean
    id: ID
    version: Int
    locationId: ID
    dutyKey: String
    dutyName: String
    assignedTo: ID
    startsAt: String
    endsAt: String
    rosterId: ID
    recipient: ID
    dueAt: String
    note: String
    itemId: ID
    itemKind: BmsTeamItemKind
    itemVersion: Int
    date: String
    fingerprint: String
    source: BmsTeamNoticeSource
    enabled: Boolean
  }
  input BmsTeamFilter {
    locationId: ID
    from: String!
    to: String!
    offset: Int
  }
  type BmsTeamRoster {
    id: ID!
    locationId: ID!
    dutyKey: String!
    dutyName: String!
    assignedTo: ID
    startsAt: String!
    endsAt: String!
    status: String!
    version: Int!
    acceptedAt: String
    endedAt: String
  }
  type BmsTeamEvent {
    id: ID!
    action: String!
    actor: String!
    note: String!
    details: JSON!
    createdAt: String!
  }
  type BmsTeamHandover {
    id: ID!
    locationId: ID!
    rosterId: ID!
    sender: ID!
    recipient: ID
    note: String!
    dueAt: String!
    status: String!
    version: Int!
    items: JSON!
    liveItems: JSON
    events: [BmsTeamEvent!]
    dutyName: String
    submittedAt: String
    receivedAt: String
  }
  type BmsTeamPolicy {
    locationId: ID!
    version: Int!
    useDutySupervisor: Boolean!
    supervisorDutyKey: String
  }
  type BmsTeamWorkspace {
    staff: [BmsChecklistOption!]!
    rosters: [BmsTeamRoster!]!
    rosterTotal: Int!
    handovers: [BmsTeamHandover!]!
    handoverTotal: Int!
    missing: [BmsChecklistRun!]!
    missingTotal: Int!
    policies: [BmsTeamPolicy!]!
    actorId: ID!
  }
  type BmsTeamNotice {
    id: ID!
    entityId: ID!
    entityKind: String!
    kind: String!
    source: BmsTeamNoticeSource!
    createdAt: String!
    readAt: String
  }
  type BmsTeamInbox {
    items: [BmsTeamNotice!]!
    total: Int!
    unread: Int!
  }
  type BmsTeamDayCounts {
    duties: Int!
    vacancies: Int!
    unaccepted: Int!
    runs: Int!
    approved: Int!
    overdue: Int!
    unassigned: Int!
    review: Int!
    actions: Int!
    handoverDraft: Int!
    handoverWaiting: Int!
    handoverReceived: Int!
    escalations: Int!
  }
  type BmsTeamDailyReview {
    id: ID!
    version: Int!
    fingerprint: String!
    snapshot: JSON!
    note: String!
    reviewedBy: ID!
    createdAt: String!
  }
  type BmsTeamSummary {
    date: String!
    locationId: ID!
    timezone: String!
    asOf: String!
    counts: BmsTeamDayCounts!
    fingerprint: String!
    previous: BmsTeamDailyReview
    changed: Boolean!
  }
  extend type Query {
    bmsOperationRoster(id: ID!): BmsTeamRoster
    bmsOperationTeam(filter: BmsTeamFilter!): BmsTeamWorkspace!
    bmsOperationHandover(id: ID!): BmsTeamHandover
    bmsOperationInbox(offset: Int): BmsTeamInbox!
    bmsOperationSummary(locationId: ID!, date: String!): BmsTeamSummary!
  }
  extend type Mutation {
    bmsOperationTeamCommand(
      input: BmsTeamCommandInput!
    ): BmsChecklistCommandResult!
  }
`;
export const bmsOperationTeamResolvers = {
  Query: {
    bmsOperationRoster: (_: unknown, a: any, c: any) =>
      read(async () => operationTeamRoster(await scope(c), a.id)),
    bmsOperationTeam: (_: unknown, a: any, c: any) =>
      read(async () => operationTeamWorkspace(await scope(c), a.filter)),
    bmsOperationHandover: (_: unknown, a: any, c: any) =>
      read(async () => operationTeamDetail(await scope(c), a.id)),
    bmsOperationInbox: (_: unknown, a: any, c: any) =>
      read(async () => operationTeamInbox(await scope(c), a.offset ?? 0)),
    bmsOperationSummary: (_: unknown, a: any, c: any) =>
      read(async () =>
        operationTeamSummary(await scope(c), a.locationId, a.date),
      ),
  },
  Mutation: {
    bmsOperationTeamCommand: async (_: unknown, a: any, c: any) =>
      commandOperationTeam(await scope(c), a.input),
  },
};
