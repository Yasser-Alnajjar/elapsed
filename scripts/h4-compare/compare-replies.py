import json,collections
from datetime import datetime,timedelta
exec(open('cmp2.py').read().split("out=[];summ")[0])
rows=["| # | Kind | ZD (instance, target, start→fulfil) | EL (target, start, elapsed, status) | Result | Explanation |","|---|---|---|---|---|---|"]
summ=collections.Counter()
for tid,t in d['tickets'].items():
    zi={}
    for e in ev(t,'reply_time','apply_sla'): zi.setdefault(e['instance_id'],{})['apply']=e
    for e in ev(t,'reply_time','fulfill'): zi.setdefault(e['instance_id'],{})['ful']=e
    for e in ev(t,'reply_time','breach'): zi.setdefault(e['instance_id'],{})['br']=e
    ec=[c for c in el.get(tid,[]) if c['kind'] in('first_response','next_reply')]
    used=set()
    # ZD applied instances
    for inst,z in sorted(zi.items()):
        if 'apply' not in z: continue
        a=z['apply']; st=P(a['time']); tg=a['sla']['target_in_seconds']; fu=P(z['ful']['time']) if 'ful' in z else None
        zel=int((fu-st).total_seconds()) if fu else None
        kind='first_response' if inst==1 else 'next_reply'
        m=[c for c in ec if c['kind']==kind and abs((c['start']-st).total_seconds())<=2 and id(c) not in used]
        zs=f"inst {inst}, {tg}s, {st:%m-%d %H:%M:%S}→{fu:%H:%M:%S}" if fu else f"inst {inst}, {tg}s, {st:%H:%M:%S}→open"
        if not m:
            near=[c for c in ec if c['kind']==kind and id(c) not in used]
            rows.append(f"| {tid} | {kind} | {zs} | none | ❌ MISSING in Elapsed | Zendesk tracked this reply SLA; Elapsed created no {kind} commitment near {st:%H:%M:%S} |"); summ[f'{kind}: missing in EL']+=1; continue
        c=m[0]; used.add(id(c))
        notes=[];res='✅ MATCH'
        if a['sla']['policy']['id']!=CUR: res='⚠️ DATA'; notes.append('deleted Zendesk policy applied')
        if tg!=c['target']*60 and res=='✅ MATCH': res='⚠️ DATA'; notes.append(f"target ZD {tg}s vs EL {c['target']*60}s (Zendesk policy edited after ticket; Elapsed uses current version)")
        if zel is not None and abs(c['elapsed']-zel)>2: res='❌ MISMATCH'; notes.append(f"elapsed EL {c['elapsed']} vs ZD {zel}")
        summ[f'{kind}: matched {res}']+=1
        rows.append(f"| {tid} | {kind} | {zs} | {c['target']*60}s, {c['start']:%H:%M:%S}, {c['elapsed']}s, {c['status']} | {res} | {'; '.join(notes)} |")
    for c in ec:
        if id(c) in used: continue
        # EL commitment with no ZD counterpart
        if c['kind']=='first_response':
            why="Zendesk fulfilled reply instance 1 at ticket creation (agent-submitted ticket → no first-reply SLA); Elapsed opened a first_response clock"
        else: why="no Zendesk reply-time instance applied at this time"
        rows.append(f"| {tid} | {c['kind']} | none | {c['target']*60}s, {c['start']:%m-%d %H:%M:%S}, {c['elapsed']}s, {c['status']} | ❌ EXTRA in Elapsed | {why} |"); summ[f"{c['kind']}: extra in EL ({c['status']})"]+=1
open('reply_table.md','w').write('\n'.join(rows)); print('\n'.join(rows)); print(dict(summ))
