import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

function hostname(hostHeader: string): string {
  const h = hostHeader.trim().toLowerCase();
  if (h.startsWith("[")) {
    const end = h.indexOf("]");
    return end > 0 ? h.slice(0, end + 1) : h;
  }
  return h.split(":")[0];
}

function hostAllowed(hostHeader: string | null): boolean {
  if (!hostHeader) return false;
  const name = hostname(hostHeader);
  if (name === "localhost" || name === "127.0.0.1" || name === "[::1]") return true;
  const extra = (process.env.SQLLENS_ALLOWED_HOSTS ?? "")
    .split(",")
    .map((x) => x.trim().toLowerCase())
    .filter(Boolean);
  return extra.includes(hostHeader.trim().toLowerCase()) || extra.includes(name);
}

// Optimistic checks only. Handler-level requireSession is the real enforcement.
export function proxy(request: NextRequest) {
  const { pathname, search } = request.nextUrl;

  if (pathname.startsWith("/api/")) {
    // Anti DNS-rebinding: only accept known Host values.
    if (!hostAllowed(request.headers.get("host"))) {
      return NextResponse.json({ error: "Host not allowed" }, { status: 403 });
    }
    const method = request.method.toUpperCase();
    if (method !== "GET" && method !== "HEAD" && method !== "OPTIONS") {
      const origin = request.headers.get("origin");
      const host = request.headers.get("host");
      let originHost: string | null = null;
      if (origin) {
        try {
          originHost = new URL(origin).host;
        } catch {
          originHost = null;
        }
      }
      if (!origin && request.headers.get("sec-fetch-site") === "cross-site") {
        return NextResponse.json({ error: "Cross-origin request blocked" }, { status: 403 });
      }
      if (origin && (originHost === null || originHost !== host)) {
        return NextResponse.json({ error: "Cross-origin request blocked" }, { status: 403 });
      }
    }
    return NextResponse.next();
  }

  if (pathname === "/login" || pathname.startsWith("/login/")) return NextResponse.next();
  if (!request.cookies.get("session_token")?.value) {
    const url = request.nextUrl.clone();
    url.pathname = "/login";
    url.search = "";
    url.searchParams.set("next", pathname + search);
    return NextResponse.redirect(url);
  }
  return NextResponse.next();
}

export const config = {
  matcher: [
    "/api/:path*",
    "/((?!api|_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico|css|js|map|txt|woff2?)$).*)",
  ],
};
