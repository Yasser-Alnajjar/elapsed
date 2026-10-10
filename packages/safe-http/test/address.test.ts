import { describe, expect, it } from "vitest";
import { isPublicAddress } from "../src/address";

describe("isPublicAddress: IPv4 (plan 09 §8.1, §13 SSRF matrix)", () => {
  it.each([
    ["8.8.8.8"],
    ["1.1.1.1"],
    ["93.184.216.34"],
    ["172.15.255.255"], // just below 172.16/12
    ["172.32.0.0"], // just above 172.16/12
    ["100.63.255.255"], // just below CGNAT
    ["100.128.0.0"], // just above CGNAT
    ["223.255.255.255"], // last unicast before multicast
  ])("allows public %s", (address) => {
    expect(isPublicAddress(address)).toBe(true);
  });

  it.each([
    ["0.0.0.0"],
    ["0.255.255.255"],
    ["10.0.0.1"],
    ["10.255.255.255"],
    ["100.64.0.0"],
    ["100.127.255.255"],
    ["127.0.0.1"],
    ["127.255.255.254"],
    ["169.254.169.254"], // cloud metadata
    ["169.254.0.1"],
    ["172.16.0.1"],
    ["172.31.255.255"],
    ["192.0.0.1"],
    ["192.0.2.1"],
    ["192.168.0.1"],
    ["192.168.255.255"],
    ["198.18.0.1"],
    ["198.19.255.255"],
    ["198.51.100.7"],
    ["203.0.113.9"],
    ["224.0.0.1"],
    ["239.255.255.255"],
    ["240.0.0.1"],
    ["255.255.255.255"],
  ])("refuses non-public %s", (address) => {
    expect(isPublicAddress(address)).toBe(false);
  });
});

describe("isPublicAddress: IPv6 and mapped forms", () => {
  it.each([["2606:4700:4700::1111"], ["2001:4860:4860::8888"], ["2a00:1450:4001:81b::200e"]])("allows public %s", (address) => {
    expect(isPublicAddress(address)).toBe(true);
  });

  it.each([
    ["::"],
    ["::1"],
    ["0:0:0:0:0:0:0:1"],
    ["fe80::1"],
    ["fe80::1%eth0"],
    ["febf::1"], // still inside fe80::/10
    ["fc00::1"],
    ["fd12:3456:789a::1"],
    ["fd00:ec2::254"], // AWS IPv6 metadata
    ["ff02::1"],
    ["2001:db8::1"],
    ["2001:0:4136:e378:8000:63bf:3fff:fdd2"], // Teredo
    ["64:ff9b::7f00:1"], // NAT64 reaching 127.0.0.1
    ["64:ff9b::808:808"], // NAT64 is refused even toward a public IPv4
    ["::ffff:127.0.0.1"],
    ["::ffff:7f00:1"],
    ["::ffff:10.0.0.1"],
    ["::ffff:169.254.169.254"],
    ["::ffff:a9fe:a9fe"],
    ["2002:7f00:1::"], // 6to4 embedding 127.0.0.1
    ["2002:0a00:0001::"], // 6to4 embedding 10.0.0.1
  ])("refuses non-public %s", (address) => {
    expect(isPublicAddress(address)).toBe(false);
  });

  it("allows an IPv4-mapped form of a public address and a 6to4 of a public address", () => {
    expect(isPublicAddress("::ffff:8.8.8.8")).toBe(true);
    expect(isPublicAddress("2002:0808:0808::")).toBe(true);
  });

  it.each([[""], ["localhost"], ["example.com"], ["999.1.1.1"], ["1.2.3"], ["0x7f.0.0.1"], ["2130706433"], ["017700000001"], ["::g"], ["1:2:3:4:5:6:7:8:9"]])(
    "refuses a string that is not a canonical IP address: %j",
    (address) => {
      expect(isPublicAddress(address)).toBe(false);
    },
  );
});
