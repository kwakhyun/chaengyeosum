import assert from "node:assert/strict";
import test from "node:test";

import {
  identityRateLimits,
  pickClientIp,
  RATE_LIMITS,
  rateLimitIpKey,
  resolveTrustProxy,
} from "./outing-rules.mjs";

test("IP 한도 키는 IPv6를 /64로 묶고 IPv4 매핑 주소를 IPv4로 본다", () => {
  assert.equal(rateLimitIpKey("2001:db8:1:2::1"), "2001:db8:1:2::/64");
  assert.equal(
    rateLimitIpKey("2001:DB8:0001:0002:ffff:ffff:ffff:ffff"),
    "2001:db8:1:2::/64",
  );
  assert.equal(rateLimitIpKey("[2001:db8:1:2::9]:443"), "2001:db8:1:2::/64");
  assert.equal(rateLimitIpKey("2001:db8::"), "2001:db8:0:0::/64");
  assert.equal(rateLimitIpKey("fe80::1%eth0"), "fe80:0:0:0::/64");
  assert.equal(rateLimitIpKey("1:2:3:4:5:6:1.2.3.4"), "1:2:3:4::/64");
  assert.equal(rateLimitIpKey("::ffff:192.0.2.1"), "192.0.2.1");
  assert.equal(rateLimitIpKey("::FFFF:c000:0201"), "192.0.2.1");
  assert.equal(rateLimitIpKey(" 192.0.2.1 "), "192.0.2.1");
  assert.equal(rateLimitIpKey("192.0.2.1:5555"), "192.0.2.1");
  // 알 수 없는 형식은 그대로 써요.
  assert.equal(rateLimitIpKey("1::2::3"), "1::2::3");
  assert.equal(rateLimitIpKey("Unknown"), "unknown");
  assert.equal(rateLimitIpKey(""), "");
  assert.equal(rateLimitIpKey(undefined), "");
});

test("같은 /64의 IPv6 주소는 한 IP 버킷을 함께 쓴다", async () => {
  const config = RATE_LIMITS.createOuting;
  const ipBucket = async (ip) =>
    (await identityRateLimits(config, { ip, userKey: "key" }))[0].bucket;

  const first = await ipBucket("2001:db8:1:2::1");
  assert.equal(await ipBucket("2001:db8:1:2::2"), first);
  assert.equal(await ipBucket("2001:db8:1:2:abcd:ef01:2345:6789"), first);
  assert.notEqual(await ipBucket("2001:db8:1:3::1"), first);

  // IPv4 매핑 주소는 IPv4와 같은 버킷이고, IPv4는 주소마다 따로예요.
  const v4 = await ipBucket("192.0.2.1");
  assert.equal(await ipBucket("::ffff:192.0.2.1"), v4);
  assert.notEqual(await ipBucket("192.0.2.2"), v4);

  const entries = await identityRateLimits(config, {
    ip: "2001:db8:1:2::1",
    userKey: "key",
  });
  assert.equal(entries.length, 2);
  assert.equal(entries[0].limit, config.ipLimit);
  assert.equal(entries[1].limit, config.limit);
});

test("TRUST_PROXY는 프록시 수 또는 cloudflare만 받는다", () => {
  assert.deepEqual(resolveTrustProxy(undefined), { mode: "off" });
  assert.deepEqual(resolveTrustProxy(""), { mode: "off" });
  assert.deepEqual(resolveTrustProxy("0"), { mode: "off" });
  assert.deepEqual(resolveTrustProxy("false"), { mode: "off" });
  assert.deepEqual(resolveTrustProxy(false), { mode: "off" });
  assert.deepEqual(resolveTrustProxy("1"), { mode: "hops", hops: 1 });
  assert.deepEqual(resolveTrustProxy("TRUE"), { mode: "hops", hops: 1 });
  assert.deepEqual(resolveTrustProxy(true), { mode: "hops", hops: 1 });
  assert.deepEqual(resolveTrustProxy("2"), { mode: "hops", hops: 2 });
  assert.deepEqual(resolveTrustProxy(" Cloudflare "), { mode: "cloudflare" });
  assert.equal(resolveTrustProxy("yes"), null);
  assert.equal(resolveTrustProxy("11"), null);
});

test("믿는 프록시가 덧붙인 X-Forwarded-For 오른쪽 값을 클라이언트 IP로 쓴다", () => {
  const pick = (trustProxy, forwardedFor, cfConnectingIp = "203.0.113.50") =>
    pickClientIp({
      trustProxy,
      forwardedFor,
      cfConnectingIp,
      remoteAddress: "10.0.0.1",
    });

  // 꺼져 있으면 소켓 주소예요.
  assert.equal(pick(false, "198.51.100.7"), "10.0.0.1");
  // 프록시 1대: 클라이언트가 보낸 왼쪽 값은 무시하고 가장 오른쪽 값을 써요.
  assert.equal(pick(true, "10.9.0.1, 198.51.100.7"), "198.51.100.7");
  assert.equal(pick("1", "198.51.100.7"), "198.51.100.7");
  // 프록시 2대: 오른쪽에서 두 번째 값이에요.
  assert.equal(
    pick("2", "10.9.0.1, 198.51.100.7, 172.16.0.5"),
    "198.51.100.7",
  );
  // 항목이 프록시 수보다 적으면 가장 왼쪽(가장 먼) 값이에요.
  assert.equal(pick("3", "198.51.100.7, 172.16.0.5"), "198.51.100.7");
  // 헤더가 없거나 비어 있으면 소켓 주소예요.
  assert.equal(pick(true, undefined), "10.0.0.1");
  assert.equal(pick(true, " , "), "10.0.0.1");
  // CF-Connecting-IP는 cloudflare 모드에서만 읽어요.
  assert.equal(pick(true, "198.51.100.7", "203.0.113.9"), "198.51.100.7");
  assert.equal(
    pick("cloudflare", "10.9.0.1, 198.51.100.7", "203.0.113.9"),
    "203.0.113.9",
  );
  assert.equal(pick("cloudflare", "198.51.100.7", ""), "10.0.0.1");
});
