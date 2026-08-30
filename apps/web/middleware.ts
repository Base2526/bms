// apps/web/middleware.ts
import { NextRequest, NextResponse } from "next/server";
import { ADMIN_COOKIE, USER_COOKIE } from "./lib/auth/token"

// import { useSessionCtx } from './lib/session-context';
// import { useSession } from './lib/useSession';

const PUBLIC = ["/admin/login"];
const PROTECTED_PREFIXES = ['/chat']; // ต้องล็อกอินก่อนเข้าดู

export const config = {
  // จงใจรวมทั้ง /admin/** และ /api/** ด้วย
  matcher: [
    "/admin/:path*",
    "/api/:path*",           // << สำคัญ: ให้มั่นใจว่า /api/graphql โดน middleware เสมอ
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:png|jpg|jpeg|svg|gif|webp)$).*)",

    '/chat/:path*', 
    '/profile/:path*',
    '/post/:path*'
  ],
};

export function middleware(req: NextRequest) {
  const { pathname, search } = req.nextUrl;
  if (!pathname.startsWith("/admin")){
    const userToken = req.cookies.get(USER_COOKIE)?.value;
    const adminToken = req.cookies.get(ADMIN_COOKIE)?.value;
    const { pathname } = req.nextUrl;

    // ถ้าไม่มีทั้ง user/admin token และ path นี้อยู่ในกลุ่มที่ต้องล็อกอิน → redirect ไป /login
    if (!userToken && !adminToken && PROTECTED_PREFIXES.some(p => pathname.startsWith(p))) {
      const loginUrl = new URL('/login', req.url);
      // เก็บปลายทางเดิมรวม query string ไว้
      const next = pathname + (search || '');
      loginUrl.searchParams.set('next', next);
      return NextResponse.redirect(loginUrl);
    }

    return NextResponse.next();
  } 
  if (PUBLIC.includes(pathname)) return NextResponse.next();

  const token = req.cookies.get(ADMIN_COOKIE)?.value;

  if (!token) return redirectToLogin(req);


  // const pathname = url.pathname; // "/admin/posts"
  // const hostname = url.hostname; // "admin.example.com"

  const is_admin = pathname.startsWith("/admin"); // || pathname.startsWith("admin.");
  const requestHeaders = new Headers(req.headers);
  requestHeaders.set("x-scope", is_admin ? "admin" : "web"); // <— ใส่ scope ให้ทุก request

  // return NextResponse.next({ request: { headers: requestHeaders } });

  // return NextResponse.next(); // verification ทำใน layout/route handler

  // 2) (ทางเลือก) ใส่ response header เผื่อ debug ใน Network
  const res = NextResponse.next({
    request: { headers: requestHeaders },
  });
  res.headers.set("x-mw-scope", is_admin ? "admin" : "web");

  // 3) (กันพลาด) ถ้าอยากใช้ cookie เป็น fallback ฝั่ง server ด้วย
  //    หมายเหตุ: cookie นี้จะใช้กับ request ถัดไป ไม่ใช่ตัวเดียวกัน
  // res.cookies.set("scope", isAdmin ? "admin" : "web", { path: "/", sameSite: "lax" });

  return res;
}

function redirectToLogin(req: NextRequest) {
  const url = req.nextUrl.clone();
  url.pathname = "/admin/login";
  url.searchParams.set("next", req.nextUrl.pathname + (req.nextUrl.search || ""));
  return NextResponse.redirect(url);
}
// export const config = { matcher: ["/admin/:path*"] };
