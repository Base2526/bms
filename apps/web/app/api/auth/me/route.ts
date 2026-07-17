// apps/web/app/api/auth/me/route.ts
import { NextResponse } from "next/server";
import { verifyUserSession, verifyAdminSession } from "@/lib/auth/server";

export const dynamic = 'force-dynamic';
export const revalidate = 0;

export async function GET() {
  const user  = verifyUserSession();
  const admin  = verifyAdminSession();

  return NextResponse.json({
    isAuthenticated: Boolean(user || admin),
    user,
    admin
  }, { headers: { 'Cache-Control': 'no-store' }});
}
