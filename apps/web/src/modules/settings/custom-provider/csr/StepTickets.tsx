"use client";

import { getIn, linesToRecord, recordToLines } from "@/lib/custom-provider/wizard";
import { CheckField, SelectField, TextAreaField, TextField } from "./fields";
import type { StepProps } from "./wizard-types";

/** Step 2: the ticket list request, pagination and incremental sync. */
export function StepTickets({ config, set }: StepProps) {
  const request = (getIn(config, ["tickets", "request"]) ?? {}) as Record<string, unknown>;
  const method = String(request.method ?? "GET");
  const pagination = (getIn(config, ["tickets", "pagination"]) ?? { type: "none" }) as Record<string, unknown>;
  const pType = String(pagination.type ?? "none");
  const incremental = getIn(config, ["tickets", "incremental"]) as Record<string, unknown> | undefined;
  const setPagination = (next: Record<string, unknown>) => set(["tickets", "pagination"], next);

  return (
    <div className="grid gap-4 sm:grid-cols-2">
      <SelectField
        id="cp-method"
        label="Method"
        value={method}
        onChange={(v) => set(["tickets", "request"], v === "POST" ? { ...request, method: v } : { method: v, path: request.path, query: request.query, headers: request.headers })}
        options={[
          { value: "GET", label: "GET" },
          { value: "POST", label: "POST (read-only search)" },
        ]}
      />
      <TextField id="cp-path" label="Path" mono value={String(request.path ?? "")} onChange={(v) => set(["tickets", "request", "path"], v)} placeholder="/v2/tickets" hint="Variables: {{updatedSince}}, {{cursor}}, {{page}}, {{offset}}, {{limit}}." />
      {method === "POST" && (
        <div className="sm:col-span-2 flex flex-col gap-3">
          <CheckField
            id="cp-readonly"
            label="This POST only searches. It does not create, change or delete anything."
            checked={request.readOnlySearch === true}
            onChange={(v) => set(["tickets", "request", "readOnlySearch"], v ? true : undefined)}
            hint="Elapsed only sends a POST to an endpoint you have confirmed is a read-only query."
          />
          <TextAreaField
            id="cp-body"
            label="JSON body"
            value={request.body === undefined ? "" : JSON.stringify(request.body, null, 2)}
            onChange={(v) => {
              try {
                set(["tickets", "request", "body"], v.trim() === "" ? undefined : JSON.parse(v));
              } catch {
                /* keep typing */
              }
            }}
          />
        </div>
      )}
      <TextAreaField
        id="cp-query"
        label="Query parameters (key=value per line)"
        rows={3}
        value={recordToLines(request.query)}
        onChange={(v) => set(["tickets", "request", "query"], Object.keys(linesToRecord(v)).length ? linesToRecord(v) : undefined)}
        hint="Credentials are not allowed here: authentication lives in headers."
      />
      <TextField id="cp-items" label="Where the tickets are in the response" mono value={String(getIn(config, ["tickets", "itemsPath"]) ?? "")} onChange={(v) => set(["tickets", "itemsPath"], v)} placeholder="$.data[*]" hint="A path such as $.data[*] or $.tickets." />

      <SelectField
        id="cp-pagination"
        label="Pagination"
        value={pType}
        onChange={(v) => {
          const defaults: Record<string, Record<string, unknown>> = {
            none: { type: "none" },
            page: { type: "page", param: "page", pageSize: 100, startAt: 1, in: "query" },
            offset: { type: "offset", offsetParam: "offset", limitParam: "limit", pageSize: 100, in: "query" },
            cursor: { type: "cursor", cursorPath: "$.meta.next_cursor", param: "cursor", in: "query" },
            next_url: { type: "next_url", nextPath: "$.links.next" },
            link_header: { type: "link_header" },
          };
          setPagination(defaults[v]!);
        }}
        options={[
          { value: "none", label: "None (one request)" },
          { value: "page", label: "Page number" },
          { value: "offset", label: "Offset and limit" },
          { value: "cursor", label: "Cursor" },
          { value: "next_url", label: "Next URL in the response" },
          { value: "link_header", label: "Link header" },
        ]}
        hint="Next-URL and Link-header targets must stay on the same address."
      />
      {pType === "page" && (
        <>
          <TextField id="cp-p-param" label="Page parameter" mono value={String(pagination.param ?? "")} onChange={(v) => setPagination({ ...pagination, param: v })} />
          <TextField id="cp-p-size" label="Page size" type="number" value={String(pagination.pageSize ?? "")} onChange={(v) => setPagination({ ...pagination, pageSize: Number(v) })} />
        </>
      )}
      {pType === "offset" && (
        <>
          <TextField id="cp-o-offset" label="Offset parameter" mono value={String(pagination.offsetParam ?? "")} onChange={(v) => setPagination({ ...pagination, offsetParam: v })} />
          <TextField id="cp-o-limit" label="Limit parameter" mono value={String(pagination.limitParam ?? "")} onChange={(v) => setPagination({ ...pagination, limitParam: v })} />
          <TextField id="cp-o-size" label="Page size" type="number" value={String(pagination.pageSize ?? "")} onChange={(v) => setPagination({ ...pagination, pageSize: Number(v) })} />
        </>
      )}
      {pType === "cursor" && (
        <>
          <TextField id="cp-c-path" label="Cursor in the response" mono value={String(pagination.cursorPath ?? "")} onChange={(v) => setPagination({ ...pagination, cursorPath: v })} />
          <TextField id="cp-c-param" label="Cursor parameter" mono value={String(pagination.param ?? "")} onChange={(v) => setPagination({ ...pagination, param: v })} />
        </>
      )}
      {pType === "next_url" && (
        <TextField id="cp-n-path" label="Next URL in the response" mono value={String(pagination.nextPath ?? "")} onChange={(v) => setPagination({ ...pagination, nextPath: v })} />
      )}

      <div className="sm:col-span-2 flex flex-col gap-3">
        <CheckField
          id="cp-incremental"
          label="My API can return only tickets changed since a time"
          checked={incremental !== undefined}
          onChange={(v) => set(["tickets", "incremental"], v ? { format: "iso8601", lookbackSeconds: 300 } : undefined)}
          hint="Strongly recommended. Put {{updatedSince}} in a query parameter above, for example updated_after={{updatedSince}}. Without it, the whole listing must fit in one sync or the connection is refused."
        />
        {incremental && (
          <div className="grid gap-4 sm:grid-cols-2">
            <SelectField
              id="cp-inc-format"
              label="Time format"
              value={String(incremental.format ?? "iso8601")}
              onChange={(v) => set(["tickets", "incremental", "format"], v)}
              options={[
                { value: "iso8601", label: "ISO 8601" },
                { value: "epoch_seconds", label: "Epoch seconds" },
                { value: "epoch_millis", label: "Epoch milliseconds" },
              ]}
            />
            <TextField id="cp-inc-look" label="Look-back (seconds)" type="number" value={String(incremental.lookbackSeconds ?? 0)} onChange={(v) => set(["tickets", "incremental", "lookbackSeconds"], Number(v))} hint="Re-reads a little before the last sync so a late-indexed update is not missed." />
          </div>
        )}
      </div>
      <TextField
        id="cp-window"
        label="First import: days of history"
        type="number"
        value={String(config.importWindowDays ?? 90)}
        onChange={(v) => set(["importWindowDays"], Number(v))}
        hint="1 to 365. Large histories import over several syncs."
      />
    </div>
  );
}
