import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { ImageResponse } from "next/og";
import { SITE_NAME, SITE_TAGLINE } from "@/lib/seo/site";

// Generated once at build time: nothing here depends on the request or on
// NEXTAUTH_URL, so there is no origin to freeze.
export const dynamic = "force-static";

const WIDTH = 1200;
const HEIGHT = 630;

// The `--background`, `--primary` and muted-text values of the app's default
// (dark) theme, `styles/colors.css`.
const BACKGROUND = "#060a12";
const PRIMARY = "#0ea5e9";
const MUTED = "#94a3b8";

/** The 1200x630 card social networks show when a page is shared (Open Graph and Twitter/X). */
export async function GET() {
  // Literal paths relative to the app directory (`next build` and `next dev` both
  // run there): the bundler traces just these two files. A computed path makes it
  // trace the whole project, and `fetch(new URL(..., import.meta.url))` fails
  // because the Node runtime cannot fetch a `file:` URL.
  const [bold, logo] = await Promise.all([
    readFile(
      join(process.cwd(), "src/fonts/Hanken_Grotesk/static/HankenGrotesk-Bold.ttf"),
    ),
    readFile(join(process.cwd(), "public/icon-512.png")),
  ]);
  const logoSrc = `data:image/png;base64,${logo.toString("base64")}`;

  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          justifyContent: "space-between",
          background: BACKGROUND,
          padding: "72px 80px",
          fontFamily: "Hanken Grotesk",
          color: "#f8fafc",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 24 }}>
          {/* Rendered to a PNG by satori, never by the browser, so next/image does not apply. */}
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={logoSrc}
            width={88}
            height={88}
            alt=""
            style={{ borderRadius: 20 }}
          />
          <div style={{ fontSize: 44, fontWeight: 700, letterSpacing: -1 }}>
            {SITE_NAME}
          </div>
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: 28 }}>
          <div
            style={{
              width: 96,
              height: 8,
              background: PRIMARY,
              borderRadius: 4,
            }}
          />
          <div
            style={{
              fontSize: 88,
              fontWeight: 700,
              lineHeight: 1.05,
              letterSpacing: -2,
            }}
          >
            {SITE_TAGLINE}
          </div>
          <div style={{ fontSize: 34, color: MUTED }}>
            SLA monitoring across support and engineering
          </div>
        </div>
      </div>
    ),
    {
      width: WIDTH,
      height: HEIGHT,
      fonts: [
        { name: "Hanken Grotesk", data: bold, weight: 700, style: "normal" },
      ],
    },
  );
}
