import { describe, expect, it } from "vitest";
import { buildNavItems, type NavItem, isNavItemActive, NAV_ITEMS, SETTINGS_NAV_ITEMS } from "../src/components/layout/nav-items";

describe("nav items", () => {
  it("Monitoring is no longer under Settings", () => {
    expect(SETTINGS_NAV_ITEMS.some((i) => i.href.includes("monitoring"))).toBe(false);
  });

  it("gives operators an Operator group containing Overview and Monitoring", () => {
    const operator = buildNavItems(true).find((i) => i.href === "/operator");
    expect(operator?.items?.map((i) => i.href)).toEqual(["/operator", "/operator/monitoring"]);
  });

  it("gives non-operators no Operator navigation at all", () => {
    const items = buildNavItems(false);
    expect(items).toBe(NAV_ITEMS);
    expect(JSON.stringify(items)).not.toContain("/operator");
  });

  it("activates only the matching operator child", () => {
    const [overview, monitoring] = buildNavItems(true).find((i) => i.href === "/operator")!.items! as [NavItem, NavItem];
    const path = "/operator/monitoring";
    expect(isNavItemActive(path, monitoring.href, monitoring.exact)).toBe(true);
    expect(isNavItemActive(path, overview.href, overview.exact)).toBe(false);
    expect(isNavItemActive("/operator", overview.href, overview.exact)).toBe(true);
    expect(isNavItemActive(path, "/settings")).toBe(false);
  });
});
