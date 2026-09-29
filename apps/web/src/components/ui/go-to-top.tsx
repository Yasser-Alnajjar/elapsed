"use client";

import { useEffect, useState } from "react";
import { ArrowUp } from "lucide-react";
import { cn } from "@/lib/utils";
export const GoToTop = () => {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    const toggleVisibility = () => {
      setVisible(window.scrollY > 50);
    };

    window.addEventListener("scroll", toggleVisibility);
    return () => window.removeEventListener("scroll", toggleVisibility);
  }, []);

  const scrollToTop = () => {
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  return (
    <button
      onClick={scrollToTop}
      className={cn(
        "cursor-pointer animate-bounce fixed bottom-10 inset-e-8 z-40 flex size-10 items-center justify-center rounded-full bg-primary text-white shadow-lg transition-opacity duration-300 hover:bg-primary/80",
        visible ? "opacity-100" : "opacity-0 pointer-events-none",
      )}
      aria-label="Scroll to top"
    >
      <ArrowUp size={20} />
    </button>
  );
};
