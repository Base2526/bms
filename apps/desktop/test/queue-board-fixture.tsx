import React from "react";
import { createRoot } from "react-dom/client";
import PickupQueueBoardPage from "../../web/app/(pos)/pos/queue-board/page";

// Mounts the shipping call-screen page unchanged. Data comes from the smoke server's fake
// `/api/pos/pickup-queue?view=board`; the device token comes from the real desktop preload.
createRoot(document.getElementById("root")!).render(<PickupQueueBoardPage />);
