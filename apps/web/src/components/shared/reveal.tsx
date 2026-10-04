"use client";

import { motion } from "framer-motion";
import type { ReactNode } from "react";

type RevealVariant =
  | "up"
  | "down"
  | "left"
  | "right"
  | "scale"
  | "blur"
  | "soft";

const variants: Record<
  RevealVariant,
  {
    hidden: Record<string, number | string>;
    visible: Record<string, number | string>;
  }
> = {
  up: {
    hidden: { opacity: 0, y: 18 },
    visible: { opacity: 1, y: 0 },
  },
  down: {
    hidden: { opacity: 0, y: -18 },
    visible: { opacity: 1, y: 0 },
  },
  left: {
    hidden: { opacity: 0, x: -18 },
    visible: { opacity: 1, x: 0 },
  },
  right: {
    hidden: { opacity: 0, x: 18 },
    visible: { opacity: 1, x: 0 },
  },
  scale: {
    hidden: { opacity: 0, scale: 0.96 },
    visible: { opacity: 1, scale: 1 },
  },
  blur: {
    hidden: { opacity: 0, y: 8, filter: "blur(8px)" },
    visible: { opacity: 1, y: 0, filter: "blur(0px)" },
  },
  soft: {
    hidden: { opacity: 0 },
    visible: { opacity: 1 },
  },
};

export function Reveal({
  children,
  delay = 0,
  duration = 0.45,
  variant = "up",
  once = true,
  amount = 0.15,
  className,
}: {
  children: ReactNode;
  delay?: number;
  duration?: number;
  variant?: RevealVariant;
  once?: boolean;
  amount?: number;
  className?: string;
}) {
  const animation = variants[variant];

  return (
    <motion.div
      initial={animation.hidden}
      whileInView={animation.visible}
      viewport={{ once, amount }}
      transition={{
        duration,
        delay,
        ease: [0.22, 1, 0.36, 1],
      }}
      className={className}
    >
      {children}
    </motion.div>
  );
}
