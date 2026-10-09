import { ConnectLinkError, getPrismaClient, resolveConnectLink, resolveIntegrationAvailability } from "@sla/db";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { INTEGRATION_PROVIDER_LABELS } from "@/lib/types/integrations";

/** Public page: no session, no navigation. The token in the URL is the only credential. */
export const ConnectLink = async ({ token }: { token: string }) => {
  let link;
  let failure: ConnectLinkError | null = null;
  try {
    link = await resolveConnectLink(getPrismaClient(), token);
  } catch (error) {
    if (!(error instanceof ConnectLinkError)) throw error;
    failure = error;
  }

  const providerLabel = link ? INTEGRATION_PROVIDER_LABELS[link.provider] : null;
  // D33: a provider the platform has made unavailable cannot be connected, even through a valid link (which stays unused).
  const availability = link ? await resolveIntegrationAvailability(getPrismaClient(), link.organizationId, link.provider) : null;

  return (
    <main className="mx-auto flex min-h-screen max-w-lg items-center px-4">
      <Card className="w-full">
        {link && availability && !availability.available ? (
          <CardHeader>
            <CardTitle>{providerLabel} can&apos;t be connected right now</CardTitle>
            <CardDescription>
              {availability.message}
              {availability.statusMessage ? ` ${availability.statusMessage}` : ""} This link has not been used and
              still works until {link.expiresAt.toUTCString()}.
            </CardDescription>
          </CardHeader>
        ) : link ? (
          <>
            <CardHeader>
              <CardTitle>Connect {providerLabel} to Elapsed</CardTitle>
              <CardDescription>
                {link.organizationName} asked for your help connecting {providerLabel}
                {link.intendedFor ? ` (this link was made for ${link.intendedFor})` : ""}.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4 text-sm text-muted-foreground">
              <p>
                You will sign in to {providerLabel} and approve <strong>read-only</strong> access. Elapsed never
                changes anything in {providerLabel}. You do not need an Elapsed account.
              </p>
              <p>
                This link works once and expires on {link.expiresAt.toUTCString()}. It can only connect {providerLabel} for{" "}
                {link.organizationName}.
              </p>
              <Button asChild>
                <a href={`/api/integrations/connect-links/${encodeURIComponent(token)}/start`}>
                  Continue to {providerLabel}
                </a>
              </Button>
            </CardContent>
          </>
        ) : (
          <>
            <CardHeader>
              <CardTitle>
                {failure?.reason === "consumed"
                  ? "This link has already been used"
                  : failure?.reason === "expired"
                    ? "This link has expired"
                    : "This link is not valid"}
              </CardTitle>
              <CardDescription>
                Ask the person who sent it to create a new connect link from Integrations in Elapsed.
              </CardDescription>
            </CardHeader>
          </>
        )}
      </Card>
    </main>
  );
}
