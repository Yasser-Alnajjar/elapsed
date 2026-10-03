"use client";

import { useState, type FormEvent } from "react";
import { Actions } from "@/actions/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { BackfillButton } from "./BackfillButton";

/**
 * A GitHub App can be installed on many repositories and has no single
 * "workspace" the way a Jira site or Linear workspace does, so the org picks
 * one repo explicitly, entered here the same way Zendesk's subdomain is
 * entered before its OAuth redirect.
 */
export function GithubConnectForm() {
  const [repo, setRepo] = useState("");

  function handleSubmit(event: FormEvent) {
    event.preventDefault();
    window.location.href = `/api/integrations/github/connect?repo=${encodeURIComponent(repo)}`;
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-3">
      <div className="space-y-1.5">
        <Label htmlFor="github-repo">GitHub repository</Label>
        <Input
          id="github-repo"
          value={repo}
          onChange={(event) => setRepo(event.target.value)}
          placeholder="acme/widgets"
          pattern="[A-Za-z0-9](?:[A-Za-z0-9._-]*[A-Za-z0-9])?/[A-Za-z0-9._-]+"
          required
          className="max-w-56"
        />
      </div>
      <Button type="submit" size="sm">
        Connect GitHub
      </Button>
    </form>
  );
}

interface GithubBackfillButtonProps {
  /** Needed to send the user back through /connect without retyping it. */
  repo: string;
  initialReauthRequired?: boolean;
}

export function GithubBackfillButton({ repo, initialReauthRequired = false }: GithubBackfillButtonProps) {
  return (
    <BackfillButton
      provider="GitHub"
      reconnectHref={`/api/integrations/github/connect?repo=${encodeURIComponent(repo)}`}
      initialReauthRequired={initialReauthRequired}
      run={Actions.Integrations.runGithubBackfill}
      renderResult={({ backfill }) => (
        <p className="wrap-break-word">
          {backfill.pullRequestsFetched} pull requests · {backfill.timelineItemsFetched} timeline events.
        </p>
      )}
    />
  );
}
