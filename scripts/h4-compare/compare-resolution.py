import json,collections
from datetime import datetime,timedelta
d=json.load(open('zd.json'))
CUR=51051535673617
def P(s):
    s=s.replace('Z','').replace(' ','T').split('.')[0]; return datetime.fromisoformat(s)
el=collections.defaultdict(list)
for l in open('el.psv'):
    f=l.rstrip('\n').split('|')
    el[f[0]].append(dict(prio=f[1],kind=f[4],cyc=f[5],start=P(f[6]),target=int(f[7]),due=P(f[8]),status=f[9],elapsed=int(f[11]),breachedAt=P(f[12]) if f[12] else None))
ne=collections.defaultdict(list)
for l in open('ne.psv'):
    f=l.rstrip('\n').split('|'); ne[f[0]].append((P(f[1]),f[2],f[3],f[4],f[5]))
def ev(t,m,ty): return [e for e in t['events'].get(m,[]) if e['type']==ty]
def paused(tid,start,end,states):
    # seconds within [start,end] spent in `states` per Elapsed's normalized state timeline
    cur=None; last=start; tot=0
    tl=[]
    for (ts,ty,fs,ts2,act) in ne[tid]:
        if ty=='case_created': tl.append((ts,ts2))
        elif ty=='state_changed' or ty=='case_closed': tl.append((ts,ts2))
    state=None; t0=start
    for ts,s in tl:
        if ts>end: break
        if ts>start and state in states: tot+=(min(ts,end)-max(t0,start)).total_seconds()
        if ts>start: t0=ts
        state=s
        if ts<=start: t0=start
    if state in states and end>t0: tot+=(end-t0).total_seconds()
    return int(tot)
out=[];summ=collections.Counter()
out.append("| # | Prio | ZD policy | ZD target | EL target | ZD due | EL due | ZD outcome | EL outcome | ZD elapsed (start→fulfil) | EL elapsed | Δ | Result | Explanation |")
out.append("|---|---|---|---|---|---|---|---|---|---|---|---|---|---|")
for tid,t in d['tickets'].items():
    r=[c for c in el.get(tid,[]) if c['kind']=='resolution']
    if not r: summ['no EL resolution']+=1; print('no EL resolution',tid); continue
    r=r[0]; ap=ev(t,'resolution_time','apply_sla')
    ful=ev(t,'resolution_time','fulfill'); br=ev(t,'resolution_time','breach')
    created=P(t['ticket']['created_at'])
    if not ap:
        out.append(f"| {tid} | {r['prio']} | *none applied* | – | {r['target']*60}s | – | {r['due']:%m-%d %H:%M:%S} | no SLA | {r['status']} | – | {r['elapsed']}s | – | ❌ MISMATCH | Zendesk applied no resolution SLA to this ticket (pre-dates/outside the imported policy version); Elapsed applied the current policy retroactively |")
        summ['mismatch: ZD no SLA']+=1; continue
    last=ap[-1]; pol=last['sla']['policy']; tgt=last['sla']['target_in_seconds']
    zdue=created+timedelta(seconds=tgt)
    zf=P(ful[-1]['time']) if ful else None
    zbreach=bool(br)
    zel=int((zf-created).total_seconds()) if zf else None
    pend=paused(tid,r['start'],zf,{'pending_customer'}); solv=paused(tid,r['start'],zf,{'resolved'})
    notes=[];res='✅ MATCH'
    if pol['id']!=CUR:
        res='⚠️ DATA'; notes.append(f"Zendesk applied deleted policy “{pol['title']}” ({tgt}s); Elapsed only holds the current policy (60m/…)")
        summ['data: deleted policy']+=1
    else:
        if tgt!=r['target']*60: res='❌ MISMATCH'; notes.append('target differs'); summ['mismatch: target']+=1
        elif (zdue-r['due']).total_seconds()!=0: res='❌ MISMATCH'; notes.append('due differs'); summ['mismatch: due']+=1
        else: summ['target/due match']+=1
        elbr=r['status']=='breached'
        if elbr!=zbreach: res='❌ MISMATCH'; notes.append(f"outcome differs (ZD breach={zbreach}, EL={r['status']})"); summ['mismatch: outcome']+=1
        else: summ['outcome match']+=1
        diff=r['elapsed']-zel
        if diff!=0:
            if pend and abs(diff+pend)<=2: 
                notes.append(f"Elapsed pauses Resolution on pending_customer ({pend}s); Zendesk does not"); 
                if res=='✅ MATCH': res='⚠️ SEMANTIC'
                summ['elapsed: pending pause diff']+=1
            elif abs(diff)<=2: summ['elapsed within 2s']+=1
            else:
                notes.append(f"elapsed differs by {diff}s (pending {pend}s, solved {solv}s) unexplained"); res='❌ MISMATCH'; summ['elapsed: unexplained']+=1
        else: summ['elapsed exact']+=1
        if r['breachedAt'] and zbreach:
            bz=P(br[0]['time']); 
            if bz!=r['breachedAt']:
                notes.append(f"breach time EL {r['breachedAt']:%H:%M:%S} vs ZD {bz:%H:%M:%S} (Δ{int((r['breachedAt']-bz).total_seconds())}s)")
                if res=='✅ MATCH': res='⚠️ SEMANTIC'
                summ['breach time differs']+=1
            else: summ['breach time exact']+=1
    out.append(f"| {tid} | {r['prio']} | {pol['title'][:22]} | {tgt}s | {r['target']*60}s | {zdue:%m-%d %H:%M:%S} | {r['due']:%m-%d %H:%M:%S} | {'breached' if zbreach else 'met'} | {r['status']} | {zel}s | {r['elapsed']}s | {r['elapsed']-zel:+d}s | {res} | {'; '.join(notes)} |")
open('resolution_table.md','w').write('\n'.join(out))
print('\n'.join(out)); print(dict(summ))
