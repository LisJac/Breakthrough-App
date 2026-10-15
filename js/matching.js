/* Pure helpers for slots and matching — no storage, safe to reuse on a server.
 * A slot is the UTC ISO string of a one-hour block start, e.g. "2026-10-14T17:00:00.000Z".
 * Storing UTC means people in London and Berlin match on the same real moment. */
(function(){
  const HOURS = { from: 6, to: 22 };          // local hours offered in the grid (6:00 … 22:00 starts)
  const DAYS = 7;                              // grid shows one week at a time
  const WEEKS_AHEAD = 6;

  function startOfDay(d){ const x = new Date(d); x.setHours(0,0,0,0); return x; }
  function addDays(d, n){ const x = new Date(d); x.setDate(x.getDate() + n); return x; }

  // The days shown for week `w` (0 = starting today), in the viewer's local time.
  function weekDays(w){ const s = addDays(startOfDay(new Date()), w * DAYS); return Array.from({ length: DAYS }, (_, i) => addDays(s, i)); }
  function slotFor(day, hour){ const d = new Date(day); d.setHours(hour, 0, 0, 0); return d.toISOString(); }
  function hoursList(){ const a = []; for(let h = HOURS.from; h <= HOURS.to; h++) a.push(h); return a; }

  function sharedSlots(a, b, now = Date.now()){
    const B = new Set(b);
    return a.filter(s => B.has(s) && Date.parse(s) > now).sort();
  }

  /* For one person: every other person who is free at the same time,
     with the shared future slots that neither has booked yet. */
  function matchesFor(meId, people, availability, sessions, now = Date.now()){
    const mine = availability[meId] || [];
    const busy = new Set();
    sessions.forEach(s => { busy.add(s.a + '|' + s.slot); busy.add(s.b + '|' + s.slot); });
    return people
      .filter(p => p.id !== meId && p.lookingForBuddy !== false)
      .map(p => ({ person: p, slots: sharedSlots(mine, availability[p.id] || [], now).filter(s => !busy.has(meId+'|'+s) && !busy.has(p.id+'|'+s)) }))
      .filter(m => m.slots.length)
      .sort((x, y) => x.slots[0].localeCompare(y.slots[0]));
  }

  const fmtDay = new Intl.DateTimeFormat('en-GB', { weekday:'short', day:'numeric', month:'short' });
  const fmtTime = new Intl.DateTimeFormat('en-GB', { hour:'2-digit', minute:'2-digit' });
  function rangeLabel(iso, minutes){
    const d = new Date(iso), e = new Date(d.getTime() + minutes * 60e3);
    return `${fmtDay.format(d)} · ${fmtTime.format(d)}–${fmtTime.format(e)}`;
  }
  const slotLabel = iso => rangeLabel(iso, 60);
  // The same moment in someone else's time zone, e.g. "18:00 London".
  function inZone(iso, tz){
    try{
      const t = new Intl.DateTimeFormat('en-GB', { hour:'2-digit', minute:'2-digit', timeZone: tz }).format(new Date(iso));
      return `${t} ${tz.split('/').pop().replace(/_/g,' ')}`;
    }catch(e){ return ''; }
  }

  window.Matching = { HOURS, DAYS, WEEKS_AHEAD, weekDays, slotFor, hoursList, sharedSlots, matchesFor, slotLabel, rangeLabel, inZone, startOfDay, addDays };
})();
