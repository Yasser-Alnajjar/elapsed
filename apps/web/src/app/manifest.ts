import type { MetadataRoute } from "next";
import { SITE_DESCRIPTION, SITE_NAME } from "@/lib/seo/site";

/**
 * Web app manifest. Paths only, no absolute URLs, so it needs no origin.
 * `theme_color` / `background_color` are the dark `--background` token, the
 * app's default theme (`providers/theme-provider.tsx`).
 */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: SITE_NAME,
    short_name: SITE_NAME,
    description: SITE_DESCRIPTION,
    start_url: "/",
    scope: "/",
    display: "standalone",
    lang: "en",
    background_color: "#060a12",
    theme_color: "#060a12",
    icons: [
      { src: "/icon.png", sizes: "192x192", type: "image/png" },
      { src: "/icon-512.png", sizes: "512x512", type: "image/png" },
    ],
  };
}
