## Project Overview

Jachoei is a community-driven caller ID, scam detection, and phone intelligence platform.

The system allows users to:

* Search phone numbers
* Search bank accounts
* Report scam numbers
* Report scam bank accounts
* View related posts and reports
* Block numbers locally
* Detect incoming scam calls
* Manage caller identification
* View risk scores and report counts
* Participate in a community-driven anti-scam network

The project consists of:

### Mobile App

Location:

```text
app-jachoei/MyApp
```

Stack:

* React Native
* TypeScript
* Apollo Client
* React Navigation
* Android-first
* iOS supported

### Backend

Location:

```text
next-apollo-pg-ws
```

Stack:

* Next.js
* Apollo Server
* GraphQL
* PostgreSQL
* WebSocket subscriptions
* Redis (optional)

---

# Architecture

## Mobile

Responsibilities:

* Caller ID UI
* Scam detection UI
* Search phone numbers
* Search bank accounts
* Community reporting
* Authentication
* Notification handling

The mobile app should remain thin.

Business logic belongs in GraphQL services whenever possible.

---

## Backend

Responsibilities:

* GraphQL API
* Authentication
* Reporting system
* Risk calculation
* Search indexing
* Aggregation
* Moderation
* Analytics

Backend is the source of truth.

---

# Core Domain Objects

## Phone Number

Fields:

```typescript
{
  id: string;
  phone: string;
  normalizedPhone: string;
  reportCount: number;
  riskScore: number;
  postCount: number;
}
```

Rules:

* Store normalized version
* Support:

  * 08xxxxxxxx
  * 668xxxxxxxx
  * +668xxxxxxxx
* Search must work across formats

---

## Bank Account

Fields:

```typescript
{
  id: string;
  bankCode: string;
  accountNumber: string;
  reportCount: number;
  riskScore: number;
}
```

---

## Report

Fields:

```typescript
{
  id: string;
  category:
    | "SCAM_CALL"
    | "SCAM_SMS"
    | "SCAM_ACCOUNT"
    | "MULE_ACCOUNT";
}
```

---

## Post

A post may contain:

* Phone numbers
* Bank accounts
* Images
* Evidence
* User reports

Posts are the primary content entity.

Phone numbers and bank accounts should aggregate related posts.

---

# Search Rules

## Phone Search

Searching:

```text
0812345678
66812345678
+66812345678
```

must return the same entity.

Always normalize before querying.

---

## Bank Search

Search by:

* Account Number
* Bank
* Account + Bank

---

# Risk Score

Risk score is community-driven.

Factors:

* Report count
* Unique reporters
* Report recency
* Moderator actions
* Related post count

Never hardcode risk values in frontend.

Frontend displays values from GraphQL.

---

# UI Rules

## Mobile

Design goals:

* Fast
* Clean
* Dark theme first
* Android optimized
* Large touch targets

Avoid:

* Complex nested navigation
* Heavy business logic in screens
* Duplicate API calls

---

## Header

Must remain responsive.

Support:

* Small Android devices
* Tablets
* Landscape mode

Title must truncate before icons.

Icons must never overflow.

---

## Floating Action Button

Use one centralized FAB component.

Do not create per-screen positioning.

All screens should share:

* Same size
* Same right offset
* Same bottom offset
* Same safe area logic

---

# GraphQL Guidelines

## Queries

Prefer:

```graphql
query GetPhone($phone: String!) {
  phone(phone: $phone) {
    id
    phone
    riskScore
  }
}
```

Avoid overfetching.

---

## Health Check

Required query:

```graphql
query Health {
  health
}
```

Response:

```json
{
  "data": {
    "health": "ok"
  }
}
```

Used by mobile app startup checks.

---

# Android Caller ID

Future roadmap includes:

* Call screening
* Scam detection
* Local spam marking
* Contact integration

Never automatically modify user contacts.

Always require user consent.

---

# Database Rules

PostgreSQL is the source of truth.

Avoid:

* Business logic in SQL triggers
* Duplicated calculations

Prefer:

* Service layer
* GraphQL resolvers
* Shared utility functions

---

# Code Style

TypeScript:

* strict mode
* avoid any
* prefer explicit interfaces

React:

* functional components only
* hooks only
* no class components

GraphQL:

* schema-first
* typed resolvers

---

# When Modifying Code

Always:

1. Inspect existing implementation first
2. Reuse current architecture
3. Preserve backward compatibility
4. Minimize risk
5. Modify real code directly
6. Explain changed files
7. Explain testing steps

Do not:

* Rewrite entire modules unnecessarily
* Introduce duplicate components
* Create alternative business rules
* Break existing APIs

---

# Important Principle

Jachoei is a trust and safety platform.

Accuracy is more important than visual effects.

False scam reports are worse than missing cosmetic features.

Prioritize:

1. Correctness
2. Stability
3. Performance
4. UX
5. Visual polish
