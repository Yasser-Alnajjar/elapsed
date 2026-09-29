#!/usr/bin/env python3
"""H-4 live-tenant comparison, step 2 (offline, read-only).

Reads the JSON written by packages/db/src/scripts/h4-live-export.ts (Elapsed
state + Zendesk's own SLA view for a ticket sample) and compares them per
commitment. Runs anywhere; needs no database or network.

  python3 compare-live.py export.json [--out report.md] [--label tenant-A]

Output: an aggregate summary and one row per ticket/commitment (ticket ids
only; no ticket content). Exit code 1 when any row is UNEXPLAINED, so an
unexplained disagreement is never a silent pass.

Row classes
  MATCH       Zendesk and Elapsed agree on every compared field.
  SEMANTIC    They differ by a rule that is decided and documented
              (D5 reply-less close, D5b agent-submitted First Response,
              native/overridden Pending pause). Numbers reconcile exactly.
  DATA        They differ because Zendesk applied a policy Elapsed never held
              (deleted/edited since) or applied none.
  UNEXPLAINED Anything else. Each one must become a correctness task before N1.
  SKIPPED     Not comparable (no data on one side); counted, not hidden.

What is compared (and what this tool cannot see)
  * applies / does not apply (Zendesk apply_sla vs an Elapsed commitment)
  * target, and calendar kind (business hours vs 24/7)
  * finished: outcome (breach event vs breached), breach instant
  * open: due time (Zendesk breach_at vs Elapsed dueAt), which is where
    business-hours / holiday / DST arithmetic is exercised
  * 24/7 finished: elapsed seconds, with the Pending pause explained only when
    the Elapsed policy really pauses on pending_customer
  * transient breach: a stored breach that later became met (ingest lag)
"""
import json, sys, collections
from datetime import datetime, timezone, timedelta

TOL = 2  # seconds


def P(s):
    if s is None:
        return None
    if isinstance(s, datetime):
        return s
    s = str(s).replace("Z", "+00:00").replace(" ", "T")
    d = datetime.fromisoformat(s)
    return d if d.tzinfo else d.replace(tzinfo=timezone.utc)


def zd_events(t):
    """Normalise Zendesk metric events to {metric: [event,...]}."""
    ev = t.get("events") or {}
    if isinstance(ev, dict) and "metric_events" in ev:
        ev = ev["metric_events"]
    if isinstance(ev, list):
        out = collections.defaultdict(list)
        for e in ev:
            out[e.get("metric")].append(e)
        return out
    return collections.defaultdict(list, ev if isinstance(ev, dict) else {})


def by_type(events, typ, instance=None):
    r = [e for e in events if e.get("type") == typ]
    if instance is not None:
        r = [e for e in r if e.get("instance_id") in (instance, None)]
    return sorted(r, key=lambda e: e["time"])


def policy_metric(t, metric):
    slas = t.get("slas") or {}
    for m in slas.get("policy_metrics", []) if isinstance(slas, dict) else []:
        if m.get("metric") == metric:
            return m
    return None


