import assert from "node:assert/strict";
import type { IncomingMessage } from "node:http";
import { createRequire } from "node:module";
import test from "node:test";
import { createClientIpResolver, getIpRateLimitKey } from "./clientIp.js";

const request = (peer?: string, headers: IncomingMessage["headers"] = {}) =>
  ({ socket: { remoteAddress: peer }, headers }) as IncomingMessage;

test("IPv6 rate-limit keys group exactly a /64 and retain full client IPs for metadata", () => {
  const resolve = createClientIpResolver({ CLIENT_IP_TRUSTED_PROXY_CIDRS: "10.2.3.4", CLIENT_IP_PROXY_HEADER: "cf-connecting-ip" });
  const first = resolve(request("10.2.3.4", { "cf-connecting-ip": "2001:db8:1:abcd::1" }));
  const second = resolve(request("10.2.3.4", { "cf-connecting-ip": "2001:0DB8:1:ABCD:ffff:ffff:ffff:ffff" }));
  assert.equal(first, "2001:db8:1:abcd::1");
  assert.equal(second, "2001:db8:1:abcd:ffff:ffff:ffff:ffff");
  assert.equal(getIpRateLimitKey(first), "2001:db8:1:abcd::/64");
  assert.equal(getIpRateLimitKey(first), getIpRateLimitKey(second));
  for (const different of ["2001:db8:1:abce::1", "2001:db8:2:abcd::1", "2001:db9:1:abcd::1", "2002:db8:1:abcd::1"]) {
    assert.notEqual(getIpRateLimitKey(first), getIpRateLimitKey(different));
  }
});

test("compressed IPv6 prefixes expand correctly without creating a global bucket", () => {
  assert.equal(getIpRateLimitKey("::1"), "0:0:0:0::/64");
  assert.equal(getIpRateLimitKey("0:0:0:0:ffff:ffff:ffff:ffff"), "0:0:0:0::/64");
  assert.equal(getIpRateLimitKey("2001:db8::1"), "2001:db8:0:0::/64");
  assert.equal(getIpRateLimitKey("2001:db8:0:1::1"), "2001:db8:0:1::/64");
  assert.equal(getIpRateLimitKey("2001:db8:1::"), "2001:db8:1:0::/64");
  assert.equal(getIpRateLimitKey("invalid"), "unknown");
});

test("IPv4 and mapped IPv6 keep distinct full IPv4 rate-limit identities", () => {
  for (const ip of ["192.0.2.1", "192.0.2.2"]) {
    assert.equal(getIpRateLimitKey(ip), ip);
    assert.equal(getIpRateLimitKey(`::ffff:${ip}`), ip);
  }
  assert.equal(getIpRateLimitKey("::ffff:c000:201"), "192.0.2.1");
  assert.notEqual(getIpRateLimitKey("::ffff:192.0.2.1"), getIpRateLimitKey("::ffff:192.0.2.2"));
});

test("untrusted forwarded-header diagnostics carry no client or request data", () => {
  const warnings: unknown[][] = [];
  const resolve = createClientIpResolver({ CLIENT_IP_TRUSTED_PROXY_CIDRS: "10.2.3.4" }, (...args) => { warnings.push(args); });
  assert.equal(resolve(request("192.0.2.1", { "x-forwarded-for": "203.0.113.8" })), "192.0.2.1");
  assert.equal(resolve(request(undefined, { "cf-connecting-ip": "203.0.113.9" })), "unknown");
  resolve(request("192.0.2.1"));
  resolve(request("10.2.3.4", { "x-forwarded-for": "203.0.113.8" }));
  assert.deepEqual(warnings, [[], []]);
});

test("untrusted public, private and loopback peers cannot spoof any client-IP header", () => {
  const resolve = createClientIpResolver({});
  for (const peer of ["203.0.113.9", "10.2.3.4", "192.168.1.5", "127.0.0.1", "::1"]) {
    assert.equal(resolve(request(peer, { "x-forwarded-for": "198.51.100.1", "cf-connecting-ip": "198.51.100.2" })), peer);
  }
  assert.equal(resolve(request(undefined, { "x-forwarded-for": "198.51.100.1" })), "unknown");
});

