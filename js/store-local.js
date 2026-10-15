/* Data layer, browser-only version (used in the claude.ai preview and for offline testing).
 *
 * LOCAL MODE: everything lives in this browser's localStorage, and the signed-in
 * person is remembered per browser tab (sessionStorage). That means you can open
 * two tabs, sign in as two different people, and watch matches appear live.
 *
 * At deploy time this is the only file to replace: keep the same async methods
 * and back them with a real database + email sign-in (e.g. Supabase). Nothing
 * else in the app touches storage directly.
 */
(function(){
  const KEY = 'dyadbuddy.v1';
  const SESSION = 'dyadbuddy.session';
  const listeners = new Set();

  const empty = () => ({ users:[], availability:{}, sessions:[], inspiration:[], notifications:[], notified:{}, events:[] });
  function load(){
    try{ return Object.assign(empty(), JSON.parse(localStorage.getItem(KEY)) || {}); }
    catch(e){ return empty(); }
  }
  let db = load();
  function save(){
    try{ localStorage.setItem(KEY, JSON.stringify(db)); }catch(e){ console.warn('Could not save locally', e); }
    emit();
  }
  function emit(){ listeners.forEach(fn => { try{ fn(); }catch(e){ console.error(e); } }); }
  // Another tab changed the data: reload and re-render.
  window.addEventListener('storage', e => { if(e.key === KEY){ db = load(); emit(); } });

  const uid = () => Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4);
  const clone = x => JSON.parse(JSON.stringify(x));
  const normEmail = e => String(e || '').trim().toLowerCase();
  const tick = v => Promise.resolve(clone(v));   // mimic a network call

  function sessionId(){ try{ return sessionStorage.getItem(SESSION); }catch(e){ return null; } }
  function setSession(id){ try{ id ? sessionStorage.setItem(SESSION, id) : sessionStorage.removeItem(SESSION); }catch(e){} }
  function me(){ const id = sessionId(); return db.users.find(u => u.id === id) || null; }
  function requireMe(){ const u = me(); if(!u) throw new Error('Please sign in first.'); return u; }

  function notify(userId, n){
    db.notifications.unshift(Object.assign({ id:uid(), userId, createdAt:new Date().toISOString(), read:false }, n));
  }

  /* After any availability or session change, find shared future slots that
     nobody has been told about yet and notify both people once. */
  function refreshMatches(){
    const now = Date.now();
    const booked = new Set();
    db.sessions.forEach(s => { booked.add(s.a + '|' + s.slot); booked.add(s.b + '|' + s.slot); });
    const users = db.users.filter(u => u.lookingForBuddy !== false);
    for(let i=0;i<users.length;i++) for(let j=i+1;j<users.length;j++){
      const A = users[i], B = users[j];
      const shared = window.Matching.sharedSlots(db.availability[A.id] || [], db.availability[B.id] || [], now)
        .filter(s => !booked.has(A.id+'|'+s) && !booked.has(B.id+'|'+s));
      const pair = [A.id, B.id].sort().join('|');
      const fresh = shared.filter(s => !db.notified[pair + '|' + s]);
      if(!fresh.length) continue;
      fresh.forEach(s => db.notified[pair + '|' + s] = true);
      notify(A.id, { kind:'match', other:B.id, slots:fresh });
      notify(B.id, { kind:'match', other:A.id, slots:fresh });
    }
  }

  const Store = {
    mode: 'local',
    recovering: false,
    subscribe(fn){ listeners.add(fn); return () => listeners.delete(fn); },

    /* ---------- accounts ---------- */
    auth: {
      current(){ return me() ? Object.assign(clone(me()), { isAdmin:true }) : null; },   // in the preview everyone may create events
      // Local mode has no passwords. At deploy this becomes an email sign-in link.
      async signIn(email){
        const u = db.users.find(x => x.email === normEmail(email));
        if(!u) throw new Error('No account with that email yet. Create one instead.');
        setSession(u.id); emit(); return tick(u);
      },
      async signUp({ name, email, question, timezone }){
        email = normEmail(email); name = String(name || '').trim();
        if(!name) throw new Error('Please add your name.');
        if(!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) throw new Error('Please check the email address.');
        if(db.users.some(u => u.email === email)) throw new Error('That email already has an account. Sign in instead.');
        const u = { id:uid(), name, email, question: question || 'Who am I?', timezone: timezone || Intl.DateTimeFormat().resolvedOptions().timeZone,
                    lookingForBuddy:true, createdAt:new Date().toISOString() };
        db.users.push(u); setSession(u.id); save(); return tick(u);
      },
      async signOut(){ setSession(null); emit(); },
      cancelRecovery(){},
      async update(patch){
        const u = requireMe();
        if('photo' in patch && patch.photo && !/^data:image\/(jpeg|png|webp);base64,/.test(patch.photo)) throw new Error('That photo couldn\u2019t be saved.');
        ['name','question','timezone','lookingForBuddy','photo'].forEach(k => { if(k in patch) u[k] = patch[k]; });
        if(!String(u.name).trim()) throw new Error('Name can’t be empty.');
        refreshMatches(); save(); return tick(u);
      },
      async deleteAccount(){
        const u = requireMe();
        db.users = db.users.filter(x => x.id !== u.id);
        delete db.availability[u.id];
        db.sessions.filter(s => s.a === u.id || s.b === u.id).forEach(s => {
          const other = s.a === u.id ? s.b : s.a;
          notify(other, { kind:'cancelled', other:null, slots:[s.slot], note:'Your buddy deleted their account.' });
        });
        db.sessions = db.sessions.filter(s => s.a !== u.id && s.b !== u.id);
        db.inspiration = db.inspiration.filter(x => x.authorId !== u.id);
        (db.events || []).forEach(e => e.signups = e.signups.filter(x => x.userId !== u.id));
        db.notifications = db.notifications.filter(n => n.userId !== u.id);
        setSession(null); save();
      }
    },

    /* ---------- people (public profile fields only) ---------- */
    async people(){
      return tick(db.users.map(({ id, name, question, timezone, lookingForBuddy, photo }) => ({ id, name, question, timezone, lookingForBuddy, photo })));
    },
    async lookingCount(){ return db.users.filter(u => u.lookingForBuddy !== false && (db.availability[u.id] || []).some(s => Date.parse(s) > Date.now())).length; },

    /* ---------- availability: array of UTC ISO hour starts ---------- */
    async myAvailability(){ const u = me(); return tick(u ? (db.availability[u.id] || []) : []); },
    async setAvailability(slots){
      const u = requireMe();
      db.availability[u.id] = Array.from(new Set(slots)).sort();
      refreshMatches(); save();
    },
    async allAvailability(){ requireMe(); return tick(db.availability); },

    /* ---------- booked dyads ---------- */
    async sessions(){ const u = me(); return tick(u ? db.sessions.filter(s => s.a === u.id || s.b === u.id) : []); },
    async allSessions(){ requireMe(); return tick(db.sessions); },
    async book(otherId, slot){
      const u = requireMe();
      if(db.sessions.some(s => s.slot === slot && [s.a, s.b].some(x => x === u.id || x === otherId)))
        throw new Error('One of you already has a dyad at that time.');
      const s = { id:uid(), a:u.id, b:otherId, slot, createdAt:new Date().toISOString(), meetingUrl:'https://meet.jit.si/breakthrough-dyad-' + uid() + uid() };
      db.sessions.push(s);
      notify(otherId, { kind:'booked', other:u.id, slots:[slot] });
      save(); return tick(s);
    },
    async setMeetingUrl(sessionId, url){
      const u = requireMe();
      const s = db.sessions.find(x => x.id === sessionId && (x.a === u.id || x.b === u.id)); if(!s) return;
      url = String(url || '').trim(); if(url && !/^https?:\/\//i.test(url)) url = 'https://' + url;
      if(!/^https:\/\/[^\s]+\.[^\s]+/i.test(url)) throw new Error('Please paste a full https:// link to your video call.');
      s.meetingUrl = url.slice(0, 400); save();
    },
    async cancel(sessionId){
      const u = requireMe();
      const s = db.sessions.find(x => x.id === sessionId && (x.a === u.id || x.b === u.id));
      if(!s) return;
      db.sessions = db.sessions.filter(x => x.id !== sessionId);
      notify(s.a === u.id ? s.b : s.a, { kind:'cancelled', other:u.id, slots:[s.slot] });
      save();
    },

    /* ---------- notifications ---------- */
    async notifications(){ const u = me(); return tick(u ? db.notifications.filter(n => n.userId === u.id) : []); },
    unreadCount(){ const u = me(); return u ? db.notifications.filter(n => n.userId === u.id && !n.read).length : 0; },
    async markAllRead(){ const u = me(); if(!u) return; db.notifications.forEach(n => { if(n.userId === u.id) n.read = true; }); save(); },

    /* ---------- inspiration board (anyone reads, members post, authors delete) ---------- */
    async inspiration(){ return tick(db.inspiration.slice().sort((a,b) => b.createdAt.localeCompare(a.createdAt))); },
    async addInspiration({ type, title, creator, link, note, image }){
      const u = requireMe();
      title = String(title || '').trim();
      if(!title) throw new Error('Please add a title.');
      if(link && !/^https?:\/\//i.test(link)) link = 'https://' + link;
      const imageUrl = image ? await new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(r.result); r.onerror = rej; r.readAsDataURL(image); }) : '';
      const item = { id:uid(), type:type || 'book', title, creator:String(creator||'').trim(), link:String(link||'').trim(), note:String(note||'').trim(), imageUrl, authorId:u.id, createdAt:new Date().toISOString() };
      db.inspiration.push(item); save(); return tick(item);
    },
    async removeInspiration(id){
      const u = requireMe();
      const item = db.inspiration.find(x => x.id === id);
      if(!item) return;
      if(item.authorId !== u.id) throw new Error('You can only remove your own entries.');
      db.inspiration = db.inspiration.filter(x => x.id !== id); save();
    },

    /* ---------- community events ---------- */
    async events(){
      const u = me(), now = Date.now();
      return tick((db.events || []).filter(e => Date.parse(e.start) + e.durationMin * 60e3 > now)
        .sort((a, b) => a.start.localeCompare(b.start))
        .map(e => { const going = e.signups.some(x => u && x.userId === u.id);
          return { id:e.id, title:e.title, host:e.host, description:e.description, start:e.start, durationMin:e.durationMin, capacity:e.capacity,
                   meetingUrl: u ? e.meetingUrl : '', going:e.signups.length, iAmGoing:going }; }));
    },
    async joinEvent(id){
      const u = requireMe(), e = (db.events || []).find(x => x.id === id);
      if(!e) throw new Error('This event is no longer open.');
      if(e.signups.some(x => x.userId === u.id)) return;
      if(e.capacity && e.signups.length >= e.capacity) throw new Error('This event is full.');
      e.signups.push({ userId:u.id, createdAt:new Date().toISOString() }); save();
    },
    async leaveEvent(id){
      const u = requireMe(), e = (db.events || []).find(x => x.id === id); if(!e) return;
      e.signups = e.signups.filter(x => x.userId !== u.id); save();
    },
    async createEvent({ title, host, start, durationMin, meetingUrl, capacity, description }){
      requireMe();
      title = String(title || '').trim(); if(!title) throw new Error('Please add a title.');
      if(!start || isNaN(Date.parse(start))) throw new Error('Please pick a date and start time.');
      if(Date.parse(start) < Date.now()) throw new Error('That start time has already passed.');
      meetingUrl = String(meetingUrl || '').trim(); if(meetingUrl && !/^https?:\/\//i.test(meetingUrl)) meetingUrl = 'https://' + meetingUrl;
      (db.events = db.events || []).push({ id:uid(), title, host:String(host||'').trim(), description:String(description||'').trim(), start,
        durationMin:+durationMin || 60, meetingUrl, capacity: capacity ? +capacity : null, signups:[] });
      save();
    },
    async deleteEvent(id){ requireMe(); db.events = (db.events || []).filter(e => e.id !== id); save(); },
    async eventParticipants(id){ requireMe(); const e = (db.events || []).find(x => x.id === id); return tick(e ? e.signups : []); },

    /* ---------- local testing only ---------- */
    dev: {
      reset(){ db = empty(); setSession(null); save(); },
      seed(){ window.DevSeed && window.DevSeed(db, uid); refreshMatches(); save(); }
    }
  };

  window.LocalStore = Store;
})();
