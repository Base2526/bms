# AI Business Management System (AI-BMS)

## Overview

AI-BMS is an AI-first Business Management System designed to automate business operations from customer conversations to order fulfillment.

Unlike traditional ERP or CRM systems, AI-BMS treats customer conversations as the starting point of every business workflow.

Supported channels:

- LINE Official Account
- TikTok Shop / TikTok Chat
- Facebook Messenger
- Instagram
- Website Live Chat
- Future:
  - WhatsApp
  - Email
  - Voice AI

---

# Vision

Every customer conversation should become an executable business workflow.

Instead of:

Customer
→ Human
→ Excel
→ ERP

AI-BMS should automate:

Customer
→ AI
→ CRM
→ Order
→ Inventory
→ Payment
→ Shipping
→ Dashboard

---

# Core Philosophy

AI should NEVER access the database directly.

AI is only responsible for:

- Understanding user intent
- Selecting the correct business tool
- Summarizing data
- Explaining results

Business logic always belongs to backend services.

Database access is ONLY allowed through approved service functions.

---

# High Level Architecture

Customer

↓

Channel Integration

↓

Omnichannel Inbox

↓

AI Orchestrator

↓

Business Functions

↓

Database

↓

Response Generator

↓

Customer

---

# System Modules

## 1. Channel Integration

Responsible for receiving messages/events from:

- LINE Messaging API
- TikTok APIs
- Facebook Graph API
- Instagram API
- Website Chat

Convert every platform into one internal message format.

Example:

{
  channel
  customerId
  conversationId
  message
  timestamp
}

---

## 2. Omnichannel Inbox

Unified inbox for all channels.

Features:

- Chat history
- Assign staff
- Internal notes
- Tags
- Customer timeline
- Attachments
- Search

---

## 3. AI Orchestrator

The AI layer.

Responsibilities:

- Intent detection
- Entity extraction
- Tool selection
- Context understanding
- Response generation

AI must NOT contain business logic.

Example:

Customer:

Nike XL available?

↓

Intent

check_stock

↓

Entity

{
    product: Nike
    size: XL
}

↓

Tool

checkStock()

---

## 4. CRM

Stores customer information.

Customer profile includes:

- Name
- Phone
- Email
- LINE User ID
- TikTok User ID
- Facebook ID
- Shipping addresses
- Purchase history
- Lifetime value
- Tags
- Notes

Multiple channels may belong to one customer.

---

## 5. Product Management

Responsible for:

- Products
- Variants
- SKU
- Barcode
- Images
- Pricing
- Categories
- Brands

---

## 6. Inventory Management System (IMS)

Handles stock.

Features:

- Current Stock
- Reserved Stock
- Available Stock
- Stock In
- Stock Out
- Transfer
- Adjustment
- Stock Movement

Every stock change MUST create a Stock Movement record.

Never update stock without logging movement.

---

## 7. Order Management System (OMS)

Responsible for customer orders.

Statuses:

Draft

Pending Payment

Paid

Packing

Shipped

Completed

Cancelled

Refunded

---

## 8. Purchase Management

Supplier purchase orders.

Features:

- Create PO
- Receive Items
- Partial Receive
- Cancel PO
- Supplier History

---

## 9. Payment

Supports:

- Bank Transfer
- QR Payment
- Credit Card
- TikTok Payment
- Cash

Future:

AI Slip Verification

OCR

---

## 10. Shipping

Supports:

- Flash
- Kerry
- DHL
- Australia Post
- NZ Post

Features:

Tracking Number

Packing

Label Printing

Shipping Status

---

## 11. Reports

Dashboard

Sales

Inventory

Customer

Supplier

Financial

AI Usage

Staff Performance

---

# AI Rules

AI must NEVER write SQL.

Incorrect:

AI

↓

SELECT * FROM products

Correct:

AI

↓

checkStock()

↓

Backend

↓

SQL

---

# Tool Calling

AI interacts ONLY through approved tools.

Examples:

checkStock()

searchProduct()

getProduct()

createDraftOrder()

confirmOrder()

cancelOrder()

reserveStock()

releaseStock()

getOrderStatus()

getCustomer()

searchCustomer()

createCustomer()

getSalesSummary()

getLowStockProducts()

getDashboard()

---

# AI Flow

Customer

↓

Message

↓

Intent Detection

↓

Entity Extraction

↓

Select Tool

↓

Backend Service

↓

Database

↓

Return Result

↓

Generate Human Response

---

# Example

Customer:

Do you have Nike XL?

AI

↓

Intent

check_stock

↓

Tool

checkStock()

↓

Backend

↓

Stock = 5

↓

AI

↓

We currently have 5 pairs available.

---

# Business Rules

AI must never:

Delete database records

Update prices

Adjust inventory

Refund orders

Delete customers

Without explicit approval.

Sensitive actions require:

Human Confirmation

or

Role Permission

---

# Folder Structure

/apps

/api

/services

/ai

/channels

/modules

inventory

orders

crm

payment

shipping

reports

/shared

/database

---

# Coding Rules

Business Logic

↓

Services

Database

↓

Repositories

AI

↓

Never contains SQL

Frontend

↓

Never contains business logic

---

# Future Roadmap

Phase 1

Inventory

Products

Orders

CRM

Phase 2

LINE Integration

TikTok Integration

Payments

Shipping

Phase 3

AI Tool Calling

AI Agent

OCR

Phase 4

Voice AI

Forecasting

Demand Prediction

Business Intelligence

---

# Design Principle

Everything starts from a conversation.

Conversation

↓

Intent

↓

Business Function

↓

Business Data

↓

Business Action

↓

Customer Response

AI-BMS is NOT an AI Chatbot.

AI-BMS is an AI Business Operating System.