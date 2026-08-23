'use client';
import { gql, useQuery } from "@apollo/client";
import { useCallback } from "react";

export const Q_MY_PERMS = gql`query MyBmsPermissions { myBmsPermissions }`;
const EMPTY_PERMISSIONS: string[] = [];

/** สิทธิ์ BMS ของ admin ปัจจุบัน — ใช้ซ่อน/แสดงปุ่มใน UI (Administrator ได้ทุกสิทธิ์) */
export function useBmsPermissions() {
  const { data, loading } = useQuery(Q_MY_PERMS, {
    fetchPolicy: "cache-and-network",
    nextFetchPolicy: "cache-first",
  });
  const perms: string[] = data?.myBmsPermissions ?? EMPTY_PERMISSIONS;
  const can = useCallback((permission: string) => perms.includes(permission), [perms]);
  return { perms, can, loading };
}