def main():
    args = sys.argv[1:]
    if not args:
        sys.exit(__doc__)
    path = args[0]
    out_path = args[args.index("--out") + 1] if "--out" in args else None
    label = args[args.index("--label") + 1] if "--label" in args else "tenant"
    d = json.load(open(path))
    zt = d["zendesk"]["tickets"]
    live_policy_ids = {p["id"] for p in (d["zendesk"].get("policies") or {}).get("sla_policies", [])}
    cm = collections.defaultdict(list)
    for c in d["elapsed"]["commitments"]:
        cm[c["ticket"]].append(c)
    ne = collections.defaultdict(list)
    for e in d["elapsed"]["events"]:
        ne[e["ticket"]].append(e)

    rows, summ = [], collections.Counter()

    def add(tid, kind, cls, notes, zdue=None, edue=None):
        rows.append((tid, kind, cls, "; ".join(notes), zdue, edue))
        summ[cls] += 1

    def compare(tid, kind, c, ev, instance, metric_name, t):
        ap = by_type(ev, "apply_sla", instance) if False else [e for e in ev if e.get("type") == "apply_sla"]
        # reply_time: instance 1 = First Response, >=2 = Next Reply, matched by start time
        if metric_name == "reply_time":
            ap = [e for e in ap if (e.get("instance_id") == instance)]
        if not ap:
            return None
        last = ap[-1]
        sla = last.get("sla") or {}
        pol = sla.get("policy") or {}
        tgt = sla.get("target_in_seconds")
        if tgt is None and sla.get("target") is not None:
            tgt = int(sla["target"]) * 60
        biz = bool(sla.get("business_hours"))
        notes, cls = [], "MATCH"
        etgt = c["targetMinutes"] * 60
        if pol.get("id") is not None and live_policy_ids and pol["id"] not in live_policy_ids:
            cls = "DATA"; notes.append(f"Zendesk applied a policy no longer in Zendesk ({pol.get('title')})")
        if tgt is not None and tgt != etgt:
            if cls != "DATA":
                cls = "UNEXPLAINED"
            notes.append(f"target ZD {tgt}s vs EL {etgt}s")
        if biz == bool(c["alwaysOpen"]):
            notes.append(f"calendar kind differs (ZD business_hours={biz}, EL alwaysOpen={c['alwaysOpen']})")
            cls = "UNEXPLAINED" if cls == "MATCH" else cls
        breach = by_type(ev, "breach", instance if metric_name == "reply_time" else None)
        ful = by_type(ev, "fulfill", instance if metric_name == "reply_time" else None)
        finished = c["closedAt"] is not None
        zdue = None
        if breach:
            zdue = P(breach[0]["time"])
        else:
            pm = policy_metric(t, metric_name)
            if pm and pm.get("breach_at"):
                zdue = P(pm["breach_at"])
        edue = P(c["dueAt"])
        if not finished:
            if zdue is None:
                summ["SKIPPED"] += 1
                rows.append((tid, kind, "SKIPPED", "open in Elapsed; no Zendesk breach_at", None, edue))
                return "done"
            delta = int((edue - zdue).total_seconds())
            if abs(delta) > TOL:
                cls = "UNEXPLAINED"; notes.append(f"open due differs by {delta:+d}s")
            add(tid, kind + " (open)", cls, notes, zdue, edue)
            return "done"
        # finished
        el_breached = c["status"] == "breached"
        zd_breached = bool(breach)
        if el_breached != zd_breached:
            if kind == "first_response" and not ful and not zd_breached and el_breached:
                cls = "SEMANTIC" if cls == "MATCH" else cls
                notes.append("D5: reply-less close is never 'met' in Elapsed; Zendesk counts the solve as fulfilled")
            else:
                cls = "UNEXPLAINED"; notes.append(f"outcome differs (ZD breach={zd_breached}, EL={c['status']})")
        if c.get("breachedAt") and c["status"] == "met":
            notes.append("transient breach: a breach was stored, then the commitment ended met (late ingest)")
            summ["transient_breach"] += 1
        if el_breached and zd_breached and c.get("breachedAt"):
            bd = int((P(c["breachedAt"]) - zdue).total_seconds())
            if abs(bd) > TOL:
                pend = "pending_customer" in (c.get("pauseOnStates") or [])
                if pend:
                    cls = "SEMANTIC" if cls == "MATCH" else cls
                    notes.append(f"breach time differs {bd:+d}s; Elapsed policy pauses on pending_customer")
                else:
                    cls = "UNEXPLAINED"; notes.append(f"breach time differs {bd:+d}s")
        if not biz and ful and metric_name == "resolution_time" and c.get("elapsedSeconds") is not None:
            created = P(t["ticket"]["created_at"])
            zel = int((P(ful[-1]["time"]) - created).total_seconds())
            diff = c["elapsedSeconds"] - zel
            if abs(diff) > TOL:
                if "pending_customer" in (c.get("pauseOnStates") or []) and diff < 0:
                    cls = "SEMANTIC" if cls == "MATCH" else cls
                    notes.append(f"elapsed {diff:+d}s; Elapsed policy pauses on pending_customer")
                else:
                    cls = "UNEXPLAINED"; notes.append(f"elapsed differs {diff:+d}s (ZD {zel}s)")
        add(tid, kind, cls, notes, zdue, edue)
        return "done"

    for tid, t in zt.items():
        ev = zd_events(t)
        cs = cm.get(str(tid), [])
        used = set()
        for i, c in enumerate(cs):
            k = c["kind"]
            if k == "resolution":
                r = compare(tid, k, c, ev.get("resolution_time", []), None, "resolution_time", t)
            elif k in ("first_response", "next_reply"):
                # match a Zendesk reply instance by apply_sla time closest to the Elapsed start
                cands = [e for e in ev.get("reply_time", []) if e.get("type") == "apply_sla"]
                best = min(cands, key=lambda e: abs((P(e["time"]) - P(c["startedAt"])).total_seconds()), default=None)
                if best is not None and abs((P(best["time"]) - P(c["startedAt"])).total_seconds()) <= 5:
                    r = compare(tid, k, c, ev.get("reply_time", []), best.get("instance_id"), "reply_time", t)
                    used.add(best.get("instance_id"))
                else:
                    add(tid, k, "SEMANTIC" if k == "first_response" else "UNEXPLAINED",
                        ["Zendesk has no reply SLA starting at this time"
                         + (" (D5b: agent-submitted ticket, Elapsed starts First Response at the first customer message)" if k == "first_response" else "")])
                    r = "done"
            else:
                continue
            if r is None:
                if k == "resolution":
                    add(tid, k, "DATA", ["Zendesk applied no resolution SLA; Elapsed applied the current policy"])
                    # a real Zendesk-side SLA gap is Data, not an engine error
        for inst in {e.get("instance_id") for e in ev.get("reply_time", []) if e.get("type") == "apply_sla"} - used:
            if inst == 1 and not any(c["kind"] == "first_response" for c in cs):
                # Zendesk applied a first-reply SLA that Elapsed never created (the H-11 shape)
                add(tid, "first_response", "UNEXPLAINED", ["Zendesk applied a first reply SLA; Elapsed has no first_response commitment"])
            elif inst is not None and inst != 1:
                add(tid, "next_reply", "UNEXPLAINED", [f"Zendesk tracked reply instance {inst}; Elapsed has no matching cycle"])

    lines = [f"# H-4 live comparison: {label}", "",
             f"Export: `{path}` · exported {d.get('exportedAt')} · sample {d['sample']}", "",
             "| Class | Rows |", "|---|---|"]
    for k in ("MATCH", "SEMANTIC", "DATA", "UNEXPLAINED", "SKIPPED"):
        lines.append(f"| {k} | {summ[k]} |")
    lines += ["", f"Transient breaches (breach stored, ended met): {summ['transient_breach']}", "",
              "| Ticket | Kind | Class | Zendesk due/breach | Elapsed due | Notes |", "|---|---|---|---|---|---|"]
    for tid, kind, cls, notes, zdue, edue in rows:
        if cls != "MATCH":
            lines.append(f"| {tid} | {kind} | {cls} | {zdue or ''} | {edue or ''} | {notes} |")
    lines.append(f"\n({summ['MATCH']} MATCH rows omitted from the table.)")
    text = "\n".join(lines)
    print(text)
    if out_path:
        open(out_path, "w").write(text)
    sys.exit(1 if summ["UNEXPLAINED"] else 0)


if __name__ == "__main__":
    main()
