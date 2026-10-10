"use client";

import { AlertCircle, Loader2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Actions } from "@/actions/client";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type { SlackChannel } from "@/lib/types/integrations";

export function SlackConnectButton() {
  return (
    <Button
      type="button"
      size="sm"
      onClick={() => (window.location.href = "/api/integrations/slack/connect")}
    >
      Connect Slack
    </Button>
  );
}

/** Shown once Slack is installed but no channel has been chosen yet (Phase 11 step 8). */
export function SlackChannelPicker() {
  const router = useRouter();
  const [channels, setChannels] = useState<SlackChannel[] | null>(null);
  const [selected, setSelected] = useState("");
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function loadChannels() {
    setLoading(true);
    setError(null);

    const {
      ok,
      channels,
      error: loadError,
    } = await Actions.Integrations.loadSlackChannels();
    setLoading(false);

    if (!ok || !channels) {
      setError(loadError ?? "Failed to load channels");
      return;
    }

    setChannels(channels);
  }

  async function handleSave() {
    const channel = channels?.find((c) => c.id === selected);
    if (!channel) return;

    setSaving(true);
    setError(null);

    const { ok, body } = await Actions.Integrations.saveSlackChannel(
      channel.id,
      channel.name,
    );
    setSaving(false);

    if (!ok) {
      setError(body.error ?? "Failed to save channel");
      return;
    }

    router.refresh();
  }

  if (channels === null) {
    return (
      <div className="space-y-3">
        <Button
          type="button"
          size="sm"
          variant="surface"
          onClick={loadChannels}
          disabled={loading}
        >
          {loading && <Loader2 className="animate-spin" />}
          {loading ? "Loading channels…" : "Choose a channel"}
        </Button>
        {error && (
          <Alert variant="destructive">
            <AlertCircle />
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        )}
      </div>
    );
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      <Select value={selected} onValueChange={setSelected}>
        <SelectTrigger className="w-44">
          <SelectValue placeholder="Select a channel" />
        </SelectTrigger>
        <SelectContent>
          {channels.map((channel) => (
            <SelectItem key={channel.id} value={channel.id}>
              #{channel.name}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      <Button
        type="button"
        size="sm"
        onClick={handleSave}
        disabled={!selected || saving}
      >
        {saving && <Loader2 className="animate-spin" />}
        {saving ? "Saving…" : "Save channel"}
      </Button>
      {error && (
        <Alert variant="destructive" className="w-full">
          <AlertCircle />
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}
    </div>
  );
}

export function SlackChannelChangeButton() {
  const [changing, setChanging] = useState(false);
  if (changing) return <SlackChannelPicker />;
  return (
    <Button
      type="button"
      size="sm"
      variant="surface"
      onClick={() => setChanging(true)}
    >
      Change channel
    </Button>
  );
}
