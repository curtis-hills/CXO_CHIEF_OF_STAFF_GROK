import { NextResponse } from "next/server";
import { safeEqual, safeNextPath, sessionToken } from "@/lib/auth-token";

export async function POST(request: Request) {
  const form = await request.formData();
  const intent = String(form.get("intent") ?? "login");

  if (intent === "logout") {
    const response = NextResponse.redirect(new URL("/login", request.url));
    response.cookies.set("cxm_session", "", { httpOnly: true, path: "/", maxAge: 0 });
    return response;
  }

  const expected = process.env.DASHBOARD_PASSWORD;
  if (!expected) {
    return NextResponse.redirect(new URL("/", request.url));
  }

  const password = String(form.get("password") ?? "");
  if (!safeEqual(password, expected)) {
    const back = new URL("/login", request.url);
    back.searchParams.set("error", "1");
    const next = safeNextPath(String(form.get("next") ?? ""));
    if (next !== "/") back.searchParams.set("next", next);
    return NextResponse.redirect(back);
  }

  const response = NextResponse.redirect(new URL(safeNextPath(String(form.get("next") ?? "/")), request.url));
  response.cookies.set("cxm_session", await sessionToken(expected), {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 60 * 60 * 24 * 12,
  });
  return response;
}
