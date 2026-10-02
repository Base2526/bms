import type { Metadata } from "next";
import AdminLayoutClient from "@/components/AdminLayoutClient";
import { isRetailLocalDeployment } from "@/lib/bms/deploymentMode";

export const metadata: Metadata = {
  robots: {
    index: false,
    follow: false,
  },
};

export default async function AdminLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return <AdminLayoutClient retailLocal={isRetailLocalDeployment()}>{children}</AdminLayoutClient>;
}
