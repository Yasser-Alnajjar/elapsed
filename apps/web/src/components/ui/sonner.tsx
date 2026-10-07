"use client";

import { useTheme } from "next-themes";
import { Toaster as Sonner, type ToasterProps } from "sonner";

/**
 * The app's single toaster, mounted once in the root layout. Colors come from
 * the theme tokens so it follows light/dark; Sonner reads `dir` from the
 * document, so it mirrors under RTL. Toasts are announced through Sonner's
 * live region and expose a close button.
 */
export function Toaster(props: ToasterProps) {
  const { resolvedTheme } = useTheme();
  return (
    <Sonner
      theme={resolvedTheme === "light" ? "light" : "dark"}
      position="bottom-right"
      closeButton
      className="toaster group"
      style={
        {
          "--normal-bg": "var(--popover)",
          "--normal-text": "var(--popover-foreground)",
          "--normal-border": "var(--border)",
          "--success-bg": "var(--popover)",
          "--success-text": "var(--popover-foreground)",
          "--success-border": "var(--success)",
          "--error-bg": "var(--popover)",
          "--error-text": "var(--popover-foreground)",
          "--error-border": "var(--error)",
          "--border-radius": "var(--radius-lg, 0.5rem)",
        } as React.CSSProperties
      }
      {...props}
    />
  );
}
