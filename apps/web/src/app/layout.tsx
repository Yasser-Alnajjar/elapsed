import type { Metadata } from "next";
import { Inter } from "next/font/google";
import localFont from "next/font/local";
import type { ReactNode } from "react";
import "./globals.css";
import { ThemeProvider } from "@/providers/theme-provider";
import { TooltipProvider } from "@/components/ui/tooltip";
import { SessionProvider } from "@/providers/session-provider";
import { GoToTop } from "@/components/ui/go-to-top";
import { LiveDataProvider } from "@/components/shared/LiveDataProvider";

const hankenGrotesk = localFont({
  src: [
    {
      path: "../fonts/Hanken_Grotesk/HankenGrotesk-VariableFont_wght.ttf",
      weight: "100 900",
      style: "normal",
    },
    {
      path: "../fonts/Hanken_Grotesk/HankenGrotesk-Italic-VariableFont_wght.ttf",
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
      path: "../fonts/JetBrains_Mono/JetBrainsMono-VariableFont_wght.ttf",
      weight: "100 800",
      style: "normal",
    },
    {
      path: "../fonts/JetBrains_Mono/JetBrainsMono-Italic-VariableFont_wght.ttf",
      weight: "100 800",
      style: "italic",
    },
  ],
  variable: "--font-jetbrains-mono",
  display: "swap",
});

export const metadata: Metadata = {
  title: {
    template: `%s | Elapsed`,
    default: "Elapsed",
  },
  description: "Know before your customer does.",
};

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
    >
      <body suppressHydrationWarning>
        <SessionProvider>
          <ThemeProvider>
            <TooltipProvider delayDuration={200}>{children}</TooltipProvider>
            <GoToTop />
            <LiveDataProvider />
          </ThemeProvider>
        </SessionProvider>
      </body>
    </html>
  );
}
