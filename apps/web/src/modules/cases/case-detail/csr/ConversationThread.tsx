"use client";

import { MessageSquare, UserRound } from "lucide-react";
import { Reveal } from "@/components/shared/reveal";
import { useStickToBottom } from "@/hooks/use-stick-to-bottom";
import { formatActor, formatDateTime } from "@/lib/format";
import type {
  CaseDetailData,
  ConversationMessageDetail,
} from "@/lib/types/cases";

function SystemMessageNote({
  message,
}: {
  message: ConversationMessageDetail;
}) {
  return (
    <li className="flex justify-center py-1">
      <div className="max-w-[85%] rounded-lg border border-dashed border-outline-variant bg-surface-container px-4 py-3">
        <div className="flex flex-wrap items-center justify-center gap-2 font-mono text-xxs font-semibold uppercase tracking-wider text-outline">
          <span className="rounded bg-surface-container-high px-1.5 py-0.5 text-on-surface-variant">
            Opened automatically
          </span>
          <span aria-hidden>·</span>
          <time className="tabular-nums">
            {formatDateTime(message.occurredAt)}
          </time>
        </div>
        <p className="mt-2 whitespace-pre-wrap wrap-break-word text-center text-sm leading-5 text-on-surface">
          {message.body}
        </p>
      </div>
    </li>
  );
}

function ConversationMessageBubble({
  message,
}: {
  message: ConversationMessageDetail;
}) {
  if (message.actor === "system")
    return <SystemMessageNote message={message} />;
  const isAgent = message.actor === "agent";
  const senderLabel = message.isRequester
    ? "Requester"
    : formatActor(message.actor);
  return (
    <li className={`flex ${isAgent ? "justify-end" : "justify-start"}`}>
      <article
        className={`max-w-[min(78%,54rem)] rounded-xl border p-4 shadow-sm ${isAgent ? "border-primary/20 bg-primary/5" : "border-surface-variant bg-surface-container"}`}
      >
        <div className="flex flex-wrap items-center gap-2">
          <div
            className={`flex size-7 items-center justify-center rounded-full border ${isAgent ? "border-primary/30 bg-primary/10 text-primary" : "border-outline-variant bg-surface-container-high text-outline"}`}
          >
            <UserRound className="size-3.5" />
          </div>
          <span className="text-sm font-semibold text-on-surface">
            {message.authorName ?? formatActor(message.actor)}
          </span>
          <span
            className={`rounded px-1.5 py-0.5 font-mono text-xxs font-semibold uppercase tracking-wider ${isAgent ? "bg-primary-container text-on-primary" : "bg-surface-container-highest text-on-surface-variant"}`}
          >
            {senderLabel}
          </span>
          <span className="text-outline-variant">·</span>
          <time className="font-mono text-xxs text-outline tabular-nums">
            {formatDateTime(message.occurredAt)}
          </time>
        </div>
        <p className="mt-3 whitespace-pre-wrap wrap-break-word text-sm leading-6 text-on-surface-variant">
          {message.body}
        </p>
      </article>
    </li>
  );
}

export function ConversationThread({ data }: { data: CaseDetailData }) {
  const lastMessage = data.conversation[data.conversation.length - 1];
  const { containerRef, onScroll } = useStickToBottom<HTMLOListElement>(
    lastMessage?.id ?? "",
  );
  return (
    <Reveal delay={0.1}>
      <section className="flex min-w-0 flex-col gap-4 rounded-xl bg-surface-container-low p-6 shadow-sm">
        <header className="flex flex-col justify-between gap-3 border-b border-surface-variant/50 pb-4 sm:flex-row sm:items-center">
          <div className="flex items-center gap-2">
            <MessageSquare className="size-5.5 text-primary" />
            <div>
              <span className="font-mono text-xxs font-semibold uppercase tracking-wider text-primary">
                Customer ↔ Support
              </span>
              <h2 className="mt-0.5 text-xl font-semibold tracking-tight text-on-surface">
                Conversation
              </h2>
            </div>
          </div>
          <span className="font-mono text-xxs text-outline">
            {data.conversation.length} Message
            {data.conversation.length !== 1 ? "s" : ""} Recorded
          </span>
        </header>
        {data.conversation.length === 0 ? (
          <div className="rounded-lg bg-surface-container px-4 py-8 text-center text-sm text-on-surface-variant">
            No customer or agent messages yet.
          </div>
        ) : (
          <ol
            ref={containerRef}
            onScroll={onScroll}
            className="max-h-168 space-y-4 overflow-y-auto pe-1"
          >
            {data.conversation.map((message) => (
              <ConversationMessageBubble key={message.id} message={message} />
            ))}
          </ol>
        )}
      </section>
    </Reveal>
  );
}
