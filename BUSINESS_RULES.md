# BUSINESS_RULES.md

# AI Business Management System (AI-BMS)

This document defines all business rules.

AI MUST follow these rules.

Business logic belongs here.

Never duplicate business logic inside AI prompts.

---

# Customer

A customer may come from multiple channels.

Example

LINE

TikTok

Facebook

Website

may belong to the same customer.

Customer matching priority:

1. Customer ID
2. LINE User ID
3. TikTok User ID
4. Facebook ID
5. Email
6. Phone Number

One customer can have multiple shipping addresses.

Customer must never be deleted.

Use Soft Delete only.

---

# Product

SKU must be unique.

Barcode should be unique.

Inactive products cannot be sold.

Product price cannot be negative.

Product stock cannot be negative unless AllowNegativeStock is enabled.

---

# Inventory

Inventory is the source of truth.

Current Stock

=

Available Stock

+

Reserved Stock

Available Stock

=

Current Stock

-

Reserved Stock

Every stock change MUST generate Stock Movement.

Never update inventory directly.

Always use Inventory Service.

Movement Types

STOCK_IN

STOCK_OUT

RESERVE

RELEASE

TRANSFER

ADJUSTMENT

RETURN

DAMAGED

---

# Orders

Order lifecycle

Draft

↓

Pending Payment

↓

Paid

↓

Packing

↓

Shipped

↓

Completed

Cancelled

Refunded

Rules

Draft

No stock deducted.

Pending Payment

Reserve stock.

Paid

Keep stock reserved.

Packing

Stock already reserved.

Shipped

Deduct stock permanently.

Completed

No further changes.

Cancelled

Release reserved stock.

Refunded

Return stock only if goods received back.

---

# Payments

Payment Methods

Bank Transfer

QR Payment

Credit Card

Cash

TikTok Payment

Rules

Order cannot move to Paid without payment verification.

AI may verify payment slip.

Only backend confirms payment.

---

# Shipping

Tracking Number required before Shipped.

Shipping Provider

Flash

Kerry

DHL

Australia Post

NZ Post

Order cannot be Completed before Shipped.

---

# Purchase Orders

Status

Draft

Ordered

Partially Received

Received

Cancelled

Receiving goods automatically increases inventory.

Cancelled PO cannot receive products.

---

# CRM

Every conversation belongs to one customer.

Conversation must never be deleted.

Internal notes are not visible to customers.

---

# AI Rules

AI NEVER accesses database directly.

AI NEVER writes SQL.

AI NEVER updates database directly.

AI ONLY calls approved tools.

AI should ask for confirmation before

Deleting

Refunding

Cancelling

Changing price

Adjusting inventory

---

# Security

All write operations require authenticated users.

Every write operation must be logged.

Audit Log includes

User

Timestamp

Action

Before

After

Reason

---

# Permissions

Admin

Full access.

Manager

Cannot modify system settings.

Sales

Can create orders.

Cannot modify inventory manually.

Warehouse

Can receive goods.

Can ship orders.

Cannot change prices.

Customer Support

Can view CRM.

Can reply chat.

Cannot modify inventory.

---

# Notifications

Low Stock

New Order

Payment Received

Shipment Created

Purchase Order Received

Inventory Adjustment

All notifications should be logged.

---

# Reports

Reports are read-only.

Reports never modify business data.

Reports must always use transactional data.

---

# AI Decision Rule

AI should determine intent first.

Intent

↓

Tool

↓

Backend

↓

Database

↓

Response

Never

Intent

↓

SQL

↓

Response

---

# Design Principle

Business logic belongs to Services.

Database belongs to Repositories.

AI only orchestrates workflows.

AI is not the source of truth.

Database is the source of truth.