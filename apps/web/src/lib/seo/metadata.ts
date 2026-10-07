import type { Metadata, Viewport } from "next";
import type { PublicPage } from "@/lib/types/seo";
import { HOME_PAGE, PUBLIC_PAGES, SOCIAL_IMAGE_ALT } from "./pages";
import type { PublicPath } from "./pages";
import { getSiteOrigin, SITE_NAME } from "./site";

const NO_INDEX = { index: false, follow: false } as const;

const SOCIAL_IMAGE = {
  url: "/og-image.png",
  width: 1200,
  height: 630,
  alt: SOCIAL_IMAGE_ALT,
} as const;

/**
 * Site-wide defaults, set once on the root layout.
 *
 * Deliberately absent: `description`, `alternates.canonical`, `openGraph` and
 * `twitter`. Each of those is inherited by every route below the layout, so a
 * root canonical would point every page at the home page and a root
 * description would repeat on every docs page. Public pages set their own in
 * `pageMetadata`; private pages simply have none.
 *
 * Without a public origin (see `getSiteOrigin`) the whole site is marked
 * `noindex` and `metadataBase` is left unset, so no localhost or IP URL can
 * be resolved into a tag. Child pages inherit the `robots` value, and none of
 * the public pages sets its own.
 */
export function rootMetadata(origin: string | null = getSiteOrigin()): Metadata {
  return {
    applicationName: SITE_NAME,
    title: {
      default: HOME_PAGE.title,
      template: `%s | ${SITE_NAME}`,
    },
    ...(origin ? { metadataBase: new URL(origin) } : { robots: NO_INDEX }),
  };
}

/**
 * `<meta name="viewport">` and the browser UI colour, matching the app's
 * light and dark `--background` tokens (`styles/colors.css`).
 */
export const rootViewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#f8fafc" },
    { media: "(prefers-color-scheme: dark)", color: "#060a12" },
  ],
};

/**
 * Metadata for one public, indexable page: title, description, canonical URL,
 * Open Graph and Twitter/X cards. URLs are written as paths and resolved
 * against `metadataBase`; with no public origin only the title and
 * description are emitted (the root layout already marks the page `noindex`).
 */
export function pageMetadata(
  page: PublicPage,
  origin: string | null = getSiteOrigin(),
): Metadata {
  const fullTitle = page.absoluteTitle
    ? page.title
    : `${page.title} | ${SITE_NAME}`;

  const base: Metadata = {
    title: page.absoluteTitle ? { absolute: page.title } : page.title,
    description: page.description,
  };
  if (!origin) return base;

  return {
    ...base,
    alternates: { canonical: page.path },
    openGraph: {
      type: "website",
      siteName: SITE_NAME,
      locale: "en_US",
      url: page.path,
      title: fullTitle,
      description: page.description,
      images: [SOCIAL_IMAGE],
    },
    twitter: {
      card: "summary_large_image",
      title: fullTitle,
      description: page.description,
      images: [SOCIAL_IMAGE.url],
    },
  };
}

/**
 * What a page file exports: `export const generateMetadata = () => getPageMetadata("/pricing")`.
 * A function rather than a constant so the origin is read per request, not
 * frozen into the build.
 */
export function getPageMetadata(path: PublicPath): Metadata {
  const page = PUBLIC_PAGES.find((candidate) => candidate.path === path);
  if (!page) throw new Error(`No SEO entry for ${path} in lib/seo/pages.ts`);
  return pageMetadata(page);
}

/**
 * For pages and layouts that must stay out of the index. Setting `robots`
 * here overrides whatever an ancestor layout says, so it holds however the
 * route tree changes. Carries a title (the tab text) but no description,
 * canonical or social card: nothing about these pages is meant to be shown.
 */
export function noIndexMetadata(title?: string): Metadata {
  return { ...(title ? { title } : {}), robots: NO_INDEX };
}
