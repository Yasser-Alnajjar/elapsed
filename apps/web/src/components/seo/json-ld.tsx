import { serializeJsonLd } from "@/lib/seo/structured-data";
import type { JsonLdDocument } from "@/lib/seo/structured-data";

/**
 * Renders structured data as a JSON-LD script tag in the server-rendered HTML.
 * Renders nothing when the builder returned `null` (no public origin).
 */
export function JsonLd({ data }: { data: JsonLdDocument | null }) {
  if (!data) return null;
  return (
    <script
      type="application/ld+json"
      dangerouslySetInnerHTML={{ __html: serializeJsonLd(data) }}
    />
  );
}
