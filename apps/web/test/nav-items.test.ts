import { describe, expect, it } from "vitest";
import { ADMIN_NAV_ITEMS } from "../src/components/admin/admin-nav-items";
import { buildNavItems, type NavItem, isNavItemActive, NAV_ITEMS, SETTINGS_NAV_ITEMS } from "../src/components/layout/nav-items";

describe("nav items", () => {
  it("Monitoring is no longer under Settings", () => {
    expect(SETTINGS_NAV_ITEMS.some((i) => i.href.includes("monitoring"))).toBe(false);
  });

  it("gives operators one way into /admin, and no operator group", () => {
    const items = buildNavItems(true);
    const admin = items.find((i) => i.href === "/admin");
    expect(admin).toBeDefined();
    expect(admin?.items).toBeUndefined();
    expect(items.some((i) => i.href.startsWith("/operator"))).toBe(false);
  });

  it("gives non-operators no admin or operator navigation at all", () => {
    const items = buildNavItems(false);
    expect(items).toBe(NAV_ITEMS);
    expect(JSON.stringify(items)).not.toContain("/admin");
    expect(JSON.stringify(items)).not.toContain("/operator");
  });

  it("keeps worker and monitoring controls out of every tenant navigation list", () => {
    const everything = JSON.stringify([...NAV_ITEMS, ...SETTINGS_NAV_ITEMS]);
    expect(everything).not.toMatch(/monitoring|worker/i);
  });

  it("activates only the matching admin item (Overview is exact)", () => {
    const [overview, tenants, monitoring] = ADMIN_NAV_ITEMS as [NavItem, NavItem, NavItem];
    const path = "/admin/tenants/org_1";
    expect(isNavItemActive(path, tenants.href, tenants.exact)).toBe(true);
    expect(isNavItemActive(path, overview.href, overview.exact)).toBe(false);
    expect(isNavItemActive(path, monitoring.href, monitoring.exact)).toBe(false);
    expect(isNavItemActive("/admin", overview.href, overview.exact)).toBe(true);
    expect(isNavItemActive(path, "/settings")).toBe(false);
  });

  it("lists the four admin sections in order", () => {
    expect(ADMIN_NAV_ITEMS.map((i) => i.href)).toEqual(["/admin", "/admin/tenants", "/admin/monitoring", "/admin/audit"]);
  });
});
