// apps/web/middleware.ts
import { NextRequest, NextResponse } from "next/server";
import { ADMIN_COOKIE, USER_COOKIE } from "./lib/auth/token";
import {
  isLocalizedPublicPath,
  localeFromPublicPath,
  localizedPublicPath,
  stripPublicLocale,
  type PublicSeoLocale,
} from "./lib/publicSeo";

// import { useSessionCtx } from './lib/session-context';
// import { useSession } from './lib/useSession';

const PUBLIC = ["/admin/login"];
const PROTECTED_PREFIXES = ['/chat']; // ต้องล็อกอินก่อนเข้าดู
const NOINDEX_PREFIXES = [
  "/admin",
  "/api",
  "/checkout",
  "/pos",
  "/q/",
  "/bg/",
  "/tax-invoice/request",
  "/installer-report",
  "/register",
  "/forgot",
  "/reset",
  "/verify-email",
  "/shop-signup",
  "/chat",
  "/blocked",
  "/coupon/wallet",
  "/live-dashboard",
  "/my/",
  "/notification",
  "/settings",
  "/search",
  "/post",
  "/profile/",
  "/donate",
];

export const config = {
  // Upload intake is excluded so middleware cannot buffer bodies before each
  // route enforces its own authorization/consent and streaming size bounds.
  matcher: [
    "/admin/:path*",
    "/((?!api/admin/retail-local/releases-upload|api/installer-reports|api/admin/retail-local/runtime-release-upload|_next/static|_next/image|favicon.ico|.*\\.(?:png|jpg|jpeg|svg|gif|webp)$).*)",

    '/chat/:path*', 
    '/profile/:path*',
    '/post/:path*'
  ],
};

export function middleware(req: NextRequest) {
  const { pathname, search } = req.nextUrl;

  const pathLocale = localeFromPublicPath(pathname);
  if (pathLocale) {
    const publicPath = stripPublicLocale(pathname);
    if (isLocalizedPublicPath(publicPath)) {
      const rewriteUrl = req.nextUrl.clone();
      rewriteUrl.pathname = publicPath;
      const requestHeaders = new Headers(req.headers);
      const requestCookies = req.cookies.getAll()
        .filter((cookie) => cookie.name !== "lang")
        .map((cookie) => `${cookie.name}=${cookie.value}`);
      requestCookies.push(`lang=${pathLocale}`);
      requestHeaders.set("cookie", requestCookies.join("; "));
      requestHeaders.set("x-bms-public-locale", pathLocale);
      requestHeaders.set("x-bms-public-path", publicPath);
      const response = NextResponse.rewrite(rewriteUrl, { request: { headers: requestHeaders } });
      response.cookies.set("lang", pathLocale, {
        path: "/",
        sameSite: "lax",
        secure: req.nextUrl.protocol === "https:",
      });
      return response;
    }
  }

  if (isLocalizedPublicPath(pathname)) {
    const cookieLocale: PublicSeoLocale = req.cookies.get("lang")?.value === "en" ? "en" : "th";
    const localizedUrl = req.nextUrl.clone();
    localizedUrl.pathname = localizedPublicPath(pathname, cookieLocale);
    // This destination depends on a preference, so it must not be cached as permanent.
    const response = NextResponse.redirect(localizedUrl, 307);
    response.headers.set("Cache-Control", "private, no-store");
    response.headers.set("Vary", "Cookie");
    return response;
  }

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

    return withNoIndexHeader(NextResponse.next(), pathname);
  } 
  if (PUBLIC.includes(pathname)) return withNoIndexHeader(NextResponse.next(), pathname);

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
  res.headers.set("x-robots-tag", "noindex, nofollow");

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

function withNoIndexHeader(response: NextResponse, pathname: string): NextResponse {
  if (NOINDEX_PREFIXES.some((prefix) => pathname === prefix || pathname.startsWith(prefix))) {
    response.headers.set("x-robots-tag", "noindex, nofollow");
  }
  return response;
}
// export const config = { matcher: ["/admin/:path*"] };
