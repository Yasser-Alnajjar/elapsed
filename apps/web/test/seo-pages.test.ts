import { describe, expect, it } from "vitest";
import {
  getPageMetadata,
  noIndexMetadata,
  pageMetadata,
  rootMetadata,
  rootViewport,
} from "../src/lib/seo/metadata";
import { PUBLIC_PAGES } from "../src/lib/seo/pages";

const ORIGIN = "https://app.elapsedhq.io";

const fullTitle = (page: (typeof PUBLIC_PAGES)[number]) =>
  page.absoluteTitle ? page.title : `${page.title} | Elapsed`;

describe("public page registry", () => {
  it("gives every page a unique title and a unique description", () => {
    const titles = PUBLIC_PAGES.map(fullTitle);
    const descriptions = PUBLIC_PAGES.map((page) => page.description);
    expect(new Set(titles).size).toBe(titles.length);
    expect(new Set(descriptions).size).toBe(descriptions.length);
  });

  it("keeps titles and descriptions inside what a search result shows", () => {
    for (const page of PUBLIC_PAGES) {
      expect(fullTitle(page).length, page.path).toBeLessThanOrEqual(60);
      expect(page.description.length, page.path).toBeGreaterThanOrEqual(70);
      expect(page.description.length, page.path).toBeLessThanOrEqual(160);
    }
  });

  it("uses clean canonical paths: leading slash, no trailing slash, no query string", () => {
    const paths = PUBLIC_PAGES.map((page) => page.path);
    expect(new Set(paths).size).toBe(paths.length);
    for (const path of paths) {
      expect(path.startsWith("/"), path).toBe(true);
      expect(path === "/" || !path.endsWith("/"), path).toBe(true);
      expect(path, path).not.toMatch(/[?#]/);
      expect(path, path).toBe(path.toLowerCase());
    }
  });

  it("writes the pricing snippet from the plan constant, not by hand", () => {
    const pricing = PUBLIC_PAGES.find((page) => page.path === "/pricing");
    expect(pricing?.description).toContain("Starter at $49/month");
    expect(pricing?.description).toContain("Team at $149/month");
    expect(pricing?.description).toContain("Enterprise with custom pricing");
    expect(pricing?.description).toContain("14-day trial");
  });

  it("does not stuff keywords: no word repeats more than four times in a description", () => {
    for (const page of PUBLIC_PAGES) {
      const counts = new Map<string, number>();
      for (const word of page.description.toLowerCase().match(/[a-z]{5,}/g) ?? []) {
        counts.set(word, (counts.get(word) ?? 0) + 1);
      }
      for (const [word, count] of counts) {
        expect(count, `${page.path}: "${word}"`).toBeLessThanOrEqual(4);
      }
    }
  });
});

describe("pageMetadata", () => {
  const pricing = PUBLIC_PAGES.find((page) => page.path === "/pricing")!;

  it("sets canonical, Open Graph and Twitter/X from the one registry entry", () => {
    const metadata = pageMetadata(pricing, ORIGIN);

    expect(metadata.title).toBe("Pricing and plans");
    expect(metadata.description).toBe(pricing.description);
    expect(metadata.alternates?.canonical).toBe("/pricing");
    expect(metadata.openGraph).toMatchObject({
      type: "website",
      siteName: "Elapsed",
      locale: "en_US",
      url: "/pricing",
      title: "Pricing and plans | Elapsed",
      description: pricing.description,
    });
    expect(metadata.twitter).toMatchObject({
      card: "summary_large_image",
      title: "Pricing and plans | Elapsed",
      description: pricing.description,
      images: ["/og-image.png"],
    });
    expect(metadata.openGraph?.images).toEqual([
      expect.objectContaining({ url: "/og-image.png", width: 1200, height: 630 }),
    ]);
  });

  it("is English only: no hreflang alternates, no other locale", () => {
    for (const page of PUBLIC_PAGES) {
      const metadata = pageMetadata(page, ORIGIN);
      expect(metadata.alternates?.languages).toBeUndefined();
      expect((metadata.openGraph as { locale?: string }).locale).toBe("en_US");
      expect((metadata.openGraph as { alternateLocale?: unknown }).alternateLocale).toBeUndefined();
    }
  });

  it("uses an absolute title on the home page so the brand is not repeated", () => {
    const home = PUBLIC_PAGES.find((page) => page.path === "/")!;
    const metadata = pageMetadata(home, ORIGIN);
    expect(metadata.title).toEqual({ absolute: home.title });
    expect(metadata.openGraph?.title).toBe(home.title);
    expect(home.title).not.toMatch(/\| Elapsed$/);
  });

  it("emits no URL at all without a public origin", () => {
    const metadata = pageMetadata(pricing, null);
    expect(metadata).toEqual({ title: "Pricing and plans", description: pricing.description });
  });

  it("throws for a path with no registry entry", () => {
    expect(() => getPageMetadata("/nope" as never)).toThrow(/No SEO entry/);
  });
});

describe("rootMetadata", () => {
  it("sets metadataBase and the title template from the public origin", () => {
    const metadata = rootMetadata(ORIGIN);
    expect(metadata.metadataBase?.toString()).toBe(`${ORIGIN}/`);
    expect(metadata.title).toMatchObject({ template: "%s | Elapsed" });
    expect(metadata.robots).toBeUndefined();
  });

  it("sets nothing every child page would inherit by mistake", () => {
    // A root canonical points every page at one URL; a root description repeats on every page.
    const metadata = rootMetadata(ORIGIN);
    expect(metadata.alternates).toBeUndefined();
    expect(metadata.description).toBeUndefined();
    expect(metadata.openGraph).toBeUndefined();
    expect(metadata.twitter).toBeUndefined();
  });

  it("marks the whole site noindex, with no metadataBase, when there is no public origin", () => {
    const metadata = rootMetadata(null);
    expect(metadata.robots).toEqual({ index: false, follow: false });
    expect(metadata.metadataBase).toBeUndefined();
  });

  it("configures the mobile viewport and a theme colour for both colour schemes", () => {
    expect(rootViewport.width).toBe("device-width");
    expect(rootViewport.initialScale).toBe(1);
    expect(rootViewport.themeColor).toHaveLength(2);
  });
});

describe("noIndexMetadata", () => {
  it("overrides any inherited robots value and carries no description or social card", () => {
    const metadata = noIndexMetadata("Sign in");
    expect(metadata).toEqual({ title: "Sign in", robots: { index: false, follow: false } });
  });

  it("works without a title for layouts whose pages set their own", () => {
    expect(noIndexMetadata()).toEqual({ robots: { index: false, follow: false } });
  });
});
