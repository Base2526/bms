import React from "react";
import { createRoot } from "react-dom/client";
import "../../web/app/(pos)/pos/pos.css";
import restaurantStyles from "../../web/app/(pos)/pos/restaurant/restaurant.module.css";
import { PickupQueueStrip } from "../../web/components/pos/PickupQueuePanel";
import { PickupQueueRetryButton } from "../../web/components/pos/PickupQueueManager";

// The till strip + manager exactly as /pos renders them, inside the real `.pos-root` styles.
function Till() {
  const compact = new URLSearchParams(window.location.search).get("variant") === "compact";
  const [issued, setIssued] = React.useState<string | null>(null);
  if (compact) {
    return (
      <main className={`pos-root ${restaurantStyles.page}`} style={{ minHeight: "100vh" }}>
        <div aria-hidden="true" />
        <div className={restaurantStyles.shell}>
          <div className={restaurantStyles.contentRegion}>
            <div className={restaurantStyles.floorWrap}>
              <section className={restaurantStyles.floorStatusDashboard} data-compact-fixture>
                <PickupQueueStrip token="FAKE-device-token" cashierUserId="FAKE-cashier" cashierPin="0000"
                  refreshKey={0} variant="compact" />
                <div className={`${restaurantStyles.strip} ${restaurantStyles.floorStatusStrip}`}>
                  <span>โต๊ะใช้งาน <b>1</b> / 13</span>
                  <span className={restaurantStyles.stripSep} aria-hidden="true">│</span>
                  <span>ยอดเปิดค้าง <b><span className={restaurantStyles.baht}>฿</span>178.00</b></span>
                  <span className={restaurantStyles.stripSep} aria-hidden="true">│</span>
                  <span><span className={restaurantStyles.stripDot} style={{ background: "var(--red)" }} />ยังไม่ส่งครัว 0 รายการ · 0 บิล</span>
                  <span className={restaurantStyles.stripSep} aria-hidden="true">│</span>
                  <span>นั่งนานสุด <b>16</b> นาที · T03</span>
                  <span className={restaurantStyles.stripSep} aria-hidden="true">│</span>
                  <span><span className={restaurantStyles.stripDot} style={{ background: "var(--amber)" }} />คิวครัว 20 กำลังทำ · 3 พร้อมเสิร์ฟ</span>
                </div>
              </section>
            </div>
          </div>
        </div>
      </main>
    );
  }
  return (
    <div className="pos-root" style={{ minHeight: "100vh", padding: 16, background: "var(--pos-bg)" }}>
      <PickupQueueStrip token="FAKE-device-token" cashierUserId="FAKE-cashier" cashierPin="0000" refreshKey={0} />
      <div data-retry-area style={{ marginTop: 12 }}>
        {issued
          ? <b data-issued>{`ออกเลขแล้ว ${issued}`}</b>
          : <PickupQueueRetryButton token="FAKE-device-token" cashierUserId="FAKE-cashier" cashierPin="0000"
              orderId="FAKE-order-retry" onIssued={setIssued} />}
      </div>
    </div>
  );
}

createRoot(document.getElementById("root")!).render(<Till />);
