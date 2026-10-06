import type { IntegrationConnectionStatus } from "@/lib/types/data";
import type { Tone } from "@/lib/status-styles";

export const formatCount = (value: number) => value.toLocaleString("en-US");

export const CONNECTION_STATUS: Record<IntegrationConnectionStatus, { label: string; tone: Tone }> = {
  connected: { label: "Connected", tone: "success" },
  disconnected: { label: "Disconnected", tone: "neutral" },
  reauth_required: { label: "Needs reconnect", tone: "warning" },
  permission_denied: { label: "Access restricted", tone: "warning" },
};

export { DATA_COUNT_LINES } from "@/lib/types/data";
