import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { RELEASE_STAGE_LABELS, releaseStageSentence, type ReleaseStage } from "@/lib/release-stage";

/**
 * The one place an integration's lifecycle stage becomes a label. Settings,
 * onboarding, the Custom REST page and the documentation all render this, with
 * a stage that comes from the persisted availability policy (D33), so none of
 * them carries its own "Beta".
 *
 * Beta and Coming soon are always shown. Stable is shown only where
 * `showStable` is set (the documentation pages); on cards and selectors, where
 * most providers are Stable, no label is the existing convention.
 */
export function ReleaseStageBadge({ stage, showStable = false }: { stage: ReleaseStage; showStable?: boolean }) {
  if (stage === "beta") return <Badge variant="beta">{RELEASE_STAGE_LABELS.beta}</Badge>;
  if (stage === "coming_soon") return <Badge variant="outline">{RELEASE_STAGE_LABELS.coming_soon}</Badge>;
  return showStable ? <Badge variant="outline">{RELEASE_STAGE_LABELS.stable}</Badge> : null;
}

/**
 * The stage warning for the top of an integration's page, written to follow a
 * sentence. Renders nothing for Stable. `limitationsHref` links to the page's
 * "Known limitations" section.
 */
export function ReleaseStageNotice({ stage, limitationsHref }: { stage: ReleaseStage; limitationsHref?: string }) {
  const sentence = releaseStageSentence(stage);
  if (!sentence) return null;
  return (
    <>
      {" "}
      {sentence}
      {limitationsHref && stage === "beta" && (
        <>
          {" "}
          See{" "}
          <Link href={limitationsHref} className="underline underline-offset-4">
            Known limitations
          </Link>
          .
        </>
      )}
    </>
  );
}