test("explicit trusted proxies use the nearest untrusted hop, preserving separate clients", () => {
  const resolve = createClientIpResolver({ CLIENT_IP_TRUSTED_PROXY_CIDRS: "10.2.3.4/32,10.2.3.5/32" });
  for (const ip of ["198.51.100.1", "198.51.100.2"]) {
    assert.equal(resolve(request("10.2.3.4", { "x-forwarded-for": `203.0.113.8, ${ip}, 10.2.3.5` })), ip);
  }
  assert.equal(resolve(request("10.2.3.6", { "x-forwarded-for": "198.51.100.1" })), "10.2.3.6");
});

test("Render-style single-IP header requires an explicitly trusted immediate ingress", () => {
  const resolve = createClientIpResolver({ CLIENT_IP_TRUSTED_PROXY_CIDRS: "10.2.3.4/32", CLIENT_IP_PROXY_HEADER: "cf-connecting-ip" });
  for (const ip of ["198.51.100.1", "198.51.100.2"]) {
    assert.equal(resolve(request("10.2.3.4", { "cf-connecting-ip": ip, "x-forwarded-for": "203.0.113.8" })), ip);
  }
  assert.equal(resolve(request("10.2.3.5", { "cf-connecting-ip": "198.51.100.1" })), "10.2.3.5");
});

test("missing, malformed, duplicate and oversized trusted headers fall back to the socket", () => {
  for (const header of ["cf-connecting-ip", "x-forwarded-for"]) {
    const resolve = createClientIpResolver({ CLIENT_IP_TRUSTED_PROXY_CIDRS: "10.2.3.4", CLIENT_IP_PROXY_HEADER: header });
    for (const value of [undefined, "", "not-an-ip", "198.51.100.1:1234", "198.51.100.1, invalid", "fe80::1%eth0", ["198.51.100.1", "198.51.100.2"], "x".repeat(2049)]) {
      assert.equal(resolve(request("10.2.3.4", { [header]: value })), "10.2.3.4");
    }
  }
  const resolve = createClientIpResolver({ CLIENT_IP_TRUSTED_PROXY_CIDRS: "10.2.3.4" });
  assert.equal(resolve(request("10.2.3.4", { "x-forwarded-for": Array(33).fill("198.51.100.1").join(",") })), "10.2.3.4");
});

test("IPv6 and mapped addresses have canonical identities and correct trust boundaries", () => {
  const resolve = createClientIpResolver({ CLIENT_IP_TRUSTED_PROXY_CIDRS: "2001:db8:1::/64,10.2.3.4/32" });
  assert.equal(resolve(request("::ffff:10.2.3.4", { "x-forwarded-for": "::ffff:c000:0201" })), "192.0.2.1");
  assert.equal(resolve(request("2001:db8:1::2", { "x-forwarded-for": "2001:0DB8:0002::1" })), "2001:db8:2::1");
  assert.equal(resolve(request("2001:db8:2::2", { "x-forwarded-for": "198.51.100.1" })), "2001:db8:2::2");
  assert.equal(createClientIpResolver({})(request("::1")), "::1");
  assert.equal(createClientIpResolver({ CLIENT_IP_TRUSTED_PROXY_CIDRS: "::1/128" })(request("::1", { "x-forwarded-for": "198.51.100.1" })), "198.51.100.1");
});

test("invalid proxy configuration fails closed at startup", () => {
  for (const value of ["*", "loopback", "10.0.0.0/0", "10.0.0.0/33", "::/0", "::/129", "::ffff:192.168.0.0/112", "10.0.0.1/", "10.0.0.1,", "10.0.0.1/32/1"]) {
    assert.throws(() => createClientIpResolver({ CLIENT_IP_TRUSTED_PROXY_CIDRS: value }), /CLIENT_IP_TRUSTED_PROXY_CIDRS/);
  }
  assert.throws(() => createClientIpResolver({ CLIENT_IP_PROXY_HEADER: "x-real-ip" }), /CLIENT_IP_PROXY_HEADER/);
});

test("Express 4 resolves patched proxy-addr and IPv4-mapped trust does not leak to other IPv6 ranges", () => {
  const require = createRequire(import.meta.url), expressRequire = createRequire(require.resolve("express"));
  assert.equal(expressRequire("express/package.json").version, "4.22.3");
  assert.equal(expressRequire("proxy-addr/package.json").version, "2.0.8");
  const proxy = expressRequire("proxy-addr") as { compile: (ranges: string[]) => (ip: string) => boolean };
  const trust = proxy.compile(["::ffff:192.168.0.0/112"]);
  assert.equal(trust("::ffff:192.168.1.1"), true);
  assert.equal(trust("2001:db8::c0a8:101"), false);
});
