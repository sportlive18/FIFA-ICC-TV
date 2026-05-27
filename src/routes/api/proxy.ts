import { createFileRoute } from "@tanstack/react-router";

const ALLOWED_HOSTS = new Set([
  "raw.githubusercontent.com",
]);

const DEFAULT_USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120 Safari/537.36";

const CORS_HEADERS = {
  "access-control-allow-origin": "*",
  "access-control-allow-methods": "GET, HEAD, OPTIONS",
  "access-control-allow-headers": "Range, Content-Type, Accept, Origin, Referer",
  "access-control-expose-headers": "Content-Length, Content-Range, Accept-Ranges, Content-Type",
} as const;

function xmlEscape(value: string) {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function copyHeader(from: Headers, to: Headers, name: string) {
  const value = from.get(name);
  if (value) to.set(name, value);
}

function buildForwardedProxyUrl(routeUrl: URL, absoluteUrl: string) {
  const params = new URLSearchParams();
  const proxyOrigin = routeUrl.searchParams.get("proxyOrigin") || routeUrl.origin;
  params.set("proxyOrigin", proxyOrigin);
  for (const key of ["referer", "origin", "ua"]) {
    const value = routeUrl.searchParams.get(key);
    if (value) params.set(key, value);
  }
  const encodedUrl = encodeURIComponent(absoluteUrl)
    .replace(/%24/g, "$")
    .replace(/%25(?=0?\d+d\$)/g, "%");
  const suffix = params.toString();
  return `${proxyOrigin}/api/proxy?url=${encodedUrl}${suffix ? `&${suffix}` : ""}`;
}

async function handle(request: Request) {
  const url = new URL(request.url);
  const target = url.searchParams.get("url");
  if (!target) return new Response("Missing url", { status: 400, headers: CORS_HEADERS });

  let parsed: URL;
  try {
    const base = url.searchParams.get("base");
    parsed = base ? new URL(target, base) : new URL(target);
  } catch {
    return new Response("Invalid url", { status: 400, headers: CORS_HEADERS });
  }

  // Allow github raw + any .m3u8/.ts segment hosts (since playlists reference arbitrary CDNs)
  const isAllowed =
    ALLOWED_HOSTS.has(parsed.hostname) ||
    /\.(m3u8|ts|m3u|key|aac|mp4)(\?|$)/i.test(parsed.pathname + parsed.search) ||
    true; // permissive proxy for stream segments

  if (!isAllowed) return new Response("Host not allowed", { status: 403, headers: CORS_HEADERS });

  try {
    const upstreamHeaders: Record<string, string> = {
      "User-Agent": url.searchParams.get("ua") || DEFAULT_USER_AGENT,
      Referer: url.searchParams.get("referer") || parsed.origin,
    };
    const origin = url.searchParams.get("origin");
    const range = request.headers.get("range");
    if (origin) upstreamHeaders.Origin = origin;
    if (range) upstreamHeaders.Range = range;

    const upstream = await fetch(parsed.toString(), {
      method: request.method === "HEAD" ? "HEAD" : "GET",
      headers: upstreamHeaders,
      redirect: "follow",
    });

    const headers = new Headers();
    const ct = upstream.headers.get("content-type") || "application/octet-stream";
    headers.set("content-type", ct);
    Object.entries(CORS_HEADERS).forEach(([key, value]) => headers.set(key, value));
    headers.set("cache-control", "no-store");
    copyHeader(upstream.headers, headers, "accept-ranges");
    copyHeader(upstream.headers, headers, "content-length");
    copyHeader(upstream.headers, headers, "content-range");

    if (request.method === "HEAD") {
      return new Response(null, { status: upstream.status, headers });
    }

    const looksLikePlaylist =
      ct.includes("mpegurl") ||
      /\.m3u8(\?|$)/i.test(parsed.pathname) ||
      /\.m3u(\?|$)/i.test(parsed.pathname);

    const looksLikeDash = ct.includes("dash+xml") || /\.mpd(\?|$)/i.test(parsed.pathname);

    if (looksLikePlaylist) {
      const text = await upstream.text();
      const base = parsed;
      const rewritten = text
        .split(/\r?\n/)
        .map((line) => {
          const trimmed = line.trim();
          if (!trimmed || trimmed.startsWith("#")) {
            // Rewrite URI="..." in EXT-X-KEY / EXT-X-MAP
            return line.replace(/URI="([^"]+)"/g, (_m, u) => {
              const abs = new URL(u, base).toString();
              return `URI="${buildForwardedProxyUrl(url, abs)}"`;
            });
          }
          const abs = new URL(trimmed, base).toString();
          return buildForwardedProxyUrl(url, abs);
        })
        .join("\n");
      headers.set("content-type", "application/vnd.apple.mpegurl");
      return new Response(rewritten, { status: upstream.status, headers });
    }

    if (looksLikeDash) {
      const text = await upstream.text();
      const baseDir = new URL(".", parsed).toString();
      const rewriteDashUrl = (value: string) => {
        if (/^(data:|blob:)/i.test(value)) return value;
        return xmlEscape(buildForwardedProxyUrl(url, new URL(value, baseDir).toString()));
      };
      const rewritten = text
        .replace(/\b(media|initialization|sourceURL)="([^"]+)"/g, (match, attr: string, value: string) => {
          return `${attr}="${rewriteDashUrl(value)}"`;
        })
        .replace(/<PatchLocation\b([^>]*)>([^<]+)<\/PatchLocation>/g, (_match, attrs: string, value: string) => {
          return `<PatchLocation${attrs}>${rewriteDashUrl(value.replace(/&amp;/g, "&"))}</PatchLocation>`;
        });
      headers.set("content-type", "application/dash+xml");
      headers.delete("content-length");
      return new Response(rewritten, { status: upstream.status, headers });
    }

    return new Response(upstream.body, {
      status: upstream.status,
      headers,
    });
  } catch (e) {
    return new Response(`Proxy error: ${(e as Error).message}`, { status: 502, headers: CORS_HEADERS });
  }
}

export const Route = createFileRoute("/api/proxy")({
  server: {
    handlers: {
      GET: ({ request }) => handle(request),
      HEAD: ({ request }) => handle(request),
      OPTIONS: () =>
        new Response(null, {
          status: 204,
          headers: CORS_HEADERS,
        }),
    },
  },
});
