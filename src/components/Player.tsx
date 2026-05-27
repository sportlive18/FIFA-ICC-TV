import { useEffect, useRef, useState } from "react";
import type { Channel } from "@/lib/m3u";
import { normalizeKeyToB64Url } from "@/lib/m3u";

function proxied(url: string, channel?: Channel) {
  const base =
    typeof window !== "undefined" ? window.location.origin : "";
  const params = new URLSearchParams({ url });
  if (base) params.set("proxyOrigin", base);
  if (channel?.userAgent) params.set("ua", channel.userAgent);
  if (channel?.referer) params.set("referer", channel.referer);
  if (channel?.origin) params.set("origin", channel.origin);
  return `${base}/api/proxy?${params.toString()}`;
}

export function Player({ channel }: { channel: Channel }) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [error, setError] = useState<string | null>(null);
  const playerRef = useRef<any>(null);
  const [tracks, setTracks] = useState<any[]>([]);
  const [selectedTrackId, setSelectedTrackId] = useState<number | "auto">("auto");

  useEffect(() => {
    const video = videoRef.current;
    if (!video || !channel) return;

    let player: any = null;
    let cancelled = false;
    setError(null);
    setTracks([]);
    setSelectedTrackId("auto");

    (async () => {
      const shaka = (await import("shaka-player/dist/shaka-player.compiled")).default;
      if (cancelled) return;

      shaka.polyfill.installAll();
      if (!shaka.Player.isBrowserSupported()) {
        setError("Browser not supported for streaming.");
        return;
      }

      player = new shaka.Player();
      playerRef.current = player;
      await player.attach(video);

      // Smooth playback tuning
      player.configure({
        streaming: {
          bufferingGoal: 5,
          rebufferingGoal: 1,
          bufferBehind: 10,
          stallEnabled: true,
          stallThreshold: 2,
          stallSkip: 0.1,
          jumpLargeGaps: true,
          smallGapLimit: 1.5,
          retryParameters: { maxAttempts: 8, baseDelay: 400, backoffFactor: 1.5, timeout: 30000 },
        },
        manifest: {
          retryParameters: { maxAttempts: 8, baseDelay: 400, backoffFactor: 1.5, timeout: 30000 },
        },
        abr: { enabled: true, defaultBandwidthEstimate: 2_000_000 },
      });

      // ClearKey config
      if (channel.clearKeys && Object.keys(channel.clearKeys).length > 0) {
        const clearKeys: Record<string, string> = {};
        for (const [kid, key] of Object.entries(channel.clearKeys)) {
          clearKeys[normalizeKeyToB64Url(kid)] = normalizeKeyToB64Url(key);
        }
        player.configure({
          drm: { clearKeys },
        });
      }

      // Route ALL network requests through our proxy to bypass CORS
      player
        .getNetworkingEngine()
        ?.registerRequestFilter((_type: any, request: any) => {
          const uris: string[] = request.uris || [];
          request.uris = uris.map((u) => {
            if (u.includes("/api/proxy?url=")) return u;
            // Only proxy http(s) URLs
            if (/^https?:\/\//i.test(u)) return proxied(u, channel);
            return u;
          });
        });

      player.addEventListener("error", (e: any) => {
        const detail = e?.detail;
        console.error("Shaka error", detail);
        setError(`Playback error (${detail?.code ?? "unknown"})`);
      });

      try {
        await player.load(proxied(channel.url, channel));
        if (!cancelled) video.play().catch(() => {});
        if (!cancelled) {
          const variants = player.getVariantTracks?.() ?? [];
          // Sort by height desc
          variants.sort((a: any, b: any) => (b.height ?? 0) - (a.height ?? 0));
          setTracks(variants);
        }
      } catch (e: any) {
        console.error("Load failed", e);
        if (!cancelled) setError(`Failed to load stream: ${e?.message || e}`);
      }
    })();

    return () => {
      cancelled = true;
      if (player) player.destroy().catch(() => {});
      playerRef.current = null;
    };
  }, [channel]);

  function onQualityChange(value: string) {
    const player = playerRef.current;
    if (!player) return;
    if (value === "auto") {
      player.configure({ abr: { enabled: true } });
      setSelectedTrackId("auto");
      return;
    }
    const id = Number(value);
    const track = tracks.find((t) => t.id === id);
    if (!track) return;
    player.configure({ abr: { enabled: false } });
    // clearBuffer=false avoids a full rebuffer/stall on quality switch;
    // safeMargin gives the new representation a moment to start.
    player.selectVariantTrack(track, /* clearBuffer */ false, /* safeMargin */ 2);
    setSelectedTrackId(id);
  }

  return (
    <div className="relative w-full h-full bg-black">
      <video
        ref={videoRef}
        controls
        playsInline
        autoPlay
        className="h-full w-full bg-black"
      />
      {tracks.length > 1 && (
        <div className="absolute top-3 right-3 z-10">
          <select
            value={String(selectedTrackId)}
            onChange={(e) => onQualityChange(e.target.value)}
            className="bg-black/70 text-white text-xs px-2 py-1 rounded border border-white/20 backdrop-blur-sm"
          >
            <option value="auto">Auto</option>
            {tracks.map((t) => {
              const label =
                t.height
                  ? `${t.height}p${t.frameRate ? ` ${Math.round(t.frameRate)}fps` : ""}`
                  : t.bandwidth
                    ? `${Math.round(t.bandwidth / 1000)} kbps`
                    : `Track ${t.id}`;
              return (
                <option key={t.id} value={t.id}>
                  {label}
                </option>
              );
            })}
          </select>
        </div>
      )}
      {error && (
        <div className="absolute inset-0 flex items-center justify-center bg-black/80 text-center p-4">
          <p className="text-sm text-destructive-foreground bg-destructive/80 px-4 py-2 rounded-lg">
            {error}
          </p>
        </div>
      )}
    </div>
  );
}
