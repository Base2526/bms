"use client";

import { FormEvent, useState } from "react";
import type {
  CheckoutPaymentAccount,
  CheckoutView,
} from "@/lib/bms/checkout";
import { useI18n } from "@/lib/i18nContext";
import type { Lang } from "@/i18n";
import styles from "./checkout.module.css";

type Props = {
  token: string;
  initialCheckout: CheckoutView;
};

const orderProgress = ["PENDING", "PAID", "PACKING", "SHIPPED", "COMPLETED"];

function money(value: number, currency: string, lang: Lang) {
  return new Intl.NumberFormat(lang === "en" ? "en-US" : "th-TH", {
    style: "currency",
    currency,
    maximumFractionDigits: 2,
  }).format(value);
}

function PaymentAccountCard({
  account,
  checked,
  onSelect,
  t,
}: {
  account: CheckoutPaymentAccount;
  checked: boolean;
  onSelect: () => void;
  t: (key: string) => string;
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
        {t("checkout.copy")}
      </button>
    </label>
  );
}

export default function CheckoutClient({
  token,
  initialCheckout,
}: Props) {
  const { t, lang } = useI18n();
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

  const statusLabels: Record<string, string> = {
    PENDING: t("checkout.status_pending"),
    PAID: t("checkout.status_paid"),
    PACKING: t("checkout.timeline_packing"),
    SHIPPED: t("checkout.timeline_shipped"),
    COMPLETED: t("checkout.timeline_completed"),
    CANCELLED: t("checkout.status_cancelled"),
    RETURNED: t("checkout.status_returned"),
  };

  const missingLabels: Record<string, string> = {
    recipientName: t("checkout.recipient_name"),
    phone: t("checkout.phone_full"),
    shippingAddress: t("checkout.shipping_address_default_label"),
  };

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
        throw new Error(data.error || t("checkout.save_delivery_error"));
      }
      setCheckout(data.checkout);
      setSelectedAddressId(data.checkout.delivery.selectedAddress?.id || "");
      setEditingDelivery(false);
    } catch (caught) {
      setError(
        caught instanceof Error
          ? caught.message
          : t("checkout.save_delivery_error")
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
      setError(t("checkout.select_payment_method_error"));
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
        throw new Error(data.error || t("checkout.submit_payment_error"));
      }
      setCheckout(data.checkout);
    } catch (caught) {
      setError(
        caught instanceof Error ? caught.message : t("checkout.submit_payment_error")
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
        <span className={styles.securePill}>{t("checkout.secure_order_link")}</span>
      </header>

      <div className={styles.shell}>
        <section className={styles.hero}>
          <div>
            <p className={styles.heroKicker}>{t("checkout.order_number_prefix")}{checkout.order.displayId}</p>
            <h1>{t("checkout.review_heading_line1")}<br />{t("checkout.review_heading_line2")}</h1>
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
                  <h2>{t("checkout.items_step_label")}</h2>
                </div>
                <span>{checkout.order.items.length} {t("checkout.items_count_suffix")}</span>
              </div>

              <div className={styles.itemList}>
                {checkout.order.items.map((item) => (
                  <article className={styles.item} key={`${item.sku}-${item.size}`}>
                    <div className={styles.itemVisual}>
                      {item.name.slice(0, 1)}
                    </div>
                    <div className={styles.itemInfo}>
                      <strong>{item.name}</strong>
                      <span>{t("checkout.size_label")} {item.size} · {item.qty} {t("checkout.qty_unit")}</span>
                      <small>{item.sku}</small>
                    </div>
                    <b>{money(item.amount, checkout.store.currency, lang)}</b>
                  </article>
                ))}
              </div>

              <dl className={styles.totals}>
                <div><dt>{t("checkout.subtotal")}</dt><dd>{money(checkout.order.subtotal, checkout.store.currency, lang)}</dd></div>
                {checkout.order.discount > 0 && (
                  <div className={styles.discountRow}>
                    <dt>{t("checkout.discount")} {checkout.order.couponCode ? `(${checkout.order.couponCode})` : ""}</dt>
                    <dd>-{money(checkout.order.discount, checkout.store.currency, lang)}</dd>
                  </div>
                )}
                <div>
                  <dt>{t("checkout.shipping_fee")}</dt>
                  <dd>
                    {checkout.order.shippingFee > 0
                      ? money(checkout.order.shippingFee, checkout.store.currency, lang)
                      : t("checkout.free")}
                  </dd>
                </div>
                <div className={styles.grandTotal}>
                  <dt>{t("checkout.grand_total")}</dt>
                  <dd>{money(checkout.order.total, checkout.store.currency, lang)}</dd>
                </div>
              </dl>
            </section>

            <section className={styles.card}>
              <div className={styles.sectionHeading}>
                <div>
                  <span className={styles.step}>02</span>
                  <h2>{t("checkout.delivery_step_label")}</h2>
                </div>
                {delivery.complete && !delivery.marketplaceManaged && (
                  <span className={styles.readyText}>{t("checkout.ready_text")}</span>
                )}
              </div>

              {delivery.marketplaceManaged ? (
                <div className={styles.notice}>
                  <strong>{t("checkout.marketplace_managed_title")}</strong>
                  <p>{t("checkout.marketplace_managed_body")}</p>
                </div>
              ) : (
                <>
                  {delivery.complete && !editingDelivery ? (
                    <div className={styles.savedDelivery}>
                      <div className={styles.savedBanner}>
                        <span>✓</span>
                        <div>
                          <strong>{t("checkout.saved_delivery_title")}</strong>
                          <p>{t("checkout.saved_delivery_body")}</p>
                        </div>
                      </div>
                      <dl>
                        <div><dt>{t("checkout.recipient_name")}</dt><dd>{delivery.recipientName}</dd></div>
                        <div><dt>{t("checkout.phone_short")}</dt><dd>{delivery.phone}</dd></div>
                        <div>
                          <dt>{t("checkout.address")}</dt>
                          <dd>
                            {delivery.selectedAddress?.label && <b>{delivery.selectedAddress.label}</b>}
                            {delivery.selectedAddress?.address}
                          </dd>
                        </div>
                      </dl>

                      {delivery.addresses.length > 1 && (
                        <div className={styles.addressChooser}>
                          <p>{t("checkout.change_saved_address")}</p>
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
                                <strong>{address.label || t("checkout.shipping_address_default_label")}</strong>
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
                              {t("checkout.use_this_address")}
                            </button>
                          )}
                        </div>
                      )}

                      <button
                        type="button"
                        className={styles.textButton}
                        onClick={() => setEditingDelivery(true)}
                      >
                        {t("checkout.want_to_edit")}
                      </button>
                    </div>
                  ) : (
                    <form className={styles.deliveryForm} onSubmit={saveDelivery}>
                      {!delivery.complete && (
                        <div className={styles.missingStrip}>
                          {t("checkout.missing_fields_prefix")}{" "}
                          {delivery.missingFields.map((field) => missingLabels[field]).join(", ")}
                        </div>
                      )}

                      {(editingDelivery || delivery.missingFields.includes("recipientName")) && (
                        <label>
                          <span>{t("checkout.recipient_name")}</span>
                          <input
                            name="recipientName"
                            defaultValue={delivery.recipientName || ""}
                            required={!delivery.recipientName}
                            minLength={2}
                            maxLength={120}
                            placeholder={t("checkout.recipient_name_placeholder")}
                          />
                        </label>
                      )}
                      {(editingDelivery || delivery.missingFields.includes("phone")) && (
                        <label>
                          <span>{t("checkout.phone_full")}</span>
                          <input
                            name="phone"
                            defaultValue={delivery.phone || ""}
                            required={!delivery.phone}
                            inputMode="tel"
                            placeholder={t("checkout.phone_placeholder")}
                          />
                        </label>
                      )}
                      {(editingDelivery || delivery.missingFields.includes("shippingAddress")) && (
                        <>
                          <label>
                            <span>{t("checkout.address_label_field")} <small>{t("checkout.optional")}</small></span>
                            <input
                              name="addressLabel"
                              defaultValue={delivery.selectedAddress?.label || ""}
                              placeholder={t("checkout.address_label_placeholder")}
                            />
                          </label>
                          <label>
                            <span>{t("checkout.shipping_address_default_label")}</span>
                            <textarea
                              name="shippingAddress"
                              defaultValue={delivery.selectedAddress?.address || ""}
                              required={!delivery.selectedAddress}
                              minLength={10}
                              maxLength={1000}
                              placeholder={t("checkout.shipping_address_placeholder")}
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
                            {t("common.cancel")}
                          </button>
                        )}
                        <button
                          type="submit"
                          className={styles.primaryButton}
                          disabled={deliveryBusy}
                        >
                          {deliveryBusy ? t("checkout.saving") : t("checkout.save_delivery")}
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
                  <h2>{t("checkout.payment_step_label")}</h2>
                </div>
              </div>

              {delivery.marketplaceManaged ? (
                <div className={styles.notice}>
                  <strong>{t("checkout.marketplace_payment_title")}</strong>
                  <p>{t("checkout.marketplace_payment_body")}</p>
                </div>
              ) : orderClosed ? (
                <div className={styles.noPayment}>
                  <span>—</span>
                  <h3>{t("checkout.order_closed_title")}</h3>
                  <p>{t("checkout.order_closed_body")}</p>
                </div>
              ) : paymentResolved ? (
                <div className={styles.successState}>
                  <span>✓</span>
                  <h3>{t("checkout.paid_title")}</h3>
                  <p>{t("checkout.paid_body")}</p>
                </div>
              ) : paymentPending ? (
                <div className={styles.pendingState}>
                  <span className={styles.pendingPulse} />
                  <p className={styles.eyebrow}>{t("checkout.payment_received_eyebrow")}</p>
                  <h3>{t("checkout.payment_received_title")}</h3>
                  <p>{t("checkout.payment_received_body")}</p>
                  <dl>
                    <div><dt>{t("checkout.amount_submitted")}</dt><dd>{money(payment.latest?.amount || checkout.order.total, checkout.store.currency, lang)}</dd></div>
                    <div><dt>{t("checkout.status")}</dt><dd>{t("checkout.awaiting_review")}</dd></div>
                  </dl>
                </div>
              ) : !payment.configured ? (
                <div className={styles.noPayment}>
                  <span>—</span>
                  <h3>{t("checkout.no_payment_method_title")}</h3>
                  <p>{t("checkout.no_payment_method_body")}</p>
                </div>
              ) : !delivery.complete ? (
                <div className={styles.lockedPayment}>
                  <span aria-hidden="true">🔒</span>
                  <h3>{t("checkout.fill_delivery_first_title")}</h3>
                  <p>{t("checkout.fill_delivery_first_body")}</p>
                </div>
              ) : (
                <form className={styles.paymentForm} onSubmit={submitPayment}>
                  {payment.latest?.status === "REJECTED" && (
                    <div className={styles.rejectedStrip}>
                      {t("checkout.slip_rejected_notice")}
                    </div>
                  )}
                  <p className={styles.formIntro}>{t("checkout.choose_account_intro")}</p>
                  <div className={styles.accountList}>
                    {payment.accounts.map((account) => (
                      <PaymentAccountCard
                        key={account.key}
                        account={account}
                        checked={selectedAccount?.key === account.key}
                        onSelect={() => setSelectedAccountKey(account.key)}
                        t={t}
                      />
                    ))}
                  </div>

                  <div className={styles.amountPanel}>
                    <span>{t("checkout.amount_due")}</span>
                    <strong>{money(checkout.order.total, checkout.store.currency, lang)}</strong>
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
                    <strong>{slipName || t("checkout.attach_slip")}</strong>
                    <small>{t("checkout.slip_file_hint")}</small>
                  </label>

                  <label className={styles.referenceInput}>
                    <span>{t("checkout.reference_number")} <small>{t("checkout.optional")}</small></span>
                    <input name="slipRef" maxLength={120} />
                  </label>

                  <button
                    type="submit"
                    className={styles.primaryButton}
                    disabled={paymentBusy}
                  >
                    {paymentBusy ? t("checkout.sending_slip") : t("checkout.submit_payment")}
                  </button>
                  <p className={styles.paymentFootnote}>
                    {t("checkout.payment_footnote")}
                  </p>
                </form>
              )}
            </section>

            <section className={`${styles.card} ${styles.trackingCard}`}>
              <div className={styles.sectionHeading}>
                <div>
                  <span className={styles.step}>04</span>
                  <h2>{t("checkout.track_order_step_label")}</h2>
                </div>
              </div>
              <ol className={styles.timeline}>
                {[
                  [t("checkout.timeline_created"), 0],
                  [t("checkout.timeline_confirmed"), 1],
                  [t("checkout.timeline_packing"), 2],
                  [t("checkout.timeline_shipped"), 3],
                  [t("checkout.timeline_completed"), 4],
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
                        {current && <small>{t("checkout.current_status")}</small>}
                      </div>
                    </li>
                  );
                })}
              </ol>
              {checkout.fulfillment.trackingNo && (
                <div className={styles.trackingNumber}>
                  <span>{t("checkout.tracking_number")}</span>
                  <strong>{checkout.fulfillment.trackingNo}</strong>
                  {checkout.fulfillment.carrier && (
                    <small>{checkout.fulfillment.carrier}</small>
                  )}
                </div>
              )}
              {orderClosed && (
                <div className={styles.closedStrip}>
                  {t("checkout.order_in_status_prefix")}{" "}
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
          <p>{t("checkout.footer_note")}</p>
        </footer>
      </div>
    </main>
  );
}
