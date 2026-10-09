"use client";

import { getIn } from "@/lib/custom-provider/wizard";
import { CheckField, MapEditor, SelectField, TextField } from "./fields";
import type { StepProps } from "./wizard-types";

const ROLES = [
  { value: "customer", label: "Customer" },
  { value: "agent", label: "Agent" },
  { value: "system", label: "System (ignored)" },
];

/** Step 4: SLA mode, replies and who creates a ticket. */
export function StepReplies({ config, set, userId }: StepProps) {
  const mode = String(config.slaMode ?? "resolution_only");
  const comments = getIn(config, ["comments"]) as Record<string, unknown> | undefined;
  const separate = Boolean(comments && getIn(comments, ["request"]));
  const cmap = (key: string) => {
    const v = getIn(config, ["commentMapping", key]);
    return typeof v === "string" ? v : "";
  };
  const creation = (getIn(config, ["creationActor", "type"]) as string | undefined) ?? "first_comment_author";
  const acknowledged = getIn(config, ["commentVisibilityAcknowledged"]) !== undefined && getIn(config, ["commentVisibilityAcknowledged"]) !== null;
  const hasVisibility = cmap("isPublic") !== "";

  return (
    <div className="flex flex-col gap-5">
      <SelectField
        id="cp-mode"
        label="What should Elapsed track?"
        value={mode}
        onChange={(v) => set(["slaMode"], v)}
        options={[
          { value: "resolution_only", label: "Resolution only" },
          { value: "full", label: "Full SLA: first response, next reply and resolution" },
        ]}
        hint="Resolution-only needs only tickets. First response and next reply need the replies on each ticket, and are shown as unsupported otherwise."
      />
      {mode === "full" && (
        <>
          <SelectField
            id="cp-comments-src"
            label="Where the replies are"
            value={separate ? "endpoint" : "embedded"}
            onChange={(v) =>
              set(["comments"], v === "endpoint" ? { request: { method: "GET", path: "/tickets/{{ticket.id}}/comments" }, itemsPath: "$.comments[*]", pagination: { type: "none" } } : { itemsPath: "$.comments[*]", pagination: { type: "none" } })
            }
            options={[
              { value: "embedded", label: "Inside each ticket" },
              { value: "endpoint", label: "A separate request per ticket" },
            ]}
            hint="A separate request per ticket makes large imports slower (many syncs)."
          />
          {comments && (
            <div className="grid gap-4 sm:grid-cols-2">
              {separate && (
                <TextField id="cp-c-path" label="Comments path" mono value={String(getIn(comments, ["request", "path"]) ?? "")} onChange={(v) => set(["comments", "request", "path"], v)} hint="Use {{ticket.id}} for the ticket." />
              )}
              <TextField id="cp-c-items" label="Where the comments are" mono value={String(comments.itemsPath ?? "")} onChange={(v) => set(["comments", "itemsPath"], v)} />
              {(["id", "createdAt", "authorRole", "isPublic", "body", "authorName"] as const).map((key) => (
                <TextField
                  key={key}
                  id={`cp-cm-${key}`}
                  label={{ id: "Comment ID", createdAt: "Comment time", authorRole: "Author role", isPublic: "Public / private field", body: "Message text (optional)", authorName: "Author name (optional)" }[key]}
                  mono
                  value={cmap(key)}
                  onChange={(v) => set(["commentMapping", key], v)}
                  hint={key === "body" ? "Leave blank to keep message text out of Elapsed; the conversation then shows replies without text." : undefined}
                />
              ))}
              <MapEditor idPrefix="cp-roles" label="Author roles" value={(getIn(config, ["valueMaps", "authorRole"]) ?? {}) as Record<string, string>} targets={ROLES} onChange={(next) => set(["valueMaps", "authorRole"], next)} />
              {hasVisibility && (
                <MapEditor
                  idPrefix="cp-visibility"
                  label="Visibility values (if not true/false)"
                  value={(getIn(config, ["valueMaps", "visibility"]) ?? {}) as Record<string, string>}
                  targets={[
                    { value: "public", label: "Public" },
                    { value: "private", label: "Private note (never a reply)" },
                  ]}
                  onChange={(next) => set(["valueMaps", "visibility"], Object.keys(next).length ? next : undefined)}
                />
              )}
              <div className="sm:col-span-2 flex flex-col gap-4">
                <SelectField
                  id="cp-creator"
                  label="Who creates a ticket?"
                  value={creation}
                  onChange={(v) => set(["creationActor"], v === "path" ? { type: "path", path: "$.requester.role" } : { type: v })}
                  options={[
                    { value: "first_comment_author", label: "The author of the first comment" },
                    { value: "assume_customer", label: "Customers create tickets (I confirm this)" },
                    { value: "path", label: "A field on the ticket" },
                  ]}
                  hint="This sets when the first-response clock starts and cannot be re-derived later, so it must be right."
                />
                {!hasVisibility && (
                  <CheckField
                    id="cp-ack"
                    label="Every comment my API returns is visible to the customer"
                    checked={acknowledged}
                    onChange={(v) => set(["commentVisibilityAcknowledged"], v ? { userId, at: new Date().toISOString() } : undefined)}
                    hint="Your API has no public/private field, so Elapsed would count internal notes as replies. Only confirm this if it cannot return internal notes. It is recorded with your name and the time."
                  />
                )}
              </div>
            </div>
          )}
        </>
      )}
      <p className="text-on-surface-variant text-xs">
        Status history, deletion signals and a ticket-detail endpoint are available in the Advanced JSON editor. Without status history Elapsed uses only each ticket&apos;s current status and never reconstructs history.
      </p>
    </div>
  );
}
