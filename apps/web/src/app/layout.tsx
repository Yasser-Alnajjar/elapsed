import localFont from "next/font/local";
import type { ReactNode } from "react";
import "./globals.css";
import { ThemeProvider } from "@/providers/theme-provider";
import { TooltipProvider } from "@/components/ui/tooltip";
import { SessionProvider } from "@/providers/session-provider";
import { GoToTop } from "@/components/ui/go-to-top";
import { rootMetadata, rootViewport } from "@/lib/seo/metadata";

const hankenGrotesk = localFont({
  src: [
    {
      path: "../fonts/Hanken_Grotesk/HankenGrotesk-VariableFont_wght.woff2",
      weight: "100 900",
      style: "normal",
    },
    {
      path: "../fonts/Hanken_Grotesk/HankenGrotesk-Italic-VariableFont_wght.woff2",
      weight: "100 900",
      style: "italic",
    },
  ],
  variable: "--font-hanken-grotesk",
  display: "swap",
});

const jetbrainsMono = localFont({
  src: [
    {
      path: "../fonts/JetBrains_Mono/JetBrainsMono-VariableFont_wght.woff2",
      weight: "100 800",
      style: "normal",
    },
    {
      path: "../fonts/JetBrains_Mono/JetBrainsMono-Italic-VariableFont_wght.woff2",
      weight: "100 800",
      style: "italic",
    },
  ],
  variable: "--font-jetbrains-mono",
  display: "swap",
});

// A function, not a constant: the public origin (NEXTAUTH_URL) must be read per
// request. See `lib/seo/metadata.ts` for what is, and deliberately is not, set here.
export const generateMetadata = () => rootMetadata();

export const viewport = rootViewport;

export default async function RootLayout({
  children,
}: {
  children: ReactNode;
}) {
  return (
    <html
      lang="en"
      className={`${hankenGrotesk.variable} ${jetbrainsMono.variable}`}
      suppressHydrationWarning
      data-scroll-behavior="smooth"
    >
      <body suppressHydrationWarning>
        <SessionProvider>
          <ThemeProvider>
            <TooltipProvider delayDuration={200}>{children}</TooltipProvider>
            <GoToTop />
          </ThemeProvider>
        </SessionProvider>
      </body>
    </html>
  );
}
