export type Channel = {
  id: string;
  name: string;
  logo?: string;
  group?: string;
  url: string;
  clearKeys?: Record<string, string>; // kid (hex) -> key (hex)
  userAgent?: string;
  referer?: string;
  origin?: string;
};

function hexToBase64Url(hex: string): string {
  const clean = hex.replace(/[^0-9a-fA-F]/g, "");
  const bytes = new Uint8Array(clean.length / 2);
  for (let i = 0; i < bytes.length; i++) {
    bytes[i] = parseInt(clean.substr(i * 2, 2), 16);
  }
  let bin = "";
  bytes.forEach((b) => (bin += String.fromCharCode(b)));
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function b64ToB64Url(b64: string): string {
  return b64.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export function parseM3U(text: string): Channel[] {
  const lines = text.split(/\r?\n/);
  const channels: Channel[] = [];
  let current: Partial<Channel> | null = null;
  let idx = 0;

  for (const raw of lines) {
    const line = raw.trim();
    if (!line) continue;
    if (line.startsWith("#EXTINF")) {
      const info = line.substring(line.indexOf(":") + 1);
      const commaIdx = info.lastIndexOf(",");
      const attrs = commaIdx >= 0 ? info.substring(0, commaIdx) : info;
      const name = commaIdx >= 0 ? info.substring(commaIdx + 1).trim() : "Unknown";
      const logo = /tvg-logo="([^"]+)"/i.exec(attrs)?.[1];
      const group = /group-title="([^"]+)"/i.exec(attrs)?.[1];
      current = { name, logo, group };
    } else if (line.startsWith("#KODIPROP")) {
      if (!current) current = { name: "Channel" };
      const kv = line.substring(line.indexOf(":") + 1);
      const eqIdx = kv.indexOf("=");
      const key = kv.substring(0, eqIdx).trim();
      const value = kv.substring(eqIdx + 1).trim();
      if (key === "inputstream.adaptive.license_key") {
        const keys: Record<string, string> = {};
        if (value.startsWith("{")) {
          // JSON format
          try {
            const parsed = JSON.parse(value);
            if (parsed.keys) {
              for (const k of parsed.keys) {
                keys[k.kid] = k.k; // already base64url-ish
              }
            }
          } catch {}
        } else if (value.includes(":")) {
          // hex kid:key format
          const [kidHex, keyHex] = value.split(":");
          keys[hexToBase64Url(kidHex)] = hexToBase64Url(keyHex);
        }
        current.clearKeys = keys;
      }
    } else if (line.startsWith("#EXTVLCOPT")) {
      if (!current) current = { name: "Channel" };
      const kv = line.substring(line.indexOf(":") + 1);
      const [k, ...rest] = kv.split("=");
      const v = rest.join("=").trim();
      if (k === "http-user-agent") current.userAgent = v;
      else if (k === "http-referrer") current.referer = v;
      else if (k === "http-origin") current.origin = v;
    } else if (!line.startsWith("#")) {
      if (current) {
        channels.push({
          id: `ch-${idx++}`,
          name: current.name || "Channel",
          logo: current.logo,
          group: current.group,
          url: line,
          clearKeys: current.clearKeys,
          userAgent: current.userAgent,
          referer: current.referer,
          origin: current.origin,
        });
        current = null;
      }
    }
  }
  return channels;
}

// Normalize a parsed key (could be hex or base64url) to base64url
export function normalizeKeyToB64Url(value: string): string {
  if (/^[0-9a-fA-F]+$/.test(value) && value.length % 2 === 0) {
    return hexToBase64Url(value);
  }
  // Already base64 / base64url
  return b64ToB64Url(value);
}
