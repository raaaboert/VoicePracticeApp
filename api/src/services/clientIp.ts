import type { IncomingMessage } from "node:http";
import { BlockList, isIP } from "node:net";

function normalizeIp(value: string | undefined): string | null {
  if (!value || value.length > 64 || !isIP(value.trim())) return null;
  const ip = value.trim();
  if (ip.includes("%")) return null;
  if (isIP(ip) === 4) return ip;
  const canonical = new URL(`http://[${ip}]/`).hostname.slice(1, -1);
  // Give equivalent IPv4-mapped spellings a single rate-limit identity.
  const mapped = /^::ffff:([a-f0-9]+):([a-f0-9]+)$/.exec(canonical);
  if (mapped) {
    const high = parseInt(mapped[1], 16), low = parseInt(mapped[2], 16);
    return `${high >> 8}.${high & 255}.${low >> 8}.${low & 255}`;
  }
  return canonical;
}

/** Group only rate-limit identities; audit/session metadata keeps the client IP. */
export function getIpRateLimitKey(clientIp: string): string {
  const ip = normalizeIp(clientIp);
  if (!ip) return "unknown";
  if (isIP(ip) === 4) return ip;
  const [left, right] = ip.split("::");
  const head = left ? left.split(":") : [], tail = right ? right.split(":") : [];
  const words = ip.includes("::") ? [...head, ...Array<string>(8 - head.length - tail.length).fill("0"), ...tail] : head;
  return `${words.slice(0, 4).map(word => parseInt(word, 16).toString(16)).join(":")}::/64`;
}

/** Only explicitly verified immediate proxies may supply client addresses. */
export function createClientIpResolver(env: NodeJS.ProcessEnv, onUntrustedForwarded?: () => void) {
  const trusted = new BlockList();
  const entries = env.CLIENT_IP_TRUSTED_PROXY_CIDRS?.trim() || "";
  const header = env.CLIENT_IP_PROXY_HEADER?.trim() || "x-forwarded-for";
  if (!["x-forwarded-for", "cf-connecting-ip"].includes(header)) {
    throw new Error("CLIENT_IP_PROXY_HEADER must be x-forwarded-for or cf-connecting-ip.");
  }
  if (entries.length > 4096) throw new Error("CLIENT_IP_TRUSTED_PROXY_CIDRS is too long.");
  for (const entry of entries ? entries.split(",") : []) {
    const parts = entry.trim().split("/");
    const address = normalizeIp(parts[0]), family = address ? isIP(address) : 0;
    const maximum = family === 4 ? 32 : 128;
    const prefix = parts.length === 1 ? maximum : Number(parts[1]);
    if (!address || parts.length > 2 || (parts.length === 2 && (!/^\d+$/.test(parts[1])
      || (isIP(parts[0]) === 6 && family === 4)))
      || !Number.isInteger(prefix) || prefix < 1 || prefix > maximum) {
      throw new Error("CLIENT_IP_TRUSTED_PROXY_CIDRS must contain explicit IPs or nonzero CIDRs.");
    }
    trusted.addSubnet(address, prefix, family === 4 ? "ipv4" : "ipv6");
  }
  const isTrusted = (ip: string) => trusted.check(ip, isIP(ip) === 4 ? "ipv4" : "ipv6");

  return (request: Pick<IncomingMessage, "headers" | "socket">): string => {
    const peer = normalizeIp(request.socket.remoteAddress);
    if (!peer || !isTrusted(peer)) {
      if (request.headers["x-forwarded-for"] !== undefined || request.headers["cf-connecting-ip"] !== undefined) onUntrustedForwarded?.();
      return peer || "unknown";
    }
    const value = request.headers[header];
    if (typeof value !== "string" || value.length > 2048) return peer;
    if (header === "cf-connecting-ip") return normalizeIp(value) || peer;
    const chain = value.split(",");
    if (chain.length > 32) return peer;
    const addresses = chain.map(part => normalizeIp(part));
    if (addresses.some(ip => !ip)) return peer;
    // Walk from the socket towards the client; never trust the arbitrary leftmost entry.
    let current = peer;
    for (let i = addresses.length - 1; i >= 0 && isTrusted(current); i--) current = addresses[i]!;
    return current;
  };
}
