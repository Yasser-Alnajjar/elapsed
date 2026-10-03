import { useState } from "react";

/**
 * Copies text and reports `copied` for a moment afterwards. A denied
 * clipboard (e.g. an insecure context) is ignored: every caller also shows
 * the text on screen, where it can be selected by hand.
 */
export function useCopyToClipboard() {
  const [copied, setCopied] = useState(false);

  const copy = async (text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // Nothing to do; see above.
    }
  };

  return { copied, copy };
}
