"use client";

import { FormEvent, useState } from "react";
import type {
  CheckoutPaymentAccount,
  CheckoutView,
} from "@/lib/bms/checkout";
import styles from "./checkout.module.css";

type Props = {
  token: string;
  initialCheckout: CheckoutView;
};

const statusLabels: Record<string, string> = {
  PENDING: "รอชำระเงิน",
  PAID: "ชำระเงินแล้ว",
  PACKING: "กำลังแพ็ก",
  SHIPPED: "จัดส่งแล้ว",
  COMPLETED: "สำเร็จ",
  CANCELLED: "ยกเลิกแล้ว",
  RETURNED: "คืนสินค้า",
};

const missingLabels = {
  recipientName: "ชื่อผู้รับ",
  phone: "เบอร์โทรศัพท์",
  shippingAddress: "ที่อยู่จัดส่ง",
};

const orderProgress = ["PENDING", "PAID", "PACKING", "SHIPPED", "COMPLETED"];

function money(value: number, currency: string) {
  return new Intl.NumberFormat("th-TH", {
    style: "currency",
    currency,
    maximumFractionDigits: 2,
  }).format(value);
}

function PaymentAccountCard({
  account,
  checked,
  onSelect,
}: {
  account: CheckoutPaymentAccount;
  checked: boolean;
  onSelect: () => void;
}) {
  const number = account.accountNo || account.promptpayId || "";
  return (
    <label
      className={`${styles.accountCard} ${
        checked ? styles.accountCardSelected : ""
      }`}
    >
      <input
        type="radio"
        name="paymentAccount"
        checked={checked}
        onChange={onSelect}
      />
      <span className={styles.accountIcon}>
        {account.type === "BANK" ? "BANK" : "PAY"}
      </span>
      <span className={styles.accountBody}>
        <strong>{account.title}</strong>
        <span>{number}</span>
        {account.accountName && <small>{account.accountName}</small>}
        {account.note && <small>{account.note}</small>}
      </span>
      <button
        type="button"
        className={styles.copyButton}
        onClick={(event) => {
          event.preventDefault();
          void navigator.clipboard?.writeText(number);
        }}
      >
        คัดลอก
      </button>
    </label>
  );
}

