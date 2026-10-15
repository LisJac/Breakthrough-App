/* Data layer, shared version: accounts and data live in Supabase.
 * Same methods as js/store-local.js, so the views don't care which one runs.
 * Matching, booking, cancelling and account deletion run as database functions
 * (see supabase/migrations/002_functions.sql); everything else goes through the
 * access rules in 001_tables.sql. */
(function(){
  const cfg = window.APP_CONFIG || {};
  if(window.claude || !window.supabase || !cfg.supabaseUrl || !cfg.supabaseKey) return;

  // Opened from a password-reset email: show "Set a new password" first.
  let recovering = /type=recovery/.test(location.hash);
  const sb = window.supabase.createClient(cfg.supabaseUrl, cfg.supabaseKey, {
    auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true }
  });
  const listeners = new Set();
  const iso = v => new Date(v).toISOString();
  const emit = () => listeners.forEach(fn => { try{ fn(); }catch(e){ console.error(e); } });

  // Cached so the views can ask synchronously who is signed in and how many updates are unread.
  let me = null, unread = 0;

  function fail(error){
    if(!error) return;
    const m = String(error.message || error);
    if(/Invalid login credentials/i.test(m)) throw new Error('Email or password is wrong.');
    if(/already registered/i.test(m)) throw new Error('That email already has an account. Sign in instead.');
    if(/Password should be/i.test(m)) throw new Error('Please use a password with at least 6 characters.');
    if(/rate limit/i.test(m)) throw new Error('Too many emails were sent just now. Please try again in an hour.');
    if(/should be different/i.test(m)) throw new Error('Please choose a password you haven\u2019t used here before.');
    if(/Failed to fetch|NetworkError/i.test(m)) throw new Error('No connection. Check your internet and try again.');
    throw new Error(m.replace(/^.*?:\s*(?=[A-Z])/, ''));
  }
  const profileOut = (p, email) => p && ({
    id: p.id, name: p.name, email: email || '', question: p.question, timezone: p.timezone,
    lookingForBuddy: p.looking_for_buddy, photo: p.photo || ''
  });

  async function loadMe(){
    const { data: { session } } = await sb.auth.getSession();
    const user = session && session.user;
    if(!user){ me = null; unread = 0; return; }
    const { data: p } = await sb.from('profiles').select('*').eq('id', user.id).maybeSingle();
    me = p ? profileOut(p, user.email) : { id:user.id, name:(user.user_metadata||{}).name || 'Participant', email:user.email, question:'Who am I?', timezone:'UTC', lookingForBuddy:true, photo:'' };
    const { data: admin } = await sb.rpc('is_admin');
    me.isAdmin = !!admin;
    await loadUnread();
  }
  async function loadUnread(){
    if(!me){ unread = 0; return; }
    const { count } = await sb.from('notifications').select('id', { count:'exact', head:true }).eq('read', false);
    unread = count || 0;
  }
  function cleanUrl(url){
    url = String(url || '').trim();
    if(url && !/^https?:\/\//i.test(url)) url = 'https://' + url;
    if(!/^https:\/\/[^\s]+\.[^\s]+/i.test(url)) throw new Error('Please paste a full https:// link to your video call.');
    return url.slice(0, 400);
  }
  const requireMe = () => { if(!me) throw new Error('Please sign in first.'); return me; };

  const ready = loadMe().catch(e => console.warn(e));
  sb.auth.onAuthStateChange((event) => {
    if(event === 'PASSWORD_RECOVERY'){ recovering = true; setTimeout(() => loadMe().then(emit), 0); return; }
    if(event === 'SIGNED_IN' || event === 'SIGNED_OUT' || event === 'USER_UPDATED') setTimeout(() => loadMe().then(emit), 0);
  });
  // Pick up new matches and bookings from other people.
  async function poll(){ if(me && document.visibilityState === 'visible'){ const before = unread; await loadUnread(); if(unread !== before) emit(); } }
  setInterval(poll, 30e3);
  document.addEventListener('visibilitychange', () => { if(document.visibilityState === 'visible' && me) loadUnread().then(emit); });

  const Store = {
    mode: 'shared',
    needsPassword: true,
    ready,
    get recovering(){ return recovering; },
    subscribe(fn){ listeners.add(fn); return () => listeners.delete(fn); },

    auth: {
      current(){ return me ? Object.assign({}, me) : null; },
      async signIn(email, password){
        if(!password) throw new Error('Please enter your password.');
        const { error } = await sb.auth.signInWithPassword({ email:String(email||'').trim(), password });
        fail(error); await loadMe(); emit(); return me;
      },
      async signUp({ name, email, password, question, timezone }){
        name = String(name || '').trim();
        if(!name) throw new Error('Please add your name.');
        if(!password || password.length < 6) throw new Error('Please use a password with at least 6 characters.');
        const { data, error } = await sb.auth.signUp({
          email:String(email||'').trim(), password,
          options:{ data:{ name, question:question || 'Who am I?', timezone:timezone || Intl.DateTimeFormat().resolvedOptions().timeZone }, emailRedirectTo: location.origin + location.pathname }
        });
        fail(error);
        if(!data.session) throw new Error('Almost there. Check your email and confirm your address, then sign in.');
        await loadMe(); emit(); return me;
      },
      async signOut(){ await sb.auth.signOut(); me = null; unread = 0; recovering = false; emit(); },
      async requestPasswordReset(email){
        email = String(email || '').trim();
        if(!email) throw new Error('Please enter your email.');
        const { error } = await sb.auth.resetPasswordForEmail(email, { redirectTo: location.origin + location.pathname });
        fail(error);
      },
      async setNewPassword(password){
        if(!password || password.length < 6) throw new Error('Please use a password with at least 6 characters.');
        const { error } = await sb.auth.updateUser({ password });
        fail(error); recovering = false; emit();
      },
      cancelRecovery(){ recovering = false; emit(); },
      async update(patch){
        const u = requireMe(), row = {};
        if('name' in patch){ if(!String(patch.name).trim()) throw new Error('Name can’t be empty.'); row.name = String(patch.name).trim(); }
        if('question' in patch) row.question = patch.question;
        if('timezone' in patch) row.timezone = patch.timezone;
        if('lookingForBuddy' in patch) row.looking_for_buddy = !!patch.lookingForBuddy;
        if('photo' in patch) row.photo = patch.photo || null;
        const { error } = await sb.from('profiles').update(row).eq('id', u.id);
        fail(error);
        if(row.looking_for_buddy) await sb.rpc('refresh_my_matches');
        await loadMe(); emit(); return me;
      },
      async deleteAccount(){
        requireMe();
        const { error } = await sb.rpc('delete_account'); fail(error);
        await sb.auth.signOut({ scope:'local' }); me = null; unread = 0; emit();
      }
    },

    async people(){
      if(!me) return [];
      const { data, error } = await sb.from('profiles').select('id,name,question,timezone,looking_for_buddy,photo');
      fail(error);
      return (data || []).map(p => ({ id:p.id, name:p.name, question:p.question, timezone:p.timezone, lookingForBuddy:p.looking_for_buddy, photo:p.photo || '' }));
    },
    async lookingCount(){ const { data } = await sb.rpc('looking_count'); return data || 0; },

    async myAvailability(){
      if(!me) return [];
      const { data, error } = await sb.from('availability').select('slot').eq('user_id', me.id).gt('slot', new Date().toISOString());
      fail(error); return (data || []).map(r => iso(r.slot));
    },
    async setAvailability(slots){
      requireMe();
      const { error } = await sb.rpc('set_availability', { slots });
      fail(error); await loadUnread(); emit();
    },
    async allAvailability(){
      requireMe();
      const { data, error } = await sb.from('availability').select('user_id,slot').gt('slot', new Date().toISOString()).limit(10000);
      fail(error);
      const out = {};
      (data || []).forEach(r => (out[r.user_id] = out[r.user_id] || []).push(iso(r.slot)));
      return out;
    },

    // Only your own dyads are visible; slots booked by others are already removed from their availability.
    async sessions(){
      if(!me) return [];
      const { data, error } = await sb.from('sessions').select('id,a,b,slot,created_at,meeting_url').order('slot');
      fail(error); return (data || []).map(s => ({ id:s.id, a:s.a, b:s.b, slot:iso(s.slot), createdAt:s.created_at, meetingUrl:s.meeting_url }));
    },
    async allSessions(){ return Store.sessions(); },
    async book(otherId, slot){
      requireMe();
      const { data, error } = await sb.rpc('book_dyad', { other: otherId, slot_at: slot });
      fail(error); emit(); return data;
    },
    async setMeetingUrl(sessionId, url){
      requireMe();
      url = cleanUrl(url);
      const { error } = await sb.from('sessions').update({ meeting_url:url }).eq('id', sessionId);
      fail(error); emit();
    },
    async cancel(sessionId){
      requireMe();
      const { error } = await sb.rpc('cancel_dyad', { session_id: sessionId });
      fail(error); emit();
    },

    async notifications(){
      if(!me) return [];
      const { data, error } = await sb.from('notifications').select('*').order('created_at', { ascending:false }).limit(30);
      fail(error);
      return (data || []).map(n => ({ id:n.id, userId:n.user_id, kind:n.kind, other:n.other, slots:(n.slots || []).map(iso), note:n.note, read:n.read, createdAt:n.created_at }));
    },
    unreadCount(){ return unread; },
    async markAllRead(){ if(!me) return; await sb.rpc('mark_notifications_read'); unread = 0; emit(); },

    async inspiration(){
      const { data, error } = await sb.from('inspiration').select('*').order('created_at', { ascending:false }).limit(500);
      fail(error);
      return (data || []).map(i => ({ id:i.id, type:i.type, title:i.title, creator:i.creator, link:i.link, note:i.note, imageUrl:i.image_url || '', authorId:i.author_id, createdAt:i.created_at }));
    },
    // image: an optional JPEG Blob, already resized by the app.
    async addInspiration({ type, title, creator, link, note, image }){
      const u = requireMe();
      title = String(title || '').trim(); if(!title) throw new Error('Please add a title.');
      link = String(link || '').trim(); if(link && !/^https?:\/\//i.test(link)) link = 'https://' + link;
      let image_url = '', path = '';
      if(image){
        path = `${u.id}/${(crypto.randomUUID ? crypto.randomUUID() : Date.now().toString(36) + Math.random().toString(36).slice(2))}.jpg`;
        const up = await sb.storage.from('inspiration').upload(path, image, { contentType:'image/jpeg', upsert:false });
        if(up.error) throw new Error('The image couldn\u2019t be uploaded. Try a smaller one, or add the entry without it.');
        image_url = sb.storage.from('inspiration').getPublicUrl(path).data.publicUrl;
      }
      const { error } = await sb.from('inspiration').insert({ type:type || 'book', title, creator:String(creator||'').trim(), link, note:String(note||'').trim(), image_url });
      if(error && path) await sb.storage.from('inspiration').remove([path]);
      fail(error); emit();
    },
    async removeInspiration(id){
      requireMe();
      const { data: row } = await sb.from('inspiration').select('image_url').eq('id', id).maybeSingle();
      const { error } = await sb.from('inspiration').delete().eq('id', id);
      fail(error);
      const m = row && row.image_url && row.image_url.match(/\/object\/public\/inspiration\/(.+)$/);
      if(m) await sb.storage.from('inspiration').remove([decodeURIComponent(m[1])]);   // best effort
      emit();
    },

    /* ---------- community events ---------- */
    async events(){
      const { data, error } = await sb.rpc('list_events');
      fail(error);
      return (data || []).map(e => ({ id:e.id, title:e.title, host:e.host, description:e.description, start:iso(e.starts_at), durationMin:e.duration_min,
                                      capacity:e.capacity, meetingUrl:e.meeting_url || '', going:e.going, iAmGoing:e.i_am_going }));
    },
    async joinEvent(id){ requireMe(); const { error } = await sb.rpc('join_event', { p_event:id }); fail(error); emit(); },
    async leaveEvent(id){ const u = requireMe(); const { error } = await sb.from('event_signups').delete().eq('event_id', id).eq('user_id', u.id); fail(error); emit(); },
    async createEvent({ title, host, start, durationMin, meetingUrl, capacity, description }){
      requireMe();
      title = String(title || '').trim(); if(!title) throw new Error('Please add a title.');
      if(!start || isNaN(Date.parse(start))) throw new Error('Please pick a date and start time.');
      if(Date.parse(start) < Date.now()) throw new Error('That start time has already passed.');
      const { error } = await sb.from('events').insert({
        title, host:String(host || '').trim(), description:String(description || '').trim(), starts_at:start,
        duration_min:+durationMin || 60, meeting_url: meetingUrl ? cleanUrl(meetingUrl) : '', capacity: capacity ? +capacity : null
      });
      fail(error); emit();
    },
    async deleteEvent(id){ requireMe(); const { error } = await sb.from('events').delete().eq('id', id); fail(error); emit(); },
    async eventParticipants(id){
      requireMe();
      const { data, error } = await sb.from('event_signups').select('user_id,created_at').eq('event_id', id).order('created_at');
      fail(error); return (data || []).map(r => ({ userId:r.user_id, createdAt:r.created_at }));
    }
  };

  window.SharedStore = Store;
})();
