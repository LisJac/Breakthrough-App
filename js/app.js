/* App shell: routing and the data views (Home, Find a buddy, Inspiration, Account).
 * All data goes through window.Store; all slot maths through window.Matching. */
(function(){
  const $ = id => document.getElementById(id);
  const M = window.Matching, S = window.Store, C = window.Calendar;
  const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[c]));
  const initials = n => String(n || '?').replace(/\(.*?\)/g,'').trim().split(/\s+/).map(w => w[0]).slice(0,2).join('').toUpperCase();
  const avatar = (p, cls = '') => p && p.photo
    ? `<span class="avatar ${cls}"><img src="${esc(p.photo)}" alt=""></span>`
    : `<span class="avatar ${cls}">${esc(initials(p?.name))}</span>`;
  // The link people share. Inside the claude.ai preview this is the artifact; once deployed it's the site itself.
  const APP_URL = window.claude ? 'https://claude.ai/artifact/PvwH2B54hxhmUZ3PoyPH39' : location.href.split('#')[0];
  const host = url => { try{ return new URL(url).hostname.replace(/^www\./, ''); }catch(e){ return url; } };
  const myTz = Intl.DateTimeFormat().resolvedOptions().timeZone;
  const dateFmt = new Intl.DateTimeFormat('en-GB', { day:'numeric', month:'short' });

  const QUESTIONS = ['Who am I?','What am I?','What is this?','Where am I from?','Why am I here?','What is my true nature?',
                     'What is the body?','What is another?','What is life?','What is love?','What is my way?'];
  const TYPES = [['book','Book'],['film','Film'],['podcast','Podcast'],['talk','Talk or video'],['practice','Practice'],['other','Other']];
  const typeLabel = t => (TYPES.find(x => x[0] === t) || [, 'Other'])[1];

  /* ---------- toast ---------- */
  let toastT;
  function toast(msg){ const t = $('toast'); t.textContent = msg; t.hidden = false; clearTimeout(toastT); toastT = setTimeout(() => t.hidden = true, 3200); }
  async function attempt(fn, ok){ try{ await fn(); if(ok) toast(ok); return true; }catch(e){ toast(e.message || 'Something went wrong.'); return false; } }

  /* Two-step confirm inside the page (browser confirm dialogs are blocked in some viewers). */
  function armed(btn, label){
    if(btn.dataset.armed) return true;
    const orig = btn.textContent; btn.dataset.armed = '1'; btn.textContent = label;
    setTimeout(() => { if(btn.isConnected){ delete btn.dataset.armed; btn.textContent = orig; } }, 4000);
    return false;
  }

  /* ---------- routing ---------- */
  const ROUTES = ['home','buddy','inspiration','account','notifications','settings','events','timer'];
  const VIEWS = ['home','buddy','inspiration','account','timer'];
  const viewOf = r => (r === 'notifications' || r === 'settings' || r === 'events') ? 'account' : r;
  const TITLES = { buddy:'Find a buddy', inspiration:'Inspiration', account:'Account', notifications:'Notifications', settings:'Settings', events:'Events', timer:'Timer' };
  let route = 'home';
  function readRoute(){ const r = (location.hash.replace(/^#\/?/, '') || 'home').split(/[?\/&=]/)[0]; return ROUTES.includes(r) ? r : 'home'; }
  function go(){
    const prev = route; route = readRoute();
    // Opened from a password-reset email: go straight to "Set a new password".
    if(S.recovering && route === 'home'){ route = 'account'; try{ history.replaceState(null, '', location.pathname + '#account'); }catch(e){} }
    const view = viewOf(route);
    VIEWS.forEach(t => $('view-' + t).hidden = t !== view);
    document.body.classList.toggle('on-home', view === 'home');
    document.querySelectorAll('.tabs a').forEach(a => a.dataset.tab === view ? a.setAttribute('aria-current','page') : a.removeAttribute('aria-current'));
    document.title = route === 'home' ? 'Breakthrough Online' : TITLES[route] + ' · Breakthrough Online';
    if(prev !== route){ seenUnread = null; openItem = null; window.scrollTo(0, 0); }
    render();
  }
  window.addEventListener('hashchange', go);
  document.addEventListener('click', e => { if(e.target.closest('#retryLoad')) render(); });

  /* ---------- shared bits ---------- */
  function navChrome(){
    const u = S.auth.current(), n = S.unreadCount();
    $('navBadge').hidden = !n; $('navBadge').textContent = n > 9 ? '9+' : n;
    // With unread notifications, tapping your name opens them directly.
    const acct = document.querySelector('.tabs a[data-tab="account"]');
    acct.setAttribute('href', n ? '#notifications' : '#account');
    acct.setAttribute('aria-label', n ? `${u ? u.name.split(' ')[0] : 'Account'}, ${n} new notification${n === 1 ? '' : 's'}` : (u ? u.name.split(' ')[0] : 'Account'));
    $('navAccount').textContent = u ? u.name.split(' ')[0] : 'Account';
  }
  // "Save in calendar" options for any entry (dyad or event). Entries are kept so the .ics button can find them.
  const calEntries = new Map();
  function calOptions(key, entry){
    calEntries.set(key, entry);
    return `<div class="cal-options">
      ${C.canDownloadIcs() ? `<button data-ics="${esc(key)}">Apple Calendar or Outlook app</button>` : ''}
      <a class="btn" href="${esc(C.googleUrl(entry))}" target="_blank" rel="noopener noreferrer">Google Calendar</a>
      <a class="btn" href="${esc(C.outlookUrl(entry))}" target="_blank" rel="noopener noreferrer">Outlook.com</a>
      ${C.canDownloadIcs() ? '' : `<p class="note">Apple Calendar files work once the app is live. In this preview, use Google or Outlook.</p>`}
    </div>`;
  }
  document.addEventListener('click', e => {
    const b = e.target.closest('[data-ics]'); if(!b) return;
    const entry = calEntries.get(b.dataset.ics); if(!entry) return;
    C.downloadIcs(entry); toast('Calendar file saved. Open it to add it to your calendar.');
  });

  function noteText(n, byId){
    const who = id => byId[id] ? esc(byId[id].name) : 'Your buddy';
    const when = n.slots.slice(0, 3).map(M.slotLabel).join(', ') + (n.slots.length > 3 ? ` and ${n.slots.length - 3} more` : '');
    if(n.kind === 'match') return `<strong>New match with ${who(n.other)}.</strong> You're both free ${esc(when)}.`;
    if(n.kind === 'booked') return `<strong>${who(n.other)} booked a dyad with you</strong> for ${esc(when)}.`;
    if(n.kind === 'cancelled') return `<strong>Dyad cancelled</strong> for ${esc(when)}. ${n.note ? esc(n.note) : who(n.other) + ' cancelled it.'}`;
    return '';
  }

  const signInPrompt = what => `
    <div class="callout"><p>${what}</p>
      <div class="row"><a class="btn primary" href="#account">Sign in or create account</a></div></div>`;

  /* ================= HOME ================= */
  // The button points at the most useful next step for this person.
  async function renderHome(){
    const me = S.auth.current();
    let line = '', cta = `<a class="btn primary big" href="#buddy">Find a buddy</a>`;
    if(!me){
      cta = `<button class="btn primary big" id="homeSignup">Register</button><button class="link on-photo" id="homeSignin">I already have an account</button>`;
    } else {
      const [sessions, people, notes] = await Promise.all([S.sessions(), S.people(), S.notifications()]);
      const next = sessions.filter(s => Date.parse(s.slot) + 3600e3 > Date.now()).sort((x, y) => x.slot.localeCompare(y.slot))[0];
      const fresh = notes.filter(n => !n.read && n.kind === 'match').length;
      if(next){
        const other = people.find(p => p.id === (next.a === me.id ? next.b : next.a));
        const soon = Date.parse(next.slot) - Date.now() < 30 * 60e3;   // starts within 30 min, or is running
        line = soon
          ? `Your dyad with ${other ? esc(other.name.split(' ')[0]) : 'your buddy'} ${Date.parse(next.slot) <= Date.now() ? 'is happening now' : 'starts soon'}.`
          : `Your next dyad is <strong>${esc(M.slotLabel(next.slot))}</strong> with ${other ? esc(other.name.split(' ')[0]) : 'your buddy'}.`;
        cta = soon && next.meetingUrl
          ? `<a class="btn primary big" href="${esc(next.meetingUrl)}" target="_blank" rel="noopener noreferrer">Join video call</a><a class="link on-photo" href="#timer?room=${esc(window.TimerSync ? TimerSync.codeFor(next.id) : '')}">Open shared timer</a>`
          : `<a class="btn primary big" href="#buddy">View dyad</a>`;
      } else if(fresh){
        line = `You have <strong>${fresh} new match${fresh === 1 ? '' : 'es'}</strong>.`;
        cta = `<a class="btn primary big" href="#buddy">See matches</a>`;
      }
    }
    $('view-home').innerHTML = `
      <section class="page welcome">
        <h1>${me ? `Hi ${esc(me.name.split(' ')[0])},<br><span>glad you're here.</span>` : 'Welcome'}</h1>
        ${me ? '' : `<p class="home-intro">This app is for practitioners of the Breakthrough Intensive Retreat. You can find a buddy, use the timer for online dyads, and find inspiration.</p>
        <p class="home-line">Register to use all functions in the app.</p>`}
        ${line ? `<p class="home-line">${line}</p>` : ''}
        <div class="row">${cta}</div>
        <div class="share">
          <button class="btn on-photo-ghost" id="homeShare">
            <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" width="18" height="18"><path d="M10 13V3M6 7l4-4 4 4M4 11v4.5A1.5 1.5 0 0 0 5.5 17h9a1.5 1.5 0 0 0 1.5-1.5V11"/></svg>
            Share the app with other practitioners</button>
          <div class="share-link" id="shareLink" hidden><input id="shareUrl" readonly value="${esc(APP_URL)}" aria-label="App link"><button class="link on-photo" id="shareCopy">Copy</button></div>
        </div>
      </section>`;
  }
  $('view-home').addEventListener('click', e => {
    if(e.target.closest('#homeSignup')){ authMode = 'signup'; location.hash = '#account'; }
    if(e.target.closest('#homeSignin')){ authMode = 'signin'; location.hash = '#account'; }
    if(e.target.closest('#homeShare')) shareApp();
    if(e.target.closest('#shareCopy')) copyLink();
  });

  /* ---------- sharing ---------- */
  // Phones get the native share sheet; elsewhere the link is copied, with the link shown as a fallback.
  const SHARE_TEXT = 'Breakthrough Online: find a dyad buddy, use the timer for online dyads and share inspiration with other practitioners of the Breakthrough Intensive.';
  async function shareApp(){
    if(navigator.share){
      try{ await navigator.share({ title:'Breakthrough Online', text:SHARE_TEXT, url:APP_URL }); return; }
      catch(e){ if(e && e.name === 'AbortError') return; }
    }
    copyLink();
  }
  async function copyLink(){
    try{ await navigator.clipboard.writeText(APP_URL); toast('Link copied. Paste it wherever you talk to other practitioners.'); }
    catch(e){
      const box = $('shareLink'), input = $('shareUrl');
      if(box){ box.hidden = false; input.focus(); input.select(); }
      toast('Copy the link below to share it.');
    }
  }

  /* ================= FIND A BUDDY ================= */
  let week = 0, seenUnread = null, saveT = null, pending = null, calOpen = null, linkEdit = null, evFormOpen = false, partsOpen = null;

  async function renderBuddy(){
    const el = $('view-buddy'), me = S.auth.current();
    const head = `<h1>Find a dyad buddy</h1>`;

    if(!me){
      const n = await S.lookingCount();
      el.innerHTML = head + `
        <p class="lede">Mark the hours you're free to sit a dyad online. When someone else is free at the same time, you both get a note with the shared slot, and either of you can book it.</p>
        <dl class="props"><dt>Looking now</dt><dd>${n} participant${n === 1 ? '' : 's'}</dd><dt>Format</dt><dd>One hour block · about 40 minutes of dyad, with the timer</dd></dl>
        ${signInPrompt('You need an account to add your availability, see who you match with and join community events.')}`;
      return;
    }

    const [people, avail, sessions, allSessions] = await Promise.all([S.people(), S.allAvailability(), S.sessions(), S.allSessions()]);
    const byId = Object.fromEntries(people.map(p => [p.id, p]));
    const mine = new Set(pending || avail[me.id] || []);
    const now = Date.now();
    const upcoming = sessions.filter(s => Date.parse(s.slot) + 3600e3 > now).sort((a,b) => a.slot.localeCompare(b.slot));
    const matches = M.matchesFor(me.id, people, Object.assign({}, avail, { [me.id]: [...mine] }), allSessions, now);
    const bookedMine = new Map(upcoming.map(s => [s.slot, s]));
    // How many other people are free in each slot (for the green dot).
    const othersFree = {};
    people.forEach(p => { if(p.id === me.id || p.lookingForBuddy === false) return; (avail[p.id] || []).forEach(s => othersFree[s] = (othersFree[s] || 0) + 1); });

    const otherTime = (iso, p) => p && p.timezone && p.timezone !== myTz ? `<span class="meta">${esc(M.inZone(iso, p.timezone))} for ${esc(p.name.split(' ')[0])}</span>` : '';

    el.innerHTML = head + `

      ${me.lookingForBuddy === false ? `<div class="callout"><p>You're currently hidden from matching.</p><div class="row"><button id="unpause">Show me to others again</button></div></div>` : ''}

      <section class="section"><h2>Your upcoming dyads</h2>
        ${upcoming.length ? `<ul class="list">${upcoming.map(s => { const other = byId[s.a === me.id ? s.b : s.a]; return `
          <li><div class="slot-row"><span class="when">${esc(M.slotLabel(s.slot))}</span>${otherTime(s.slot, other)}</div>
            <div class="person">${avatar(other)}<div><div>${other ? esc(other.name) : 'Former participant'}</div>${other?.question ? `<div class="q">${esc(other.question)}</div>` : ''}</div></div>
            ${s.meetingUrl ? `<div class="call-row"><a class="btn primary" href="${esc(s.meetingUrl)}" target="_blank" rel="noopener noreferrer">Join video call</a><span class="meta call-host">${esc(host(s.meetingUrl))}</span><button class="link" data-linkedit="${s.id}">Use a different link</button></div>` : ''}
            ${linkEdit === s.id ? `<form class="link-form" data-linkform="${s.id}"><label class="field">Your own call link (Zoom, Google Meet …)<input name="url" type="text" inputmode="url" required placeholder="https://" value="${esc(s.meetingUrl || '')}" autocomplete="off"></label>
              <div class="row"><button class="primary" type="submit">Save link</button><button type="button" class="link" data-linkedit="${s.id}">Cancel</button></div>
              <p class="note">Your buddy sees the new link right away.</p></form>` : ''}
            <div class="row"><button data-cal="${s.id}" aria-expanded="${calOpen === s.id}">Save in calendar</button>${window.TimerSync ? `<a class="btn" href="#timer?room=${esc(TimerSync.codeFor(s.id))}">Open shared timer</a>` : ''}<button class="danger" data-cancel="${s.id}">Cancel dyad</button></div>
            ${calOpen === s.id ? calOptions(s.id, C.dyadEntry(s, me, other)) : ''}</li>`; }).join('')}</ul>`
          : `<p class="empty">Nothing booked yet. Book one of your matches below.</p>`}
      </section>

      <section class="section"><h2>Matches</h2>
        ${matches.length ? `<ul class="list">${matches.map(m => `
          <li><div class="person">${avatar(m.person)}
              <div><div>${esc(m.person.name)} <span class="meta">· ${esc((m.person.timezone || '').replace(/_/g,' '))}</span></div><div class="q">${esc(m.person.question || '')}</div></div></div>
            ${m.slots.slice(0, 4).map(s => `<div class="slot-row"><span class="when">${esc(M.slotLabel(s))}</span>${otherTime(s, m.person)}<span style="flex:1"></span>
              <button data-book="${m.person.id}|${s}">Book</button></div>`).join('')}
            ${m.slots.length > 4 ? `<div class="meta">and ${m.slots.length - 4} more shared slot${m.slots.length - 4 === 1 ? '' : 's'}</div>` : ''}
          </li>`).join('')}</ul>`
          : `<p class="empty">${mine.size ? 'No one shares your hours yet. You’ll be told here as soon as someone does.' : 'Add a few hours below to start matching.'}</p>`}
      </section>

      <section class="section"><h2>Your availability</h2>
        <p class="section-intro">Mark the hours you're free. When someone shares a slot with you, you'll both be told here, and either of you can book it. You'll get a notification.</p>
        <div class="week-nav">
          <button id="wkPrev" ${week === 0 ? 'disabled' : ''} aria-label="Previous week">←</button>
          <strong>${esc(dateFmt.format(M.weekDays(week)[0]))} – ${esc(dateFmt.format(M.weekDays(week)[6]))}</strong>
          <button id="wkNext" ${week >= M.WEEKS_AHEAD - 1 ? 'disabled' : ''} aria-label="Next week">→</button>
        </div>
        <div class="legend"><span><i class="sel"></i>You're free</span><span><i class="mt"></i>Someone else is free</span><span><i class="bk"></i>Booked</span></div>
        <div class="days" id="days">${M.weekDays(week).map(d => {
          const isToday = M.startOfDay(new Date()).getTime() === d.getTime();
          return `<div class="day ${isToday ? 'today' : ''}"><div class="day-label">${d.toLocaleDateString('en-GB', { weekday:'long' })}<small>${esc(dateFmt.format(d))}</small></div>
            <div class="slots">${M.hoursList().map(h => {
              const iso = M.slotFor(d, h), past = Date.parse(iso) < now, booked = bookedMine.has(iso);
              const cls = ['slot', othersFree[iso] && !booked ? 'match' : '', booked ? 'booked' : ''].join(' ');
              const title = booked ? 'Booked' : othersFree[iso] ? `${othersFree[iso]} other${othersFree[iso] > 1 ? 's' : ''} free` : '';
              return `<button class="${cls}" data-slot="${iso}" aria-pressed="${mine.has(iso) || booked}" ${past || booked ? 'disabled' : ''} title="${title}">${String(h).padStart(2,'0')}:00</button>`;
            }).join('')}</div></div>`; }).join('')}</div>
        <p class="note">Times are in your time zone (${esc(myTz.replace(/_/g,' '))}). Each block is one hour. Changes save automatically.</p>
      </section>`;
  }

  /* ---------- community events ---------- */
  const DURATIONS = [30, 45, 60, 90, 120, 180];
  const durLabel = m => m < 60 ? `${m} min` : (m % 60 ? `${Math.floor(m/60)} h ${m % 60} min` : `${m/60} h`);
  // The body of an event card: date, title, host, description, places and actions.
  function eventBody(e, me, { admin = false, byId = {}, participants = [] } = {}){
    const full = e.capacity && e.going >= e.capacity, left = e.capacity ? e.capacity - e.going : null;
    const key = 'ev:' + e.id;
    let actions;
    if(!me) actions = `<a class="btn" href="#account">Sign in to join</a>`;
    else if(e.iAmGoing) actions = `${e.meetingUrl ? `<a class="btn primary" href="${esc(e.meetingUrl)}" target="_blank" rel="noopener noreferrer">Join video call</a>` : ''}
      <button data-cal="${key}" aria-expanded="${calOpen === key}">Save in calendar</button><button class="link danger" data-leave="${e.id}">I can't make it</button>`;
    else if(full) actions = `<button disabled>Full</button>`;
    else actions = `<button class="primary" data-join="${e.id}">Join</button>`;
    return `
      <div class="slot-row"><span class="when">${esc(M.rangeLabel(e.start, e.durationMin))}</span>${e.iAmGoing ? `<span class="tag ok">You're going</span>` : ''}</div>
      <div class="ev-title">${esc(e.title)}</div>
      ${e.host ? `<div class="meta">with ${esc(e.host)}</div>` : ''}
      ${e.description ? `<p class="ev-desc">${esc(e.description)}</p>` : ''}
      <div class="meta">${e.going} going${left !== null ? ` · ${full ? 'full' : `${left} place${left === 1 ? '' : 's'} left`}` : ''}</div>
      <div class="row">${actions}</div>
      ${e.iAmGoing && calOpen === key ? calOptions(key, C.eventEntry(e)) : ''}
      ${admin ? `<div class="admin-row">
        <button class="link" data-parts="${e.id}" aria-expanded="${partsOpen === e.id}">${partsOpen === e.id ? 'Hide participants' : `Participants (${e.going})`}</button>
        ${!e.iAmGoing && e.meetingUrl ? `<span class="meta">Call link: ${esc(host(e.meetingUrl))}</span>` : ''}
        <span style="flex:1"></span><button class="link danger" data-evdel="${e.id}">Cancel event</button></div>
        ${partsOpen === e.id ? (participants.length ? `<ul class="parts">${participants.map(p => { const who = byId[p.userId]; return `<li>${avatar(who)}<span>${who ? esc(who.name) : 'Former participant'}</span></li>`; }).join('')}</ul>`
          : `<p class="note">Nobody has joined yet.</p>`) : ''}` : ''}`;
  }

  function eventForm(me){
    const todayISO = new Date(Date.now() - new Date().getTimezoneOffset() * 60e3).toISOString().slice(0, 10);
    return `
      <form class="form callout ev-form" id="evForm" style="max-width:none">
        <label class="field">Title<input name="title" required maxlength="120" autocomplete="off" placeholder="Community dyad evening"></label>
        <div class="two">
          <label class="field">Hosted by<input name="host" maxlength="80" autocomplete="off" value="${esc(me.name.split(' ')[0])}"></label>
          <label class="field">Places (optional)<input name="capacity" type="number" inputmode="numeric" min="1" max="1000" placeholder="No limit"></label>
        </div>
        <div class="three">
          <label class="field">Date<input name="date" type="date" required min="${todayISO}"></label>
          <label class="field">Start<input name="time" type="time" required step="900" value="19:00"></label>
          <label class="field">Length<select name="durationMin">${DURATIONS.map(d => `<option value="${d}" ${d === 90 ? 'selected' : ''}>${durLabel(d)}</option>`).join('')}</select></label>
        </div>
        <label class="field">Video call link (optional)<input name="meetingUrl" type="text" inputmode="url" maxlength="400" placeholder="https://" autocomplete="off"><span class="note">Only people who join see the link.</span></label>
        <label class="field">Description (optional)<textarea name="description" maxlength="1500"></textarea></label>
        <div class="row"><button class="primary" type="submit">Publish event</button><button type="button" class="link" id="evCancel">Cancel</button></div>
        <p class="note">Every member gets a notification and can join from there. Times are in your time zone (${esc(myTz.replace(/_/g,' '))}); everyone sees them in their own.</p>
      </form>`;
  }

  // One delegated handler for the buddy view.
  $('view-buddy').addEventListener('click', async e => {
    const t = e.target.closest('button'); if(!t) return;
    if(t.dataset.slot){
      const me = S.auth.current(); if(!me) return;
      const cur = new Set(pending || await S.myAvailability());
      cur.has(t.dataset.slot) ? cur.delete(t.dataset.slot) : cur.add(t.dataset.slot);
      pending = [...cur];
      const focusSlot = t.dataset.slot;
      await renderBuddy();
      const again = document.querySelector(`[data-slot="${focusSlot}"]`); if(again) again.focus({ preventScroll:true });
      clearTimeout(saveT);
      saveT = setTimeout(async () => { const p = pending; await attempt(() => S.setAvailability(p)); if(pending === p) pending = null; }, 600);
      return;
    }
    if(t.id === 'wkPrev'){ week = Math.max(0, week - 1); return renderBuddy(); }
    if(t.id === 'wkNext'){ week = Math.min(M.WEEKS_AHEAD - 1, week + 1); return renderBuddy(); }
    if(t.id === 'unpause') return attempt(() => S.auth.update({ lookingForBuddy:true }), 'You’re visible for matching again.');
    if(t.dataset.book){
      const [other, slot] = t.dataset.book.split('|');
      t.disabled = true;
      await flushAvailability();
      return attempt(() => S.book(other, slot), 'Booked. Your buddy has been told.');
    }
    if(t.dataset.linkedit){ linkEdit = linkEdit === t.dataset.linkedit ? null : t.dataset.linkedit; await renderBuddy(); const i = document.querySelector('.link-form input'); if(i){ i.focus(); i.select(); } return; }
    if(t.dataset.cal){ calOpen = calOpen === t.dataset.cal ? null : t.dataset.cal; return renderBuddy(); }
    if(t.dataset.cancel){
      if(!armed(t, 'Tap again to cancel')) return;
      return attempt(() => S.cancel(t.dataset.cancel), 'Dyad cancelled.');
    }
  });
  $('view-buddy').addEventListener('submit', async e => {
    const f = e.target.closest('[data-linkform]'); if(!f) return;
    e.preventDefault();
    const url = new FormData(f).get('url');
    if(await attempt(() => S.setMeetingUrl(f.dataset.linkform, url), 'Call link saved.')){ linkEdit = null; renderBuddy(); }
  });
  async function flushAvailability(){ if(pending){ clearTimeout(saveT); const p = pending; pending = null; await S.setAvailability(p); } }
  window.addEventListener('pagehide', () => { if(pending) S.setAvailability(pending); });

  /* ================= INSPIRATION ================= */
  let filter = 'all', formOpen = false, openItem = null, pendingImage = null;   // pendingImage: { blob, url } for the form

  // Shrink an image before upload: longest side at most 1200 px, JPEG.
  function resizeImage(file, max = 1200){
    return new Promise((res, rej) => {
      if(!file || !/^image\//.test(file.type)) return rej(new Error('Please choose an image file (JPG, PNG or WebP).'));
      const url = URL.createObjectURL(file), img = new Image();
      img.onload = () => {
        const k = Math.min(1, max / Math.max(img.naturalWidth, img.naturalHeight));
        const c = document.createElement('canvas');
        c.width = Math.round(img.naturalWidth * k); c.height = Math.round(img.naturalHeight * k);
        const g = c.getContext('2d'); g.fillStyle = '#fff'; g.fillRect(0, 0, c.width, c.height); g.drawImage(img, 0, 0, c.width, c.height);
        URL.revokeObjectURL(url);
        c.toBlob(b => b ? res(b) : rej(new Error('That image couldn\u2019t be prepared. Try another one.')), 'image/jpeg', 0.82);
      };
      img.onerror = () => { URL.revokeObjectURL(url); rej(new Error('That image couldn\u2019t be opened. Try a JPG or PNG.')); };
      img.src = url;
    });
  }
  const imagePickerInner = () => pendingImage
    ? `<img src="${esc(pendingImage.url)}" alt=""><div class="row"><label class="btn" for="inspImage">Change image</label><button type="button" class="link danger" id="inspImageRemove">Remove image</button></div>`
    : `<label class="btn" for="inspImage">Add an image</label><span class="note">A cover, a still or a photo. Shown in the tile view.</span>`;
  let layout = (() => { try{ return localStorage.getItem('breakthrough.layout') || 'list'; }catch(e){ return 'list'; } })();
  const setLayout = v => { layout = v; try{ localStorage.setItem('breakthrough.layout', v); }catch(e){} };

  async function renderInspiration(){
    const el = $('view-inspiration'), me = S.auth.current();
    const [items, people] = await Promise.all([S.inspiration(), S.people()]);
    const byId = Object.fromEntries(people.map(p => [p.id, p]));
    const by = i => { const a = byId[i.authorId]; return `${a ? esc(a.name.split(' ')[0]) : 'Someone'} · ${esc(dateFmt.format(new Date(i.createdAt)))}`; };

    // ---- one entry ----
    const item = openItem && items.find(i => i.id === openItem);
    if(openItem && !item) openItem = null;
    if(item){
      const author = byId[item.authorId];
      el.innerHTML = `
        <div><button class="link" id="inspBack">← All inspiration</button></div>
        <article class="detail">
          <span class="tag">${esc(typeLabel(item.type))}</span>
          <h1>${esc(item.title)}</h1>
          ${item.creator ? `<p class="by">${esc(item.creator)}</p>` : ''}
          ${item.imageUrl ? `<img class="detail-img" src="${esc(item.imageUrl)}" alt="">` : ''}
          ${item.note ? `<p class="why">${esc(item.note)}</p>` : `<p class="empty">No note added.</p>`}
          ${item.link ? `<div class="row"><a class="btn primary" href="${esc(item.link)}" target="_blank" rel="noopener noreferrer">Open link</a><span class="meta">${esc(host(item.link))}</span></div>` : ''}
          <hr>
          <div class="person">${avatar(author)}<div><div>Added by ${author ? esc(author.name) : (S.auth.current() ? 'a former participant' : 'a participant')}</div><div class="meta">${esc(dateFmt.format(new Date(item.createdAt)))}</div></div></div>
          ${me && me.id === item.authorId ? `<div class="row"><button class="danger" data-remove="${item.id}">Remove entry</button></div>` : ''}
        </article>`;
      return;
    }

    // ---- the board ----
    const shown = filter === 'all' ? items : items.filter(i => i.type === filter);
    const counts = items.reduce((a, i) => (a[i.type] = (a[i.type] || 0) + 1, a), {});
    const icons = {
      list: '<svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" aria-hidden="true"><path d="M3 5h14M3 10h14M3 15h14"/></svg>',
      tiles: '<svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.6" aria-hidden="true"><rect x="3" y="3" width="5.5" height="5.5" rx="1"/><rect x="11.5" y="3" width="5.5" height="5.5" rx="1"/><rect x="3" y="11.5" width="5.5" height="5.5" rx="1"/><rect x="11.5" y="11.5" width="5.5" height="5.5" rx="1"/></svg>'
    };

    el.innerHTML = `
      <h1>Inspiration board</h1>
      <p class="lede">Books, films and other things that have helped others on the path. Anyone can browse. Add your own with an account.</p>

      ${me ? (formOpen ? `
        <form class="form callout" id="inspForm" style="max-width:none">
          <div class="two">
            <label class="field">Type<select name="type">${TYPES.map(([v, l]) => `<option value="${v}">${l}</option>`).join('')}</select></label>
            <label class="field">Title<input name="title" required maxlength="140" autocomplete="off"></label>
          </div>
          <div class="two">
            <label class="field">Author or creator <input name="creator" maxlength="120" autocomplete="off"></label>
            <label class="field">Link (optional)<input name="link" type="url" inputmode="url" maxlength="400" placeholder="https://" autocomplete="off"></label>
          </div>
          <label class="field">Why it's worth it (optional)<textarea name="note" maxlength="600"></textarea></label>
          <div class="field">Image (optional)
            <div class="img-pick" id="inspImagePick">${imagePickerInner()}</div>
            <input type="file" id="inspImage" accept="image/jpeg,image/png,image/webp" hidden>
          </div>
          <div class="row"><button class="primary" type="submit">Add to board</button><button type="button" class="link" id="inspCancel">Cancel</button></div>
        </form>` : `<div class="row"><button class="primary" id="inspOpen">Add inspiration</button></div>`)
        : signInPrompt('Sign in to add something to the board. You can always remove your own entries.')}

      ${items.length ? `<div class="board-bar">
        <div class="chips" role="group" aria-label="Filter by type">
          <button class="chip" data-filter="all" aria-pressed="${filter === 'all'}">All ${items.length}</button>
          ${TYPES.filter(([v]) => counts[v]).map(([v, l]) => `<button class="chip" data-filter="${v}" aria-pressed="${filter === v}">${l} ${counts[v]}</button>`).join('')}
        </div>
        <div class="seg-toggle" role="group" aria-label="View">
          <button data-layout="list" aria-pressed="${layout === 'list'}" aria-label="List view" title="List">${icons.list}</button>
          <button data-layout="tiles" aria-pressed="${layout === 'tiles'}" aria-label="Tile view" title="Tiles">${icons.tiles}</button>
        </div>
      </div>` : ''}

      ${!shown.length ? `<p class="empty">${items.length ? 'Nothing in this category yet.' : 'The board is empty. ' + (me ? 'Be the first to add something.' : '')}</p>`
        : layout === 'tiles' ? `<div class="board">${shown.map(i => `
          <button class="card${i.imageUrl ? ' has-img' : ''}" data-open="${i.id}">
            ${i.imageUrl ? `<img class="card-img" src="${esc(i.imageUrl)}" alt="" loading="lazy">` : ''}
            <span class="card-body">
              <span class="tag">${esc(typeLabel(i.type))}</span>
              <span class="title">${esc(i.title)}</span>
              ${i.creator ? `<span class="by">${esc(i.creator)}</span>` : ''}
              ${i.note ? `<span class="why clamp">${esc(i.note)}</span>` : ''}
              <span class="foot"><span>${by(i)}</span>${i.link ? `<span>${esc(host(i.link))}</span>` : ''}</span>
            </span>
          </button>`).join('')}</div>`
        : `<ul class="list ilist">${shown.map(i => `
          <li><button class="irow" data-open="${i.id}">
            <span class="irow-main"><span class="ititle">${esc(i.title)}</span>${i.creator ? `<span class="by">${esc(i.creator)}</span>` : ''}</span>
            <span class="irow-meta"><span class="tag">${esc(typeLabel(i.type))}</span><span class="meta">${by(i)}</span></span>
            <svg class="chev" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" aria-hidden="true"><path d="M8 5l5 5-5 5"/></svg>
          </button></li>`).join('')}</ul>`}`;
  }

  $('view-inspiration').addEventListener('click', async e => {
    const t = e.target.closest('button'); if(!t) return;
    if(t.dataset.open){ openItem = t.dataset.open; await renderInspiration(); window.scrollTo(0, 0); return; }
    if(t.id === 'inspBack'){ const back = openItem; openItem = null; await renderInspiration(); const r = document.querySelector(`[data-open="${back}"]`); if(r) r.focus(); return; }
    if(t.dataset.layout){ setLayout(t.dataset.layout); return renderInspiration(); }
    if(t.dataset.filter){ filter = t.dataset.filter; return renderInspiration(); }
    if(t.id === 'inspOpen'){ formOpen = true; await renderInspiration(); document.querySelector('#inspForm [name=title]').focus(); return; }
    if(t.id === 'inspCancel'){ formOpen = false; clearPendingImage(); return renderInspiration(); }
    if(t.id === 'inspImageRemove'){ clearPendingImage(); $('inspImagePick').innerHTML = imagePickerInner(); return; }
    if(t.dataset.remove){
      if(!armed(t, 'Tap again to remove')) return;
      if(await attempt(() => S.removeInspiration(t.dataset.remove), 'Removed.')){ openItem = null; renderInspiration(); }
    }
  });
  function clearPendingImage(){ if(pendingImage) URL.revokeObjectURL(pendingImage.url); pendingImage = null; }
  // Picking an image updates only the preview, so nothing typed in the form is lost.
  $('view-inspiration').addEventListener('change', async e => {
    if(e.target.id !== 'inspImage') return;
    const file = e.target.files && e.target.files[0]; e.target.value = '';
    if(!file) return;
    try{ const blob = await resizeImage(file); clearPendingImage(); pendingImage = { blob, url: URL.createObjectURL(blob) }; }
    catch(err){ toast(err.message); }
    $('inspImagePick').innerHTML = imagePickerInner();
  });
  $('view-inspiration').addEventListener('submit', async e => {
    if(e.target.id !== 'inspForm') return;
    e.preventDefault();
    const f = Object.fromEntries(new FormData(e.target));
    const btn = e.target.querySelector('[type=submit]'); btn.disabled = true; btn.textContent = pendingImage ? 'Uploading…' : 'Adding…';
    const ok = await attempt(() => S.addInspiration({ ...f, image: pendingImage ? pendingImage.blob : null }), 'Added to the board.');
    if(ok){ formOpen = false; filter = 'all'; clearPendingImage(); renderInspiration(); }
    else { btn.disabled = false; btn.textContent = 'Add to board'; }
  });

  /* ================= ACCOUNT ================= */
  let authMode = 'signin';
  const zones = (() => { try{ return Intl.supportedValuesOf('timeZone'); }catch(e){ return [myTz, 'Europe/London', 'Europe/Berlin', 'UTC']; } })();
  const tzSelect = cur => `<select name="timezone">${(zones.includes(cur) ? zones : [cur, ...zones]).map(z => `<option value="${esc(z)}" ${z === cur ? 'selected' : ''}>${esc(z.replace(/_/g,' '))}</option>`).join('')}</select>`;
  const qSelect = cur => `<select name="question">${(QUESTIONS.includes(cur) || !cur ? QUESTIONS : [cur, ...QUESTIONS]).map(q => `<option ${q === cur ? 'selected' : ''}>${esc(q)}</option>`).join('')}</select>`;

  const devTools = !S.dev ? '' : `
    <hr>
    <section class="section"><h2>Local testing</h2>
      <p class="note">Data is stored only in this browser while we work locally. To try matching, add sample participants, or open a second tab and sign in as someone else (each tab keeps its own sign-in).</p>
      <div class="row"><button id="devSeed">Add sample participants</button><button class="link danger" id="devReset">Reset all local data</button></div>
    </section>`;

  /* ---------- theme (per device) ---------- */
  const THEMES = [['light', 'Light'], ['dark', 'Dark'], ['auto', 'Automatic']];
  const getTheme = () => { try{ const t = localStorage.getItem('breakthrough.theme'); return t === 'light' || t === 'dark' ? t : 'auto'; }catch(e){ return 'auto'; } };
  function setTheme(t){
    try{ localStorage.setItem('breakthrough.theme', t); }catch(e){}
    t === 'auto' ? document.documentElement.removeAttribute('data-theme') : document.documentElement.setAttribute('data-theme', t);
  }

  let resetSentTo = '';
  async function renderAccount(){
    const el = $('view-account'), me = S.auth.current(), sub = route;
    const n = S.unreadCount();
    const subnav = `<nav class="subnav" aria-label="Account">
        <a href="#account" ${sub === 'account' ? 'aria-current="page"' : ''}>${me ? 'Profile' : 'Sign in'}</a>
        <a href="#notifications" ${sub === 'notifications' ? 'aria-current="page"' : ''}>Notifications${n ? ` <span class="badge">${n}</span>` : ''}</a>
        <a href="#settings" ${sub === 'settings' ? 'aria-current="page"' : ''}>Settings</a>
        ${me && me.isAdmin ? `<a href="#events" ${sub === 'events' ? 'aria-current="page"' : ''}>Events</a>` : ''}
      </nav>`;
    const head = `` + subnav;

    // Arrived from a password-reset email.
    if(S.recovering){
      el.innerHTML = `<h1>Set a new password</h1>
        <p class="lede">Choose a new password for ${me ? esc(me.email) : 'your account'}.</p>
        <form class="form" id="newPwForm">
          <label class="field">New password<input name="password" type="password" required minlength="6" autocomplete="new-password"><span class="note">At least 6 characters</span></label>
          <div class="row"><button class="primary" type="submit">Save new password</button><button type="button" class="link" id="recoveryCancel">Not now</button></div>
        </form>`;
      return;
    }

    // ----- Events (admins) -----
    if(sub === 'events'){
      if(!me || !me.isAdmin){ el.innerHTML = head + `<h1>Events</h1><p class="empty">Only hosts can create community events.</p>`; return; }
      const [events, people] = await Promise.all([S.events(), S.people()]);
      const participants = partsOpen ? await S.eventParticipants(partsOpen) : [];
      const byId = Object.fromEntries(people.map(p => [p.id, p]));
      el.innerHTML = head + `
        <div class="section-head page-head"><h1>Events</h1>${evFormOpen ? '' : `<button class="primary" id="evNew">New event</button>`}</div>
        ${evFormOpen ? eventForm(me) : ''}
        ${events.length ? `<ul class="list">${events.map(e => `<li class="event">${eventBody(e, me, { admin:true, byId, participants })}</li>`).join('')}</ul>`
          : `<p class="empty">No upcoming events. When you publish one, every member gets a notification and can join from there.</p>`}`;
      return;
    }

    // ----- Settings -----
    if(sub === 'settings'){
      const cur = getTheme();
      el.innerHTML = head + `
        <h1>Settings</h1>
        <section class="section"><h2>Appearance</h2>
          <div class="choice" role="radiogroup" aria-label="Appearance">
            ${THEMES.map(([v, l]) => `<label class="opt"><input type="radio" name="theme" value="${v}" ${cur === v ? 'checked' : ''}><span class="swatch ${v}" aria-hidden="true"></span><span>${l}</span></label>`).join('')}
          </div>
          <p class="note">Automatic follows your device's light or dark setting. This is saved on this device only.</p>
        </section>
        ${window.TimerSounds ? `<section class="section"><h2>Timer sound</h2>
          <ul class="list sounds" role="radiogroup" aria-label="Timer sound">${TimerSounds.list().map(s => `
            <li><label class="sound-opt"><input type="radio" name="sound" value="${s.key}" ${TimerSounds.get() === s.key ? 'checked' : ''}>
              <span><span class="sound-name">${esc(s.label)}</span><span class="meta">${esc(s.hint)}</span></span></label>
              <button type="button" class="play" data-play="${s.key}" aria-label="Play ${esc(s.label)}">▶ Play</button></li>`).join('')}
          </ul>
          <p class="note">Plays at the start of every turn. Saved on this device only.</p></section>` : ''}
        ${me && S.needsPassword ? `<section class="section"><h2>Password</h2>
          <form class="form" id="changePwForm">
            <label class="field">New password<input name="password" type="password" required minlength="6" autocomplete="new-password"><span class="note">At least 6 characters</span></label>
            <div class="row"><button type="submit">Change password</button></div>
          </form></section>` : ''}
        ${me ? `<section class="section"><h2>Account</h2>
          <div class="row"><button id="signOut">Sign out</button><span style="flex:1"></span><button class="link danger" id="delAcct">Delete account</button></div>
          <p class="note">Deleting removes your profile, availability, booked dyads and board entries.</p></section>` : ''}`;
      return;
    }

    // ----- Notifications -----
    if(sub === 'notifications'){
      if(!me){ el.innerHTML = head + `<h1>Notifications</h1>` + signInPrompt('Sign in to see when someone matches your hours, books a dyad with you or cancels.'); return; }
      const [notes, people, events] = await Promise.all([S.notifications(), S.people(), S.events()]);
      const byId = Object.fromEntries(people.map(p => [p.id, p]));
      const evById = Object.fromEntries(events.map(e => [e.id, e]));
      if(seenUnread === null){ seenUnread = new Set(notes.filter(x => !x.read).map(x => x.id)); if(seenUnread.size) S.markAllRead(); }
      el.innerHTML = head + `
        <h1>Notifications</h1>
        ${notes.length ? `<ul class="list notes">${notes.map(x => {
          const unread = seenUnread.has(x.id) ? 'unread' : '';
          if(x.kind === 'event'){
            const ev = evById[x.eventId];
            return `<li class="event ${unread}"><div class="note-kind tag accent">Community event</div>
              ${ev ? eventBody(ev, me) : `<div class="meta">This event has already taken place.</div>`}
              <div class="meta">${esc(dateFmt.format(new Date(x.createdAt)))}</div></li>`;
          }
          if(x.kind === 'event_cancelled') return `<li class="${unread}"><div class="note-kind tag">Event cancelled</div>
            <div><strong>${esc(x.note || 'A community event')}</strong> on ${esc(M.slotLabel(x.slots[0]).split(' · ')[0])} has been cancelled.</div>
            <div class="meta">${esc(dateFmt.format(new Date(x.createdAt)))}</div></li>`;
          return `<li class="${unread}">
            <div class="note-kind tag ${x.kind === 'booked' ? 'ok' : ''}">${{ match:'New match', booked:'Dyad booked', cancelled:'Cancelled' }[x.kind] || 'Update'}</div>
            <div>${noteText(x, byId)}</div>
            <div class="row"><span class="meta">${esc(dateFmt.format(new Date(x.createdAt)))}</span>${x.kind !== 'cancelled' ? `<a class="link-inline" href="#buddy">${x.kind === 'match' ? 'See matches' : 'View dyad'}</a>` : ''}</div>
          </li>`; }).join('')}</ul>`
          : `<p class="empty">Nothing yet. When someone matches your hours, books a dyad with you, or a community event is announced, it shows up here.</p>`}`;
      return;
    }

    // ----- Profile, or sign in / sign up / forgot password -----
    if(!me){
      const title = { signin:'Sign in', signup:'Create your account', forgot:'Reset your password' }[authMode];
      el.innerHTML = head + `
        <h1>${title}</h1>
        ${authMode === 'forgot' ? '' : `<p class="lede">You need an account to find a dyad buddy, join events or share inspiration. Browsing the board and using the timer work without one.</p>`}
        ${authMode === 'signin' ? `
          <form class="form" id="signinForm">
            <label class="field">Email<input name="email" type="email" required autocomplete="email" inputmode="email"></label>
            ${S.needsPassword ? `<label class="field">Password<input name="password" type="password" required autocomplete="current-password"></label>` : ''}
            <div class="row"><button class="primary" type="submit">Sign in</button>${S.needsPassword ? `<button type="button" class="link" data-mode="forgot">Forgot password?</button>` : ''}</div>
            <div class="row"><button type="button" class="link" data-mode="signup">New here? Create an account</button></div>
            ${S.needsPassword ? '' : `<p class="note">This preview keeps everything in your browser, so there's no password.</p>`}
          </form>` : authMode === 'forgot' ? `
          <p class="lede">Enter the email you signed up with and we'll send you a link to set a new password.</p>
          ${resetSentTo ? `<div class="callout ok"><p>If there's an account for <strong>${esc(resetSentTo)}</strong>, a reset link is on its way. Check your inbox and spam folder.</p></div>` : `
          <form class="form" id="forgotForm">
            <label class="field">Email<input name="email" type="email" required autocomplete="email" inputmode="email"></label>
            <div class="row"><button class="primary" type="submit">Send reset link</button></div>
          </form>`}
          <div class="row"><button type="button" class="link" data-mode="signin">Back to sign in</button></div>` : `
          <form class="form" id="signupForm">
            <label class="field">Name<input name="name" required maxlength="60" autocomplete="name"></label>
            <label class="field">Email<input name="email" type="email" required autocomplete="email" inputmode="email"></label>
            ${S.needsPassword ? `<label class="field">Password<input name="password" type="password" required minlength="6" autocomplete="new-password"><span class="note">At least 6 characters</span></label>` : ''}
            <label class="field">Your question ${qSelect('Who am I?')}</label>
            <label class="field">Time zone ${tzSelect(myTz)}</label>
            <div class="row"><button class="primary" type="submit">Create account</button><button type="button" class="link" data-mode="signin">I already have one</button></div>
            <p class="note">Other participants see your name, question and time zone. Your email stays private.</p>
          </form>`}
        ${devTools}`;
      return;
    }

    el.innerHTML = head + `
      <div class="profile-head">
        ${avatar(me, 'big')}
        <div class="profile-id"><h1>${esc(me.name)}</h1><p class="meta">${esc(me.email)}</p>
          <div class="row">
            <label class="btn" for="photoInput">${me.photo ? 'Change photo' : 'Add photo'}</label>
            <input type="file" id="photoInput" accept="image/*" hidden>
            ${me.photo ? '<button class="link danger" id="photoRemove">Remove photo</button>' : ''}
          </div></div>
      </div>
      <form class="form" id="profileForm">
        <label class="field">Name<input name="name" required maxlength="60" value="${esc(me.name)}" autocomplete="name"></label>
        <label class="field">Your question ${qSelect(me.question)}</label>
        <label class="field">Time zone ${tzSelect(me.timezone || myTz)}</label>
        <label class="row" style="font-size:14px;cursor:pointer"><input type="checkbox" name="lookingForBuddy" ${me.lookingForBuddy !== false ? 'checked' : ''}> Show me to others for matching</label>
        <div class="row"><button class="primary" type="submit">Save</button></div>
        <p class="note">Other participants see your photo, name, question and time zone. Your email stays private.</p>
      </form>
      ${devTools}`;
  }

  $('view-account').addEventListener('click', async e => {
    const t = e.target.closest('button'); if(!t) return;
    if(t.dataset.mode){ authMode = t.dataset.mode; resetSentTo = ''; return renderAccount(); }
    if(t.dataset.cal){ calOpen = calOpen === t.dataset.cal ? null : t.dataset.cal; return renderAccount(); }
    if(t.id === 'evNew'){ evFormOpen = true; await renderAccount(); document.querySelector('#evForm [name=title]').focus(); return; }
    if(t.id === 'evCancel'){ evFormOpen = false; return renderAccount(); }
    if(t.dataset.join){ t.disabled = true; const ok = await attempt(() => S.joinEvent(t.dataset.join), 'You\u2019re in. See you there.'); if(!ok) t.disabled = false; return; }
    if(t.dataset.leave){ if(!armed(t, 'Tap again to withdraw')) return; return attempt(() => S.leaveEvent(t.dataset.leave), 'You\u2019re no longer going.'); }
    if(t.dataset.parts){ partsOpen = partsOpen === t.dataset.parts ? null : t.dataset.parts; return renderAccount(); }
    if(t.dataset.evdel){ if(!armed(t, 'Tap again to cancel the event')) return; return attempt(() => S.deleteEvent(t.dataset.evdel), 'Event cancelled. Everyone who joined has been told.'); }
    if(t.dataset.play){ window.TimerSounds && TimerSounds.play(t.dataset.play); return; }
    if(t.id === 'recoveryCancel'){ S.auth.cancelRecovery(); location.hash = '#home'; return; }
    if(t.id === 'signOut'){ await flushAvailability(); return attempt(() => S.auth.signOut(), 'Signed out.'); }
    if(t.id === 'delAcct'){
      if(!armed(t, 'Tap again to delete everything')) return;
      if(await attempt(() => S.auth.deleteAccount(), 'Account deleted.')) location.hash = '#home';
      return;
    }
    if(t.id === 'photoRemove'){ if(!armed(t, 'Tap again to remove')) return; return attempt(() => S.auth.update({ photo:'' }), 'Photo removed.'); }
    if(t.id === 'devSeed') return attempt(() => S.dev.seed(), 'Sample participants added. Check Find a buddy.');
    if(t.id === 'devReset'){ if(armed(t, 'Tap again to reset')) S.dev.reset(); return; }
  });
  // Photos are cropped to a square and shrunk to 256 px so they stay small.
  function squarePhoto(file){
    return new Promise((res, rej) => {
      if(!file || !/^image\//.test(file.type)) return rej(new Error('Please choose an image file.'));
      const url = URL.createObjectURL(file), img = new Image();
      img.onload = () => {
        const side = Math.min(img.naturalWidth, img.naturalHeight), size = 256;
        const c = document.createElement('canvas'); c.width = c.height = size;
        c.getContext('2d').drawImage(img, (img.naturalWidth - side) / 2, (img.naturalHeight - side) / 2, side, side, 0, 0, size, size);
        URL.revokeObjectURL(url); res(c.toDataURL('image/jpeg', 0.85));
      };
      img.onerror = () => { URL.revokeObjectURL(url); rej(new Error('That image couldn\u2019t be opened. Try a JPG or PNG.')); };
      img.src = url;
    });
  }
  $('view-account').addEventListener('change', async e => {
    if(e.target.name === 'sound'){ TimerSounds.set(e.target.value); TimerSounds.play(e.target.value); return; }
    if(e.target.name === 'theme'){ setTheme(e.target.value); toast(`Appearance: ${THEMES.find(x => x[0] === e.target.value)[1]}.`); return; }
    if(e.target.id !== 'photoInput') return;
    const file = e.target.files && e.target.files[0]; e.target.value = '';
    await attempt(async () => S.auth.update({ photo: await squarePhoto(file) }), 'Photo saved.');
  });
  $('view-account').addEventListener('submit', async e => {
    e.preventDefault();
    const f = Object.fromEntries(new FormData(e.target));
    if(e.target.id === 'signinForm'){ if(await attempt(() => S.auth.signIn(f.email, f.password), 'Welcome back.')) location.hash = '#buddy'; }
    if(e.target.id === 'signupForm'){ if(await attempt(() => S.auth.signUp(f), 'Account created.')) location.hash = '#buddy'; }
    if(e.target.id === 'evForm'){
      const start = f.date && f.time ? new Date(`${f.date}T${f.time}`).toISOString() : '';
      const btn = e.target.querySelector('[type=submit]'); btn.disabled = true;
      const ok = await attempt(() => S.createEvent({ ...f, start }), 'Event published. Members have been notified.');
      btn.disabled = false;
      if(ok){ evFormOpen = false; renderAccount(); }
      return;
    }
    if(e.target.id === 'forgotForm'){ if(await attempt(() => S.auth.requestPasswordReset(f.email))){ resetSentTo = f.email.trim(); renderAccount(); } }
    if(e.target.id === 'newPwForm'){ if(await attempt(() => S.auth.setNewPassword(f.password), 'Password changed. You\u2019re signed in.')) location.hash = '#home'; }
    if(e.target.id === 'changePwForm'){ if(await attempt(() => S.auth.setNewPassword(f.password), 'Password changed.')) e.target.reset(); }
    if(e.target.id === 'profileForm') attempt(() => S.auth.update({ name:f.name.trim(), question:f.question, timezone:f.timezone, lookingForBuddy:!!f.lookingForBuddy }), 'Saved.');
  });

  /* ---------- render loop ---------- */
  let renderQueued = false;
  function render(){
    if(renderQueued) return; renderQueued = true;
    queueMicrotask(async () => {
      renderQueued = false; navChrome();
      try{
        if(route === 'home') await renderHome();
        else if(route === 'buddy') await renderBuddy();
        else if(route === 'inspiration') await renderInspiration();
        else if(viewOf(route) === 'account') await renderAccount();
      }catch(e){
        console.error(e);
        if(route !== 'timer') $('view-' + viewOf(route)).innerHTML = `<div class="callout"><p>${esc(e.message || 'Something went wrong.')}</p><div class="row"><button id="retryLoad">Try again</button></div></div>`;
      }
    });
  }
  // Re-render on data changes, but not while someone is typing in a form.
  S.subscribe(() => { const a = document.activeElement; if(a && /^(INPUT|TEXTAREA|SELECT)$/.test(a.tagName) && a.closest('form')){ navChrome(); return; } render(); });
  // Slots slide into the past as time goes on.
  setInterval(() => { if(route === 'buddy' && !pending) render(); }, 5 * 60e3);

  Promise.resolve(S.ready).then(go, go);
})();
