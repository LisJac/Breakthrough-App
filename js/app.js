/* App shell: routing and the three data views (Find a buddy, Inspiration, Account).
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
  const TABS = ['home','buddy','inspiration','account','timer'];
  let route = 'home';
  function readRoute(){ const r = (location.hash.replace(/^#\/?/, '') || 'home').split(/[?\/]/)[0]; return TABS.includes(r) ? r : 'home'; }
  function go(){
    const prev = route; route = readRoute();
    TABS.forEach(t => $('view-' + t).hidden = t !== route);
    document.body.classList.toggle('on-home', route === 'home');
    document.querySelectorAll('.tabs a').forEach(a => a.dataset.tab === route ? a.setAttribute('aria-current','page') : a.removeAttribute('aria-current'));
    document.title = route === 'home' ? 'Breakthrough App' : { buddy:'Find a buddy', inspiration:'Inspiration', account:'Account', timer:'Timer' }[route] + ' · Breakthrough App';
    if(prev !== route){ seenUnread = null; openItem = null; window.scrollTo(0, 0); }
    render();
  }
  window.addEventListener('hashchange', go);

  /* ---------- shared bits ---------- */
  function navChrome(){
    const u = S.auth.current(), n = S.unreadCount();
    $('navBadge').hidden = !n; $('navBadge').textContent = n;
    $('navAccount').textContent = u ? u.name.split(' ')[0] : 'Account';
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
        line = `Your next dyad is <strong>${esc(M.slotLabel(next.slot))}</strong> with ${other ? esc(other.name.split(' ')[0]) : 'your buddy'}.`;
        cta = `<a class="btn primary big" href="#buddy">View dyad</a>`;
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
  const SHARE_TEXT = 'The Breakthrough App: find a dyad buddy, use the timer for online dyads and share inspiration with other practitioners of the Breakthrough Intensive.';
  async function shareApp(){
    if(navigator.share){
      try{ await navigator.share({ title:'Breakthrough App', text:SHARE_TEXT, url:APP_URL }); return; }
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
  let week = 0, seenUnread = null, saveT = null, pending = null, calOpen = null;

  async function renderBuddy(){
    const el = $('view-buddy'), me = S.auth.current();
    const head = `<div class="crumb">Breakthrough Intensive <span>/</span> Find a buddy</div>
      <h1>Find a dyad buddy</h1>`;

    if(!me){
      const n = await S.lookingCount();
      el.innerHTML = head + `
        <p class="lede">Mark the hours you're free to sit a dyad online. When someone else is free at the same time, you both get a note with the shared slot, and either of you can book it.</p>
        <dl class="props"><dt>Looking now</dt><dd>${n} participant${n === 1 ? '' : 's'}</dd><dt>Format</dt><dd>One hour block · about 40 minutes of dyad, with the timer</dd></dl>
        ${signInPrompt('You need an account to add your availability and see who you match with.')}`;
      return;
    }

    const [people, avail, sessions, allSessions, notes] = await Promise.all([S.people(), S.allAvailability(), S.sessions(), S.allSessions(), S.notifications()]);
    const byId = Object.fromEntries(people.map(p => [p.id, p]));
    const mine = new Set(pending || avail[me.id] || []);
    const now = Date.now();
    const upcoming = sessions.filter(s => Date.parse(s.slot) + 3600e3 > now).sort((a,b) => a.slot.localeCompare(b.slot));
    const matches = M.matchesFor(me.id, people, Object.assign({}, avail, { [me.id]: [...mine] }), allSessions, now);
    const bookedMine = new Map(upcoming.map(s => [s.slot, s]));
    // How many other people are free in each slot (for the green dot).
    const othersFree = {};
    people.forEach(p => { if(p.id === me.id || p.lookingForBuddy === false) return; (avail[p.id] || []).forEach(s => othersFree[s] = (othersFree[s] || 0) + 1); });

    if(seenUnread === null){ seenUnread = new Set(notes.filter(n => !n.read).map(n => n.id)); if(seenUnread.size) S.markAllRead(); }
    const recent = notes.slice(0, 5);

    const who = id => byId[id] ? esc(byId[id].name) : 'Your buddy';
    const otherTime = (iso, p) => p && p.timezone && p.timezone !== myTz ? `<span class="meta">${esc(M.inZone(iso, p.timezone))} for ${esc(p.name.split(' ')[0])}</span>` : '';

    const noteText = n => {
      const when = n.slots.slice(0, 3).map(M.slotLabel).join(', ') + (n.slots.length > 3 ? ` and ${n.slots.length - 3} more` : '');
      if(n.kind === 'match') return `<strong>New match with ${who(n.other)}.</strong> You're both free ${esc(when)}.`;
      if(n.kind === 'booked') return `<strong>${who(n.other)} booked a dyad with you</strong> for ${esc(when)}.`;
      if(n.kind === 'cancelled') return `<strong>Dyad cancelled</strong> for ${esc(when)}. ${n.note ? esc(n.note) : who(n.other) + ' cancelled it.'}`;
      return '';
    };

    el.innerHTML = head + `
      <p class="lede">Mark the hours you're free. When someone shares a slot with you, you'll both be told here, and either of you can book it.</p>

      ${me.lookingForBuddy === false ? `<div class="callout"><p>You're currently hidden from matching.</p><div class="row"><button id="unpause">Show me to others again</button></div></div>` : ''}

      ${recent.length ? `<section class="section"><h2>Updates</h2><ul class="list">${recent.map(n => `
        <li class="${seenUnread.has(n.id) ? 'unread' : ''}"><div>${noteText(n)}</div><div class="meta">${dateFmt.format(new Date(n.createdAt))}</div></li>`).join('')}</ul></section>` : ''}

      <section class="section"><h2>Your upcoming dyads</h2>
        ${upcoming.length ? `<ul class="list">${upcoming.map(s => { const other = byId[s.a === me.id ? s.b : s.a]; return `
          <li><div class="slot-row"><span class="when">${esc(M.slotLabel(s.slot))}</span>${otherTime(s.slot, other)}</div>
            <div class="person">${avatar(other)}<div><div>${other ? esc(other.name) : 'Former participant'}</div>${other?.question ? `<div class="q">${esc(other.question)}</div>` : ''}</div></div>
            <div class="row"><button data-cal="${s.id}" aria-expanded="${calOpen === s.id}">Save in calendar</button><button class="danger" data-cancel="${s.id}">Cancel dyad</button></div>
            ${calOpen === s.id ? `<div class="cal-options">
              ${C.canDownloadIcs() ? `<button data-ics="${s.id}">Apple Calendar or Outlook app</button>` : ''}
              <a class="btn" href="${esc(C.googleUrl(s, me, other))}" target="_blank" rel="noopener noreferrer">Google Calendar</a>
              <a class="btn" href="${esc(C.outlookUrl(s, me, other))}" target="_blank" rel="noopener noreferrer">Outlook.com</a>
              ${C.canDownloadIcs() ? '' : `<p class="note">Apple Calendar files work once the app is live. In this preview, use Google or Outlook.</p>`}
            </div>` : ''}</li>`; }).join('')}</ul>`
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
    if(t.dataset.cal){ calOpen = calOpen === t.dataset.cal ? null : t.dataset.cal; return renderBuddy(); }
    if(t.dataset.ics){
      const [people, sessions] = await Promise.all([S.people(), S.sessions()]);
      const s = sessions.find(x => x.id === t.dataset.ics), me = S.auth.current(); if(!s) return;
      const other = people.find(p => p.id === (s.a === me.id ? s.b : s.a));
      C.downloadIcs(s, me, other); toast('Calendar file saved. Open it to add the dyad.');
      return;
    }
    if(t.dataset.cancel){
      if(!armed(t, 'Tap again to cancel')) return;
      return attempt(() => S.cancel(t.dataset.cancel), 'Dyad cancelled.');
    }
  });
  async function flushAvailability(){ if(pending){ clearTimeout(saveT); const p = pending; pending = null; await S.setAvailability(p); } }
  window.addEventListener('pagehide', () => { if(pending) S.setAvailability(pending); });

  /* ================= INSPIRATION ================= */
  let filter = 'all', formOpen = false, openItem = null;
  let layout = (() => { try{ return localStorage.getItem('breakthrough.layout') || 'list'; }catch(e){ return 'list'; } })();
  const setLayout = v => { layout = v; try{ localStorage.setItem('breakthrough.layout', v); }catch(e){} };
  const host = url => { try{ return new URL(url).hostname.replace(/^www\./, ''); }catch(e){ return url; } };

  async function renderInspiration(){
    const el = $('view-inspiration'), me = S.auth.current();
    const [items, people] = await Promise.all([S.inspiration(), S.people()]);
    const byId = Object.fromEntries(people.map(p => [p.id, p]));
    const crumb = `<div class="crumb">Breakthrough Intensive <span>/</span> Inspiration</div>`;
    const by = i => { const a = byId[i.authorId]; return `${a ? esc(a.name.split(' ')[0]) : 'Someone'} · ${esc(dateFmt.format(new Date(i.createdAt)))}`; };

    // ---- one entry ----
    const item = openItem && items.find(i => i.id === openItem);
    if(openItem && !item) openItem = null;
    if(item){
      const author = byId[item.authorId];
      el.innerHTML = `${crumb}
        <div><button class="link" id="inspBack">← All inspiration</button></div>
        <article class="detail">
          <span class="tag">${esc(typeLabel(item.type))}</span>
          <h1>${esc(item.title)}</h1>
          ${item.creator ? `<p class="by">${esc(item.creator)}</p>` : ''}
          ${item.note ? `<p class="why">${esc(item.note)}</p>` : `<p class="empty">No note added.</p>`}
          ${item.link ? `<div class="row"><a class="btn primary" href="${esc(item.link)}" target="_blank" rel="noopener noreferrer">Open link</a><span class="meta">${esc(host(item.link))}</span></div>` : ''}
          <hr>
          <div class="person">${avatar(author)}<div><div>Added by ${author ? esc(author.name) : 'a former participant'}</div><div class="meta">${esc(dateFmt.format(new Date(item.createdAt)))}</div></div></div>
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

    el.innerHTML = `${crumb}
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
          <button class="card" data-open="${i.id}">
            <span class="tag">${esc(typeLabel(i.type))}</span>
            <span class="title">${esc(i.title)}</span>
            ${i.creator ? `<span class="by">${esc(i.creator)}</span>` : ''}
            ${i.note ? `<span class="why clamp">${esc(i.note)}</span>` : ''}
            <span class="foot"><span>${by(i)}</span>${i.link ? `<span>${esc(host(i.link))}</span>` : ''}</span>
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
    if(t.id === 'inspCancel'){ formOpen = false; return renderInspiration(); }
    if(t.dataset.remove){
      if(!armed(t, 'Tap again to remove')) return;
      if(await attempt(() => S.removeInspiration(t.dataset.remove), 'Removed.')){ openItem = null; renderInspiration(); }
    }
  });
  $('view-inspiration').addEventListener('submit', async e => {
    if(e.target.id !== 'inspForm') return;
    e.preventDefault();
    const f = Object.fromEntries(new FormData(e.target));
    const ok = await attempt(() => S.addInspiration(f), 'Added to the board.');
    if(ok){ formOpen = false; filter = 'all'; renderInspiration(); }
  });

  /* ================= ACCOUNT ================= */
  let authMode = 'signin';
  const zones = (() => { try{ return Intl.supportedValuesOf('timeZone'); }catch(e){ return [myTz, 'Europe/London', 'Europe/Berlin', 'UTC']; } })();
  const tzSelect = cur => `<select name="timezone">${(zones.includes(cur) ? zones : [cur, ...zones]).map(z => `<option value="${esc(z)}" ${z === cur ? 'selected' : ''}>${esc(z.replace(/_/g,' '))}</option>`).join('')}</select>`;
  const qSelect = cur => `<select name="question">${(QUESTIONS.includes(cur) || !cur ? QUESTIONS : [cur, ...QUESTIONS]).map(q => `<option ${q === cur ? 'selected' : ''}>${esc(q)}</option>`).join('')}</select>`;

  const devTools = `
    <hr>
    <section class="section"><h2>Local testing</h2>
      <p class="note">Data is stored only in this browser while we work locally. To try matching, add sample participants, or open a second tab and sign in as someone else (each tab keeps its own sign-in).</p>
      <div class="row"><button id="devSeed">Add sample participants</button><button class="link danger" id="devReset">Reset all local data</button></div>
    </section>`;

  async function renderAccount(){
    const el = $('view-account'), me = S.auth.current();
    const head = `<div class="crumb">Breakthrough Intensive <span>/</span> Account</div>`;

    if(!me){
      el.innerHTML = head + `
        <h1>${authMode === 'signin' ? 'Sign in' : 'Create your account'}</h1>
        <p class="lede">You need an account to find a dyad buddy or share inspiration. Browsing the board and using the timer work without one.</p>
        ${authMode === 'signin' ? `
          <form class="form" id="signinForm">
            <label class="field">Email<input name="email" type="email" required autocomplete="email" inputmode="email"></label>
            <div class="row"><button class="primary" type="submit">Sign in</button><button type="button" class="link" data-mode="signup">New here? Create an account</button></div>
            <p class="note">While we work locally there's no password. After launch you'll get a sign-in link by email.</p>
          </form>` : `
          <form class="form" id="signupForm">
            <label class="field">Name<input name="name" required maxlength="60" autocomplete="name"></label>
            <label class="field">Email<input name="email" type="email" required autocomplete="email" inputmode="email"></label>
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
      <hr>
      <div class="row"><button id="signOut">Sign out</button><span style="flex:1"></span><button class="link danger" id="delAcct">Delete account</button></div>
      ${devTools}`;
  }

  $('view-account').addEventListener('click', async e => {
    const t = e.target.closest('button'); if(!t) return;
    if(t.dataset.mode){ authMode = t.dataset.mode; return renderAccount(); }
    if(t.id === 'signOut'){ await flushAvailability(); return attempt(() => S.auth.signOut(), 'Signed out.'); }
    if(t.id === 'delAcct'){
      if(!armed(t, 'Tap again to delete everything')) return;
      return attempt(() => S.auth.deleteAccount(), 'Account deleted.');
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
    if(e.target.id !== 'photoInput') return;
    const file = e.target.files && e.target.files[0]; e.target.value = '';
    await attempt(async () => S.auth.update({ photo: await squarePhoto(file) }), 'Photo saved.');
  });
  $('view-account').addEventListener('submit', async e => {
    e.preventDefault();
    const f = Object.fromEntries(new FormData(e.target));
    if(e.target.id === 'signinForm'){ if(await attempt(() => S.auth.signIn(f.email), 'Welcome back.')) location.hash = '#buddy'; }
    if(e.target.id === 'signupForm'){ if(await attempt(() => S.auth.signUp(f), 'Account created.')) location.hash = '#buddy'; }
    if(e.target.id === 'profileForm') attempt(() => S.auth.update({ name:f.name.trim(), question:f.question, timezone:f.timezone, lookingForBuddy:!!f.lookingForBuddy }), 'Saved.');
  });

  /* ---------- render loop ---------- */
  let renderQueued = false;
  function render(){
    if(renderQueued) return; renderQueued = true;
    queueMicrotask(async () => {
      renderQueued = false; navChrome();
      if(route === 'home') await renderHome();
      else if(route === 'buddy') await renderBuddy();
      else if(route === 'inspiration') await renderInspiration();
      else if(route === 'account') await renderAccount();
    });
  }
  // Re-render on data changes, but not while someone is typing in a form.
  S.subscribe(() => { const a = document.activeElement; if(a && /^(INPUT|TEXTAREA|SELECT)$/.test(a.tagName) && a.closest('form')){ navChrome(); return; } render(); });
  // Slots slide into the past as time goes on.
  setInterval(() => { if(route === 'buddy' && !pending) render(); }, 5 * 60e3);

  go();
})();
