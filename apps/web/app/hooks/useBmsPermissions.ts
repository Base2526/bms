'use client';
import { gql, useQuery } from "@apollo/client";

const Q_MY_PERMS = gql`query { myBmsPermissions }`;

/** สิทธิ์ BMS ของ admin ปัจจุบัน — ใช้ซ่อน/แสดงปุ่มใน UI (Administrator ได้ทุกสิทธิ์) */
export function useBmsPermissions() {
  const { data, loading } = useQuery(Q_MY_PERMS, { fetchPolicy: "cache-first" });
  const perms: string[] = data?.myBmsPermissions || [];
  const can = (p: string) => perms.includes(p);
  return { perms, can, loading };
}
