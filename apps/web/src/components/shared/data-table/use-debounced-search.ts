"use client";

import { useEffect, useRef, useState } from "react";

const SEARCH_DEBOUNCE_MS = 300;

/**
 * A search box's draft text, committed to the real state (the URL, a server
 * filter) only once typing settles. The box stays instant; the fetch waits.
 * `committed` is the value the rest of the app currently holds, so the draft
 * follows it when it changes from elsewhere (back button, reset).
 */
export function useDebouncedSearch(
  committed: string,
  commit: (value: string) => void,
  delay: number = SEARCH_DEBOUNCE_MS,
) {
  const [draft, setDraft] = useState(committed);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => setDraft(committed), [committed]);
  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    [],
  );

  const cancel = () => {
    if (timer.current) clearTimeout(timer.current);
  };

  return {
    draft,
    setDraft: (value: string) => {
      setDraft(value);
      cancel();
      timer.current = setTimeout(() => commit(value), delay);
    },
    /** Drops the pending commit and empties the box. */
    clear: () => {
      cancel();
      setDraft("");
    },
  };
}
