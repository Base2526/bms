"use client";

import { create } from "zustand";

type GlobalInboxState = {
  activeConversationId: string | null;   // conversation ที่กำลังเปิดอยู่ใน /admin/inbox

  setActiveConversation: (id: string | null) => void;
};

export const useGlobalInboxStore = create<GlobalInboxState>((set: any) => ({
  activeConversationId: null,

  setActiveConversation(id: any) {
    set({ activeConversationId: id });
  },
}));

// helper สำหรับใช้แบบ getState() ข้างนอก React hook (เช่นใน subscription callback)
export const getGlobalInboxState = () => useGlobalInboxStore.getState();
