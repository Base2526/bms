'use client';
import { useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import { gql, useQuery } from "@apollo/client";
import { Skeleton } from "antd";
import { useBmsPermissions } from "@/app/hooks/useBmsPermissions";
import { useSessionCtx } from "@/lib/session-context";
import { firstAdminDestination } from "@/lib/bms/adminNavigation";

// หน้าแรก admin เดิม redirect ไป /admin/dashboard ตายตัว ซึ่งอ่านด้วยสิทธิ์ report.view
// → role ที่ดูแลคลัง/แคตาล็อก (ไม่มีสิทธิ์นั้น) เพิ่งล็อกอินเสร็จก็เจอการ์ด "ไม่มีสิทธิ์" ทันที
// ตอนนี้เลือกปลายทางจากนิยามเมนูชุดเดียวกับ sidebar → ได้หน้าที่ผู้ใช้เปิดได้จริงเสมอ
// (โค้ด dashboard ของโปรเจกต์เก่า posts/files/users อยู่ใน git history)
const Q_HOME = gql`
  query {
    bmsIsPlatformAdmin
    bmsStoreProfile { businessArchetype }
    bmsKitchenBoardEnabled
    bmsWastageEnabled
    bmsPackToolsConfigured
  }
`;

export default function AdminHome() {
  const router = useRouter();
  const { admin } = useSessionCtx();
  const { can, loading: permsLoading } = useBmsPermissions();
  // errorPolicy: 'all' — เหตุผลเดียวกับ sidebar: FORBIDDEN ที่คาดไว้แล้วไม่ควรทำให้หน้าค้าง
  const { data, loading } = useQuery(Q_HOME, { fetchPolicy: "cache-first", errorPolicy: "all" });

  // ยิง replace ครั้งเดียว — `can` มาจาก useCallback ที่ผูกกับ array ของ Apollo ซึ่งเปลี่ยน
  // reference ได้ตอน refetch (cache-and-network) หน้าที่ทำหน้าที่ redirect เพียงอย่างเดียว
  // ไม่ควรยิง navigation ซ้ำเพราะ dependency ขยับ
  const redirected = useRef(false);
  useEffect(() => {
    if (permsLoading || loading || redirected.current) return;
    redirected.current = true;
    router.replace(firstAdminDestination({
      can,
      isPlatformAdmin: data?.bmsIsPlatformAdmin === true,
      isAdministrator: admin?.role === "Administrator",
      archetype: data?.bmsStoreProfile?.businessArchetype ?? null,
      kitchenBoardEnabled: data?.bmsKitchenBoardEnabled === true,
      wastageEnabled: data?.bmsWastageEnabled === true,
      packToolsConfigured: data?.bmsPackToolsConfigured === true,
    }));
  }, [permsLoading, loading, can, data, admin?.role, router]);

  return <Skeleton active paragraph={{ rows: 6 }} />;
}
