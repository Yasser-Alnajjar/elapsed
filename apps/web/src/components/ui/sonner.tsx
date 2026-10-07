"use client";

import { useTheme } from "next-themes";
import { Toaster as Sonner, type ToasterProps } from "sonner";

/**
 * The single status → style mapping: each Sonner variant gets the matching
 * theme token as its border and a faint tint of it over the popover surface
 * (the same recipe `<Alert>` uses), so light/dark come from the tokens.
 */
function statusVars(variant: string, token: string) {
  return {
    [`--${variant}-bg`]: `color-mix(in srgb, var(${token}) 10%, var(--popover))`,
    [`--${variant}-text`]: "var(--popover-foreground)",
    [`--${variant}-border`]: `color-mix(in srgb, var(${token}) 40%, transparent)`,
  };
}

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
      // Without richColors Sonner ignores every --success/--error/... variable below and paints all toasts with --normal-*.
      richColors
      className="toaster group"
      style={
        {
          "--normal-bg": "var(--popover)",
          "--normal-text": "var(--popover-foreground)",
          "--normal-border": "var(--border)",
          ...statusVars("success", "--success"),
          ...statusVars("error", "--error"),
          ...statusVars("warning", "--warning"),
          ...statusVars("info", "--primary"),
          "--border-radius": "var(--radius-lg, 0.5rem)",
        } as React.CSSProperties
      }
      {...props}
    />
  );
}
