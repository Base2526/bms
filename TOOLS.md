# TOOLS.md

This file defines every tool available to AI.

AI MUST only call tools defined here.

---

# Product Tools

## searchProducts()

Search products.

Input

{
    keyword,
    categoryId?,
    brandId?
}

Output

[
    Product
]

---

## getProduct()

Get product detail.

Input

{
    productId
}

Output

Product

---

## checkStock()

Input

{
    productId?,
    sku?,
    productName?,
    size?,
    warehouseId?
}

Output

{
    currentStock,
    reservedStock,
    availableStock
}

---

# Inventory

## stockIn()

Input

{
    warehouseId,
    productId,
    quantity,
    reason
}

Output

StockMovement

---

## stockOut()

Input

{
    warehouseId,
    productId,
    quantity,
    reason
}

Output

StockMovement

---

## reserveStock()

Input

{
    orderId,
    items[]
}

Output

Reservation Result

---

## releaseStock()

Input

{
    orderId
}

Output

Success

---

## transferStock()

Input

{
    fromWarehouse,
    toWarehouse,
    items[]
}

Output

Transfer Result

---

## adjustStock()

Input

{
    warehouseId,
    productId,
    quantity,
    reason
}

Human approval required.

---

# Customer

## searchCustomer()

Search customer.

Input

{
    keyword
}

---

## getCustomer()

Input

{
    customerId
}

---

## createCustomer()

Input

{
    name,
    phone,
    email
}

---

## mergeCustomer()

Merge duplicated customers.

Admin only.

---

# Orders

## createDraftOrder()

Input

{
    customerId,
    channel,
    items[]
}

Output

Draft Order

---

## addOrderItem()

Input

{
    orderId,
    productId,
    quantity
}

---

## removeOrderItem()

Input

{
    orderId,
    orderItemId
}

---

## confirmOrder()

Confirm order.

Reserve stock.

---

## cancelOrder()

Release stock.

Admin approval required.

---

## getOrder()

Input

{
    orderId
}

---

## getOrderStatus()

Input

{
    orderNo
}

---

# Purchase Orders

## createPurchaseOrder()

## receivePurchaseOrder()

## cancelPurchaseOrder()

---

# Payment

## verifyPaymentSlip()

OCR

AI Validation

Backend Confirmation

---

## confirmPayment()

Backend only.

---

## refundPayment()

Manager approval required.

---

# Shipping

## createShipment()

Input

{
    orderId
}

---

## updateTracking()

Input

{
    trackingNo
}

---

# Reports

## getDashboard()

Today's overview.

---

## getSalesSummary()

Input

{
    from,
    to
}

---

## getInventorySummary()

---

## getLowStockProducts()

---

## getTopSellingProducts()

---

# AI

## summarizeConversation()

Summarize chat history.

---

## classifyIntent()

Return

Intent

Confidence

Entities

---

## recommendProducts()

Recommend products.

---

## detectLanguage()

Return

Language

Confidence

---

# Future Tools

forecastDemand()

predictStockOut()

suggestPurchaseOrder()

generateInvoice()

generateQuotation()

sendLINEMessage()

sendTikTokMessage()

sendEmail()

voiceCall()

OCRInvoice()

AIForecast()

BusinessAnalytics()

FraudDetection()

DemandPrediction()