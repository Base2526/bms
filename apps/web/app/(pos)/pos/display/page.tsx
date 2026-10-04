"use client";
import { useEffect, useState } from "react";
import { CustomerDisplayView } from "@/components/pos/CustomerDisplayView";
import { CUSTOMER_DISPLAY_CHANNEL, createDisplayReceiver, EMPTY_CUSTOMER_DISPLAY } from "@/lib/pos/customerDisplay";

export default function CustomerDisplayPage() {
  const [display, setDisplay] = useState({ linked: false, state: EMPTY_CUSTOMER_DISPLAY });
  useEffect(() => {
    if (typeof BroadcastChannel === "undefined") return;
    const receiver = createDisplayReceiver();
    const channel = new BroadcastChannel(CUSTOMER_DISPLAY_CHANNEL);
    const refresh = () => setDisplay(receiver.read(Date.now()));
    const hello = () => channel.postMessage({ type: "hello" });
    channel.onmessage = event => {
      if (receiver.receive(event.data, Date.now())) refresh();
    };
    hello();
    // Reconcile locally even if the cashier window loaded after this display.
    const heartbeat = window.setInterval(hello, 2000);
    const expiry = window.setInterval(refresh, 500);
    window.addEventListener("focus", hello);
    return () => {
      window.clearInterval(heartbeat);
      window.clearInterval(expiry);
      window.removeEventListener("focus", hello);
      channel.close();
    };
  }, []);
  return <CustomerDisplayView {...display} />;
}
