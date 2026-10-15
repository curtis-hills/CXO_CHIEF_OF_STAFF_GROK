import { NextResponse, type NextRequest } from "next/server";
import { safeEqual, sessionToken } from "./lib/auth-token";

export async function middleware(request: NextRequest) {
  const password = process.env.DASHBOARD_PASSWORD;
  if (!password) return NextResponse.next();

  const { pathname } = request.nextUrl;
  if (pathname === "/login" || pathname.startsWith("/api/auth")) return NextResponse.next();

  const cookie = request.cookies.get("cxm_session")?.value ?? "";
  const expected = await sessionToken(password);
  if (cookie && safeEqual(cookie, expected)) return NextResponse.next();

  const url = request.nextUrl.clone();
  url.pathname = "/login";
  url.search = "";
  if (pathname !== "/") url.searchParams.set("next", pathname);
  return NextResponse.redirect(url);
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|icon.svg).*)"],
};