export default function CheckoutClient({
  token,
  initialCheckout,
}: Props) {
  const [checkout, setCheckout] = useState(initialCheckout);
  const [editingDelivery, setEditingDelivery] = useState(false);
  const [selectedAddressId, setSelectedAddressId] = useState(
    initialCheckout.delivery.selectedAddress?.id || ""
  );
  const [selectedAccountKey, setSelectedAccountKey] = useState(
    initialCheckout.payment.accounts[0]?.key || ""
  );
  const [deliveryBusy, setDeliveryBusy] = useState(false);
  const [paymentBusy, setPaymentBusy] = useState(false);
  const [error, setError] = useState("");
  const [slipName, setSlipName] = useState("");

  const delivery = checkout.delivery;
  const payment = checkout.payment;
  const selectedAccount =
    payment.accounts.find((item) => item.key === selectedAccountKey) ||
    payment.accounts[0];
  const paymentResolved =
    ["PAID", "PACKING", "SHIPPED", "COMPLETED"].includes(
      checkout.order.status
    ) ||
    payment.latest?.status === "CONFIRMED";
  const orderClosed = ["CANCELLED", "RETURNED"].includes(
    checkout.order.status
  );
  const paymentPending = payment.latest?.status === "PENDING";
  const progressIndex = orderProgress.indexOf(checkout.order.status);

  async function updateDelivery(payload: Record<string, string>) {
    setDeliveryBusy(true);
    setError("");
    try {
      const response = await fetch("/api/bms/checkout", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ token, ...payload }),
      });
      const data = (await response.json()) as {
        checkout?: CheckoutView;
        error?: string;
      };
      if (!response.ok || !data.checkout) {
        throw new Error(data.error || "บันทึกข้อมูลจัดส่งไม่สำเร็จ");
      }
      setCheckout(data.checkout);
      setSelectedAddressId(data.checkout.delivery.selectedAddress?.id || "");
      setEditingDelivery(false);
    } catch (caught) {
      setError(
        caught instanceof Error
          ? caught.message
          : "บันทึกข้อมูลจัดส่งไม่สำเร็จ"
      );
    } finally {
      setDeliveryBusy(false);
    }
  }

  async function saveDelivery(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const payload: Record<string, string> = {};
    for (const key of [
      "recipientName",
      "phone",
      "shippingAddress",
      "addressLabel",
    ]) {
      const value = String(form.get(key) || "").trim();
      if (value) payload[key] = value;
    }
    await updateDelivery(payload);
  }

  async function selectExistingAddress() {
    const address = delivery.addresses.find(
      (item) => item.id === selectedAddressId
    );
    if (!address) return;
    await updateDelivery({
      shippingAddress: address.address,
      addressLabel: address.label || "",
    });
  }

  async function submitPayment(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!selectedAccount) {
      setError("กรุณาเลือกช่องทางชำระเงิน");
      return;
    }
    setPaymentBusy(true);
    setError("");
    try {
      const form = new FormData(event.currentTarget);
      form.set("token", token);
      form.set("method", selectedAccount.method);
      const response = await fetch("/api/bms/checkout/payment", {
        method: "POST",
        body: form,
      });
      const data = (await response.json()) as {
        checkout?: CheckoutView;
        error?: string;
      };
      if (!response.ok || !data.checkout) {
        throw new Error(data.error || "แจ้งชำระไม่สำเร็จ");
      }
      setCheckout(data.checkout);
    } catch (caught) {
      setError(
        caught instanceof Error ? caught.message : "แจ้งชำระไม่สำเร็จ"
      );
    } finally {
      setPaymentBusy(false);
    }
  }

  return (
    <main className={styles.page}>
      <header className={styles.topbar}>
        <div className={styles.brand}>
          {checkout.store.logoUrl ? (
            <img src={checkout.store.logoUrl} alt="" />
          ) : (
            <span>{checkout.store.name.slice(0, 1)}</span>
          )}
          <div>
            <p className={styles.eyebrow}>SECURE CHECKOUT</p>
            <strong>{checkout.store.name}</strong>
          </div>
        </div>
        <span className={styles.securePill}>ลิงก์เฉพาะออร์เดอร์</span>
      </header>

      <div className={styles.shell}>
        <section className={styles.hero}>
          <div>
            <p className={styles.heroKicker}>ORDER #{checkout.order.displayId}</p>
            <h1>ตรวจสอบให้ครบ<br />แล้วแจ้งชำระ</h1>
          </div>
          <div className={styles.statusBadge}>
            <span />
            {statusLabels[checkout.order.status] || checkout.order.status}
          </div>
        </section>

        <div className={styles.columns}>
          <div className={styles.mainColumn}>
            <section className={styles.card}>
              <div className={styles.sectionHeading}>
                <div>
                  <span className={styles.step}>01</span>
                  <h2>รายการสั่งซื้อ</h2>
                </div>
                <span>{checkout.order.items.length} รายการ</span>
              </div>

              <div className={styles.itemList}>
                {checkout.order.items.map((item) => (
                  <article className={styles.item} key={`${item.sku}-${item.size}`}>
                    <div className={styles.itemVisual}>
                      {item.name.slice(0, 1)}
                    </div>
                    <div className={styles.itemInfo}>
                      <strong>{item.name}</strong>
                      <span>ไซซ์ {item.size} · {item.qty} ชิ้น</span>
                      <small>{item.sku}</small>
                    </div>
                    <b>{money(item.amount, checkout.store.currency)}</b>
                  </article>
                ))}
              </div>

              <dl className={styles.totals}>
                <div><dt>ยอดสินค้า</dt><dd>{money(checkout.order.subtotal, checkout.store.currency)}</dd></div>
                {checkout.order.discount > 0 && (
                  <div className={styles.discountRow}>
                    <dt>ส่วนลด {checkout.order.couponCode ? `(${checkout.order.couponCode})` : ""}</dt>
                    <dd>-{money(checkout.order.discount, checkout.store.currency)}</dd>
                  </div>
                )}
                <div className={styles.grandTotal}>
                  <dt>ยอดที่ต้องชำระ</dt>
                  <dd>{money(checkout.order.total, checkout.store.currency)}</dd>
                </div>
              </dl>
            </section>

            <section className={styles.card}>
              <div className={styles.sectionHeading}>
                <div>
                  <span className={styles.step}>02</span>
                  <h2>ข้อมูลจัดส่ง</h2>
                </div>
                {delivery.complete && !delivery.marketplaceManaged && (
                  <span className={styles.readyText}>พร้อมใช้</span>
                )}
              </div>

              {delivery.marketplaceManaged ? (
                <div className={styles.notice}>
                  <strong>ใช้ข้อมูลจาก Seller Center</strong>
                  <p>ชื่อผู้รับ ที่อยู่ และการชำระเงินของออร์เดอร์นี้จัดการโดย Marketplace ไม่ต้องกรอกซ้ำใน BMS</p>
                </div>
              ) : (
                <>
                  {delivery.complete && !editingDelivery ? (
                    <div className={styles.savedDelivery}>
                      <div className={styles.savedBanner}>
                        <span>✓</span>
                        <div>
                          <strong>ใช้ข้อมูลเดิมอัตโนมัติ</strong>
                          <p>ไม่ต้องกรอกข้อมูลชุดนี้อีก</p>
                        </div>
                      </div>
                      <dl>
                        <div><dt>ชื่อผู้รับ</dt><dd>{delivery.recipientName}</dd></div>
                        <div><dt>เบอร์โทร</dt><dd>{delivery.phone}</dd></div>
                        <div>
                          <dt>ที่อยู่</dt>
                          <dd>
                            {delivery.selectedAddress?.label && <b>{delivery.selectedAddress.label}</b>}
                            {delivery.selectedAddress?.address}
                          </dd>
                        </div>
                      </dl>

                      {delivery.addresses.length > 1 && (
                        <div className={styles.addressChooser}>
                          <p>เปลี่ยนไปใช้ที่อยู่เดิมรายการอื่น</p>
                          {delivery.addresses.map((address) => (
                            <label key={address.id}>
                              <input
                                type="radio"
                                name="savedAddress"
                                value={address.id}
                                checked={selectedAddressId === address.id}
                                onChange={() => setSelectedAddressId(address.id)}
                              />
                              <span>
                                <strong>{address.label || "ที่อยู่จัดส่ง"}</strong>
                                {address.address}
                              </span>
                            </label>
                          ))}
                          {selectedAddressId !== delivery.selectedAddress?.id && (
                            <button
                              type="button"
                              className={styles.secondaryButton}
                              disabled={deliveryBusy}
                              onClick={selectExistingAddress}
                            >
                              ใช้ที่อยู่นี้
                            </button>
                          )}
                        </div>
                      )}

                      <button
                        type="button"
                        className={styles.textButton}
                        onClick={() => setEditingDelivery(true)}
                      >
                        ต้องการแก้ข้อมูล
                      </button>
                    </div>
                  ) : (
                    <form className={styles.deliveryForm} onSubmit={saveDelivery}>
                      {!delivery.complete && (
                        <div className={styles.missingStrip}>
                          กรอกเฉพาะข้อมูลที่ยังขาด:{" "}
                          {delivery.missingFields.map((field) => missingLabels[field]).join(", ")}
                        </div>
                      )}

                      {(editingDelivery || delivery.missingFields.includes("recipientName")) && (
                        <label>
                          <span>ชื่อผู้รับ</span>
                          <input
                            name="recipientName"
                            defaultValue={delivery.recipientName || ""}
                            required={!delivery.recipientName}
                            minLength={2}
                            maxLength={120}
                            placeholder="ชื่อสำหรับรับพัสดุ"
                          />
                        </label>
                      )}
                      {(editingDelivery || delivery.missingFields.includes("phone")) && (
                        <label>
                          <span>เบอร์โทรศัพท์</span>
                          <input
                            name="phone"
                            defaultValue={delivery.phone || ""}
                            required={!delivery.phone}
                            inputMode="tel"
                            placeholder="เช่น 0891234567"
                          />
                        </label>
                      )}
                      {(editingDelivery || delivery.missingFields.includes("shippingAddress")) && (
                        <>
                          <label>
                            <span>ชื่อที่อยู่ <small>(ไม่บังคับ)</small></span>
                            <input
                              name="addressLabel"
                              defaultValue={delivery.selectedAddress?.label || ""}
                              placeholder="เช่น บ้าน หรือ ที่ทำงาน"
                            />
                          </label>
                          <label>
                            <span>ที่อยู่จัดส่ง</span>
                            <textarea
                              name="shippingAddress"
                              defaultValue={delivery.selectedAddress?.address || ""}
                              required={!delivery.selectedAddress}
                              minLength={10}
                              maxLength={1000}
                              placeholder="บ้านเลขที่ ถนน แขวง/ตำบล เขต/อำเภอ จังหวัด รหัสไปรษณีย์"
                            />
                          </label>
                        </>
                      )}
                      <div className={styles.formActions}>
                        {editingDelivery && (
                          <button
                            type="button"
                            className={styles.textButton}
                            onClick={() => setEditingDelivery(false)}
                          >
                            ยกเลิก
                          </button>
                        )}
                        <button
                          type="submit"
                          className={styles.primaryButton}
                          disabled={deliveryBusy}
                        >
                          {deliveryBusy ? "กำลังบันทึก..." : "บันทึกข้อมูลจัดส่ง"}
                        </button>
                      </div>
                    </form>
                  )}
                </>
              )}
            </section>
          </div>

          <aside className={styles.sideColumn}>
            <section className={`${styles.card} ${styles.paymentCard}`}>
              <div className={styles.sectionHeading}>
                <div>
                  <span className={styles.step}>03</span>
                  <h2>แจ้งชำระเงิน</h2>
                </div>
              </div>

              {delivery.marketplaceManaged ? (
                <div className={styles.notice}>
                  <strong>ชำระผ่าน Marketplace</strong>
                  <p>กลับไปดำเนินการใน Seller Center ของช่องทางที่สั่งซื้อ</p>
                </div>
              ) : orderClosed ? (
                <div className={styles.noPayment}>
                  <span>—</span>
                  <h3>ออร์เดอร์นี้ปิดแล้ว</h3>
                  <p>สถานะปัจจุบันไม่อนุญาตให้แจ้งชำระเงินเพิ่มเติม</p>
                </div>
              ) : paymentResolved ? (
                <div className={styles.successState}>
                  <span>✓</span>
                  <h3>ออร์เดอร์ชำระเงินแล้ว</h3>
                  <p>ร้านจะดำเนินการแพ็กและจัดส่งตามลำดับ</p>
                </div>
              ) : paymentPending ? (
                <div className={styles.pendingState}>
                  <span className={styles.pendingPulse} />
                  <p className={styles.eyebrow}>PAYMENT RECEIVED</p>
                  <h3>รับแจ้งชำระแล้ว</h3>
                  <p>กำลังรอแอดมินตรวจสลิป การส่งสลิปยังไม่ถือว่ายืนยันยอดจนกว่าแอดมินจะกด Confirm</p>
                  <dl>
                    <div><dt>ยอดแจ้งชำระ</dt><dd>{money(payment.latest?.amount || checkout.order.total, checkout.store.currency)}</dd></div>
                    <div><dt>สถานะ</dt><dd>รอตรวจสอบ</dd></div>
                  </dl>
                </div>
              ) : !payment.configured ? (
                <div className={styles.noPayment}>
                  <span>—</span>
                  <h3>ร้านยังไม่ได้ระบุช่องทางชำระเงิน</h3>
                  <p>หน้านี้จึงไม่แสดงหรือแนะนำบัญชีธนาคาร พร้อมเพย์ QR หรือช่องทางอื่นแทนร้าน</p>
                </div>
              ) : !delivery.complete ? (
                <div className={styles.lockedPayment}>
                  <span>02</span>
                  <h3>กรอกข้อมูลจัดส่งก่อน</h3>
                  <p>เมื่อข้อมูลส่วนที่ขาดครบ ช่องทางชำระเงินจะพร้อมใช้งานทันที</p>
                </div>
              ) : (
                <form className={styles.paymentForm} onSubmit={submitPayment}>
                  {payment.latest?.status === "REJECTED" && (
                    <div className={styles.rejectedStrip}>
                      สลิปก่อนหน้าไม่ผ่านการตรวจสอบ กรุณาตรวจข้อมูลและส่งใหม่
                    </div>
                  )}
                  <p className={styles.formIntro}>เลือกบัญชีที่ร้านตั้งค่าไว้</p>
                  <div className={styles.accountList}>
                    {payment.accounts.map((account) => (
                      <PaymentAccountCard
                        key={account.key}
                        account={account}
                        checked={selectedAccount?.key === account.key}
                        onSelect={() => setSelectedAccountKey(account.key)}
                      />
                    ))}
                  </div>

                  <div className={styles.amountPanel}>
                    <span>ยอดที่ต้องชำระ</span>
                    <strong>{money(checkout.order.total, checkout.store.currency)}</strong>
                  </div>

                  <label className={styles.upload}>
                    <input
                      type="file"
                      name="slip"
                      accept="image/jpeg,image/png,image/webp"
                      required
                      onChange={(event) =>
                        setSlipName(event.target.files?.[0]?.name || "")
                      }
                    />
                    <span className={styles.uploadMark}>+</span>
                    <strong>{slipName || "แนบรูปสลิป"}</strong>
                    <small>JPG, PNG หรือ WEBP ไม่เกิน 8 MB</small>
                  </label>

                  <label className={styles.referenceInput}>
                    <span>เลขอ้างอิง <small>(ไม่บังคับ)</small></span>
                    <input name="slipRef" maxLength={120} />
                  </label>

                  <button
                    type="submit"
                    className={styles.primaryButton}
                    disabled={paymentBusy}
                  >
                    {paymentBusy ? "กำลังส่งสลิป..." : "แจ้งชำระและส่งให้ร้านตรวจ"}
                  </button>
                  <p className={styles.paymentFootnote}>
                    การส่งสลิปจะสร้างสถานะ “รอตรวจสอบ” เท่านั้น ระบบไม่ยืนยันการชำระเงินอัตโนมัติ
                  </p>
                </form>
              )}
            </section>

            <section className={`${styles.card} ${styles.trackingCard}`}>
              <div className={styles.sectionHeading}>
                <div>
                  <span className={styles.step}>04</span>
                  <h2>ติดตามออร์เดอร์</h2>
                </div>
              </div>
              <ol className={styles.timeline}>
                {[
                  ["สร้างออร์เดอร์", 0],
                  ["ยืนยันการชำระเงิน", 1],
                  ["กำลังแพ็ก", 2],
                  ["จัดส่งแล้ว", 3],
                  ["สำเร็จ", 4],
                ].map(([label, index]) => {
                  const stepIndex = Number(index);
                  const active = progressIndex >= stepIndex;
                  const current = progressIndex === stepIndex;
                  return (
                    <li
                      key={String(label)}
                      className={active ? styles.timelineActive : ""}
                    >
                      <span>{active ? "✓" : ""}</span>
                      <div>
                        <strong>{label}</strong>
                        {current && <small>สถานะปัจจุบัน</small>}
                      </div>
                    </li>
                  );
                })}
              </ol>
              {checkout.fulfillment.trackingNo && (
                <div className={styles.trackingNumber}>
                  <span>เลขพัสดุ</span>
                  <strong>{checkout.fulfillment.trackingNo}</strong>
                  {checkout.fulfillment.carrier && (
                    <small>{checkout.fulfillment.carrier}</small>
                  )}
                </div>
              )}
              {orderClosed && (
                <div className={styles.closedStrip}>
                  ออร์เดอร์นี้อยู่ในสถานะ{" "}
                  {statusLabels[checkout.order.status] || checkout.order.status}
                </div>
              )}
            </section>
          </aside>
        </div>

        {error && (
          <div className={styles.errorToast} role="alert">
            {error}
          </div>
        )}

        <footer className={styles.footer}>
          <span>BMS CHECKOUT</span>
          <p>ยอด รายการสินค้า และสถานะทั้งหมดอ้างอิงจากออร์เดอร์ของร้านโดยตรง</p>
        </footer>
      </div>
    </main>
  );
}
