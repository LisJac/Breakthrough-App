/* Dyad timer, ported from the Dyad Timer artifact.
 * Changes: audio clips come from js/clips.js, keyboard shortcuts only act while
 * the Timer tab is open, and the bell sound can be chosen in Settings. */
(() => {
  const $ = id => document.getElementById(id);
  const timerVisible = () => !$('view-timer').hidden;
  // ---------- audio: synthesised bell sounds (chosen under Account → Settings) ----------
  // Each sound is a few decaying sine partials plus a short strike noise.
  // hold = ms to wait after the strike before the voice starts.
  const SOUNDS = {
    bell:  { label:'Bright bell', hint:'Clear and short (default)', hold:2200, f0:659.3, gain:.28, beat:.8,
             partials:[[1,1,2.6],[2,.32,1.7],[2.76,.42,1.3],[5.4,.16,.7],[8.9,.06,.35]], strike:{ lp:4200, gain:.18 } },
    chime: { label:'Tingsha', hint:'High and shimmering', hold:2600, f0:1396.9, gain:.32, beat:2.6,
             partials:[[1,1,3.2],[2.71,.35,1.6],[5.15,.12,.8]], strike:{ lp:7000, gain:.12 } },
    bowl:  { label:'Singing bowl', hint:'Deep and long', hold:4200, f0:196, gain:.32, beat:.6,
             partials:[[1,1,9],[2.71,.5,6],[5.2,.22,4],[8.4,.1,2.6],[12.1,.05,1.6]], strike:{ lp:1800, gain:.25 } },
    wood:  { label:'Wood block', hint:'A soft knock, no ringing', hold:900, f0:880, gain:.45, beat:0,
             partials:[[1,1,.2],[1.52,.45,.12],[2.4,.2,.07]], strike:{ lp:2500, gain:.3 } }
  };
  const getSound = () => { try{ const k = localStorage.getItem('breakthrough.sound'); return SOUNDS[k] ? k : 'bell'; }catch(e){ return 'bell'; } };
  const setSound = k => { if(SOUNDS[k]) try{ localStorage.setItem('breakthrough.sound', k); }catch(e){} };

  // The audio engine. Browsers pause it when the tab goes to the background, the screen
  // locks or a video call takes over the speakers, and it doesn't restart by itself.
  // So: keep it busy with an inaudible signal while a dyad runs, wake it up before
  // every bell and on every tap, and fall back to a plain <audio> element if it won't wake.
  let ctx = null, keepAlive = null;
  const clips = {};
  function audio(){
    if(!ctx || ctx.state==='closed'){ ctx = new (window.AudioContext||window.webkitAudioContext)(); }
    if(ctx.state!=='running' && !paused) ctx.resume().catch(()=>{});
    return ctx;
  }
  async function wake(){
    const c = audio();
    if(c.state==='running') return true;
    try{ await Promise.race([c.resume(), new Promise(r=>setTimeout(r,400))]); }catch(e){}
    if(c.state==='running') return true;
    // Stuck (e.g. 'interrupted' on iPhone): start a fresh engine.
    try{ c.close(); }catch(e){}
    ctx = null; keepAlive = null;
    const n = audio();
    try{ await Promise.race([n.resume(), new Promise(r=>setTimeout(r,400))]); }catch(e){}
    if(running || together) startKeepAlive();
    return n.state==='running';
  }
  function startKeepAlive(){
    const c = audio();
    if(keepAlive && keepAlive.ctx===c) return;
    try{
      const src = c.createConstantSource ? c.createConstantSource() : null;
      if(!src) return;
      const g = c.createGain(); src.offset.value = 1; g.gain.value = 0.00001;
      src.connect(g); g.connect(c.destination); src.start();
      keepAlive = { ctx:c, src };
    }catch(e){}
  }
  function stopKeepAlive(){ if(together) return; try{ keepAlive && keepAlive.src.stop(); }catch(e){} keepAlive = null; }

  function voiceStrike(c, t, dest, sd){
    const out = c.createGain(); out.gain.value = sd.gain; out.connect(dest);
    sd.partials.forEach(([r, amp, dec]) => {
      (sd.beat ? [-sd.beat, sd.beat] : [0]).forEach(det => {
        const o = c.createOscillator(), g = c.createGain();
        o.type = 'sine'; o.frequency.value = sd.f0 * r + det * r;
        g.gain.setValueAtTime(0, t);
        g.gain.linearRampToValueAtTime(amp * (sd.beat ? .5 : 1), t + .005);
        g.gain.exponentialRampToValueAtTime(.0001, t + dec);
        o.connect(g); g.connect(out); o.start(t); o.stop(t + dec + .1);
      });
    });
    // mallet strike
    const n = c.createBuffer(1, Math.round(c.sampleRate * .04), c.sampleRate), d = n.getChannelData(0);
    for(let i = 0; i < d.length; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / d.length, 3);
    const s = c.createBufferSource(), lp = c.createBiquadFilter(), sg = c.createGain();
    s.buffer = n; lp.type = 'lowpass'; lp.frequency.value = sd.strike.lp; sg.gain.value = sd.strike.gain;
    s.connect(lp); lp.connect(sg); sg.connect(out); s.start(t);
  }

  // Fallback player: each bell pre-rendered to a WAV and played through an <audio> element,
  // which was unlocked by the tap on Start.
  const media = new Audio(); media.preload = 'auto';
  const wavs = {};
  const SILENT = 'data:audio/wav;base64,UklGRiQAAABXQVZFZm10IBAAAAABAAEAQB8AAIA+AAACABAAZGF0YQAAAAA=';
  function unlockMedia(){ try{ if(!media.src) media.src = SILENT; const p = media.play(); p && p.then(()=>media.pause()).catch(()=>{}); }catch(e){} }
  async function wavFor(key){
    if(wavs[key]) return wavs[key];
    const sd = SOUNDS[key] || SOUNDS.bell, sr = 44100;
    const len = Math.max(...sd.partials.map(p=>p[2])) + .3;
    const Off = window.OfflineAudioContext || window.webkitOfflineAudioContext;
    if(!Off) return null;
    const oc = new Off(1, Math.ceil(sr*len), sr);
    voiceStrike(oc, 0, oc.destination, sd);
    const buf = await oc.startRendering();
    const ch = buf.getChannelData(0), out = new DataView(new ArrayBuffer(44 + ch.length*2));
    const w = (o, str) => { for(let i=0;i<str.length;i++) out.setUint8(o+i, str.charCodeAt(i)); };
    w(0,'RIFF'); out.setUint32(4, 36 + ch.length*2, true); w(8,'WAVE'); w(12,'fmt ');
    out.setUint32(16,16,true); out.setUint16(20,1,true); out.setUint16(22,1,true);
    out.setUint32(24,sr,true); out.setUint32(28,sr*2,true); out.setUint16(32,2,true); out.setUint16(34,16,true);
    w(36,'data'); out.setUint32(40, ch.length*2, true);
    for(let i=0;i<ch.length;i++) out.setInt16(44+i*2, Math.max(-1,Math.min(1,ch[i]))*32767, true);
    return (wavs[key] = URL.createObjectURL(new Blob([out], {type:'audio/wav'})));
  }
  async function playMedia(key){
    const url = await wavFor(key); if(!url) return;
    try{ media.src = url; media.currentTime = 0; await media.play(); }catch(e){}
  }

  function strike(key){
    const sd = SOUNDS[key] || SOUNDS.bell;
    const c = audio();
    voiceStrike(c, c.currentTime, c.destination, sd);
  }
  // During a dyad: make sure the engine is awake first; if it won't wake, use the fallback.
  async function ring(key){
    if(await wake()) strike(key); else playMedia(key);
  }
  // Any tap or returning to the tab wakes the engine (a tap is what browsers require).
  ['pointerdown','touchstart','keydown'].forEach(ev => document.addEventListener(ev, () => { if(together && !ctx) { audio(); unlockMedia(); } if(ctx && ctx.state!=='running' && !paused) ctx.resume().catch(()=>{}); }, { passive:true }));
  document.addEventListener('visibilitychange', () => { if(document.visibilityState==='visible' && running && !paused) wake(); });
  function bowl(){ if($('bellOn').checked) ring(getSound()); }
  const bellHold = last => SOUNDS[getSound()].hold + (last ? 1500 : 0);
  // Sound picker on the Timer tab (also in Settings; both use the same saved choice).
  const soundSel = $('soundSel');
  if(soundSel){
    soundSel.innerHTML = Object.entries(SOUNDS).map(([k, s]) => `<option value="${k}">${s.label}</option>`).join('');
    const sync = () => { soundSel.value = getSound(); };
    sync(); window.addEventListener('hashchange', sync);
    soundSel.addEventListener('change', () => { setSound(soundSel.value); strike(soundSel.value); });
    $('soundPlay').addEventListener('click', () => strike(soundSel.value));
  }
  // Used by Settings to list and preview the sounds.
  window.TimerSounds = {
    list: () => Object.entries(SOUNDS).map(([key, s]) => ({ key, label:s.label, hint:s.hint })),
    get: getSound, set: setSound, play: key => strike(key)
  };

  // ---------- voice: recorded instructions ----------
  const CLIP_SRC = window.DYAD_CLIPS || {};
  async function loadClips(){
    const c = audio();
    await Promise.all(Object.keys(CLIP_SRC).map(async k => {
      if(k in clips) return;
      try{
        const bin = atob(CLIP_SRC[k]), buf = new Uint8Array(bin.length);
        for(let i=0;i<bin.length;i++) buf[i]=bin.charCodeAt(i);
        clips[k] = await c.decodeAudioData(buf.buffer);
      }catch(e){ clips[k]=null; }
    }));
  }
  async function speak(clip, text, tk){
    // The step lasts as long as the recording, voice on or off, so shared timers stay in step.
    await loadClips(); if(tk!==token) return;
    const b = clips[clip];
    if(!b) return wait(Math.max(2500,text.length*70), tk);
    if($('voiceOn').checked){
      await wake(); if(tk!==token) return;
      const c = audio(), s = c.createBufferSource(), g = c.createGain();
      g.gain.value = 1; s.buffer = b; s.connect(g); g.connect(c.destination); s.start();
      voiceSrc = s;
    }
    await wait(b.duration*1000 + 400, tk);
    voiceSrc = null;
  }
  let voiceSrc = null;
  function stopVoice(){ try{ voiceSrc && voiceSrc.stop(); }catch(e){} voiceSrc=null; }

  // ---------- plan ----------
  const fmt = s => { s=Math.max(0,Math.ceil(s)); const m=Math.floor(s/60); return m+':'+String(s%60).padStart(2,'0'); };
  function parseLen(v){
    const m=String(v).trim().match(/^(\d{1,2})(?::(\d{1,2}))?$/);
    if(!m || (m[2] && +m[2]>59)) return null;
    const s=(+m[1])*60+(m[2]?+m[2]:0); return s>=10 ? s : null;
  }
  function settings(){
    const t=parseInt($('turns').value,10), ok=t>=1&&t<=20, L=parseLen($('len').value);
    $('turns').classList.toggle('bad',!ok); $('len').classList.toggle('bad',L===null);
    return {turns: ok?t:8, turnSec: L ?? 280};
  }
  function buildPlan(){
    const {turns, turnSec} = settings(); const steps = [];
    for(let i=0;i<turns;i++){
      steps.push({type:'bell', turn:i});
      steps.push({type:'voice', turn:i, clip: i===0?'first':'middle', text: i===0 ? 'Partner A gives partner B the instruction.' : 'Thank you partner. Change over.'});
      steps.push({type:'timer', turn:i, dur:turnSec, label:`Turn ${i+1} · ${i%2===0?'B':'A'} contemplates and communicates`});
    }
    steps.push({type:'bell', turn:turns});
    steps.push({type:'voice', turn:turns, clip:'last', text:'Thank your partner. Close your eyes. Hold your question.'});
    steps.push({type:'timer', turn:turns, dur:60, label:'Silence · hold your question', closing:true});
    steps.push({type:'bell', turn:turns, last:true});
    return steps;
  }

  let plan = buildPlan();
  function renderStatic(){
    const {turns, turnSec} = settings();
    $('total').textContent = '≈ ' + Math.round((turns*(turnSec+12)+60+20)/60) + ' min';
    $('strip').style.gridTemplateColumns = `repeat(${turns},1fr) .35fr`;
    $('strip').innerHTML = Array.from({length:turns+1},(_,i)=>`<div class="seg" data-i="${i}"><i></i></div>`).join('');
    const seq = $('seq'); let elapsed = 0;
    seq.innerHTML = plan.map((s,i)=>{
      const k = s.type==='bell'?'◯':s.type==='voice'?'“':'◷';
      const x = s.type==='bell'?'Singing bowl':s.type==='voice'?`“${s.text}”`:s.label + ' — ' + fmt(s.dur);
      const t = fmt(elapsed); if(s.type==='timer') elapsed+=s.dur;
      return `<li data-i="${i}" tabindex="0" role="button" title="Jump here"><span class="k">${k}</span><span class="x">${x}</span><span class="t">${t}</span></li>`;
    }).join('');
    if(!running){ $('clock').textContent = fmt(turnSec); $('turnLabel').textContent = `Turn 0 of ${turns}`; $('remainLabel').textContent = fmt(totalTimer())+' left'; }
  }
  const totalTimer = (from=0) => plan.slice(from).filter(s=>s.type==='timer').reduce((a,s)=>a+s.dur,0);

  // ---------- runner ----------
  let running=false, paused=false, token=0, cur=-1, timerLeft=0, wakeLock=null, together=null;
  function wait(ms, tk){
    return new Promise(res=>{
      let left = ms, last = performance.now();
      const id = setInterval(()=>{
        if(tk!==token){ clearInterval(id); return res(false); }
        const now=performance.now(); if(!paused) left -= now-last; last=now;
        if(left<=0){ clearInterval(id); res(true); }
      },25);
    });
  }
  async function untilUnpaused(tk){ while(paused && tk===token) await new Promise(r=>setTimeout(r,100)); return tk===token; }

  function mark(i){
    cur=i;
    document.querySelectorAll('#seq li').forEach(li=>{ const n=+li.dataset.i; li.classList.toggle('done',n<i); li.classList.toggle('now',n===i); });
    const s = plan[i]; if(!s) return;
    const {turns} = settings();
    document.querySelectorAll('#strip .seg').forEach(seg=>{ const n=+seg.dataset.i; seg.classList.toggle('done', n<s.turn); if(n!==s.turn) seg.querySelector('i').style.width=''; });
    $('turnLabel').textContent = s.turn<turns ? `Turn ${s.turn+1} of ${turns}` : 'Closing';
  }

  async function run(tk, from=0, firstLeft){
    for(let i=from;i<plan.length;i++){
      if(!(await untilUnpaused(tk))) return;
      const s = plan[i]; mark(i);
      if(s.type==='bell'){
        $('phase').textContent = 'Singing bowl';
        bowl();
        if(!(await wait(bellHold(s.last), tk))) return;
      } else if(s.type==='voice'){
        $('phase').textContent = 'Instruction';
        $('say').textContent = s.text; $('say').classList.remove('quiet');
        await speak(s.clip, s.text, tk); if(tk!==token) return;
      } else {
        $('phase').textContent = s.label;
        $('clock').classList.remove('idle');
        const seg = document.querySelector(`#strip .seg[data-i="${s.turn}"] i`);
        timerLeft = (i===from && firstLeft!=null) ? Math.min(s.dur, firstLeft) : s.dur; let last = performance.now();
        const restAfter = totalTimer(i+1);
        await new Promise(res=>{
          const tick=()=>{
            if(tk!==token) return res();
            const now=performance.now(); if(!paused) timerLeft -= (now-last)/1000; last=now;
            $('clock').textContent = fmt(timerLeft);
            $('remainLabel').textContent = fmt(timerLeft+restAfter)+' left';
            if(seg && !paused) seg.style.width = (100*(1-timerLeft/s.dur))+'%';
            if(timerLeft<=0) return res();
            setTimeout(tick, Math.max(15, Math.min(200, timerLeft*1000)));
          }; tick();
        });
        if(tk!==token) return;
      }
    }
    finish();
  }

  function setButtons(){
    $('startBtn').textContent = !running ? 'Start' : paused ? 'Resume' : 'Pause';
    $('stopBtn').disabled = !running; $('restartBtn').disabled = !running;
    ['turns','len'].forEach(id=>$(id).disabled = running);
  }
  async function lock(){ try{ wakeLock = await navigator.wakeLock?.request('screen'); }catch(e){} }
  function unlock(){ try{ wakeLock?.release(); }catch(e){} wakeLock=null; }

  function start(){
    audio(); unlockMedia(); loadClips(); wavFor(getSound()); plan = buildPlan(); renderStatic();
    running=true; paused=false; token++; setButtons(); lock(); startKeepAlive(); run(token);
  }
  function stop(msg='Stopped. Press Start to begin again.'){
    token++; running=false; paused=false;
    stopVoice(); stopKeepAlive(); if(ctx && ctx.state!=='running') ctx.resume().catch(()=>{});
    unlock(); setButtons(); renderStatic();
    $('phase').textContent='Ready'; $('clock').classList.add('idle');
    $('say').textContent=msg; $('say').classList.add('quiet');
    document.querySelectorAll('#seq li').forEach(li=>li.classList.remove('done','now'));
  }
  function finish(){
    running=false; stopKeepAlive(); unlock(); setButtons();
    document.querySelectorAll('#seq li').forEach(li=>{li.classList.add('done');li.classList.remove('now');});
    document.querySelectorAll('#strip .seg').forEach(s=>s.classList.add('done'));
    $('phase').textContent='Complete'; $('clock').textContent='0:00'; $('clock').classList.add('idle');
    $('remainLabel').textContent='0:00 left';
    $('say').textContent='The dyad is complete.'; $('say').classList.add('quiet');
  }

  function setPaused(p, left){
    if(!running || paused===p) return;
    paused = p;
    if(p && left!=null && plan[cur] && plan[cur].type==='timer') timerLeft = left;   // freeze on the same second as the partner
    if(ctx){ paused ? ctx.suspend().catch(()=>{}) : ctx.resume().catch(()=>{}); }
    if(!paused) unlockMedia();
    if(paused) $('phase').textContent = 'Paused';
    else if(plan[cur]) $('phase').textContent = plan[cur].type==='timer'?plan[cur].label:plan[cur].type==='bell'?'Singing bowl':'Instruction';
    setButtons();
  }
  // Start a moment later when a partner is connected, so both bells ring together.
  const LEAD = 1200;
  let pending = null;
  function startSoon(ms){
    clearTimeout(pending); $('phase').textContent = 'Starting…'; $('startBtn').disabled = true;
    pending = setTimeout(()=>{ pending=null; $('startBtn').disabled = false; start(); }, ms);
  }
  const shared = () => together && together.peers.length > 0;

  $('startBtn').onclick = () => {
    audio(); unlockMedia();
    if(!running){
      if(shared()){ send({ k:'start', ...settings(), delay:LEAD }); return startSoon(LEAD); }
      return start();
    }
    const p = !paused;
    send({ k: p ? 'pause' : 'resume', cur, left: timerLeft });
    setPaused(p, timerLeft);
  };
  $('stopBtn').onclick = () => { clearTimeout(pending); send({ k:'stop' }); stop(); };
  $('restartBtn').onclick = () => {
    stop('');
    if(shared()){ send({ k:'start', ...settings(), delay:LEAD }); startSoon(LEAD); } else start();
  };
  $('testBtn').onclick = () => { audio(); unlockMedia(); bowl(); setTimeout(()=>{ if(!running) speak('middle','Thank you partner. Change over.', token); }, 1500); };
  ['turns','len'].forEach(id=>$(id).addEventListener('input',()=>{ plan=buildPlan(); renderStatic(); if(!running) send({ k:'settings', turns:$('turns').value, len:$('len').value }); }));
  document.addEventListener('visibilitychange',()=>{ if(running && document.visibilityState==='visible' && !wakeLock) lock(); });
  document.addEventListener('keydown',e=>{ if(e.code==='Space' && e.target===document.body && timerVisible() && !$('s3').hidden){ e.preventDefault(); $('startBtn').click(); }});

  $('len').addEventListener('blur',()=>{ const s=parseLen($('len').value); if(s!==null) $('len').value=fmt(s); });

  function jumpTo(i, left){
    audio(); unlockMedia(); loadClips(); stopVoice();
    if(!running){ plan = buildPlan(); renderStatic(); lock(); }
    token++; running=true; paused=false; startKeepAlive();
    if(ctx && ctx.state!=='running') ctx.resume().catch(()=>{});
    document.querySelectorAll('#strip .seg i').forEach(x=>x.style.width='');
    const s=plan[i];
    if(s && s.type!=='timer'){ const nt=plan.slice(i).find(x=>x.type==='timer'); if(nt){ $('clock').textContent=fmt(nt.dur); $('remainLabel').textContent=fmt(totalTimer(i))+' left'; } }
    $('clock').classList.remove('idle');
    setButtons(); run(token, i, left);
  }
  const userJump = i => { send({ k:'jump', i }); jumpTo(i); };
  $('seq').addEventListener('click',e=>{ const li=e.target.closest('li[data-i]'); if(li) userJump(+li.dataset.i); });
  $('seq').addEventListener('keydown',e=>{ const li=e.target.closest('li[data-i]'); if(li && (e.key==='Enter'||e.key===' ')){ e.preventDefault(); userJump(+li.dataset.i); }});
  $('strip').addEventListener('click',e=>{ const seg=e.target.closest('.seg'); if(!seg) return; const t=+seg.dataset.i; const idx=plan.findIndex(s=>s.turn===t); if(idx>=0) userJump(idx); });

  // ---------- steps ----------
  function go(n){
    if(n<3 && running) stop();
    ['s1','s2','s3'].forEach((id,i)=>$(id).hidden = i!==n-1);
    window.scrollTo(0,0);
    const f = n===3 ? $('startBtn') : $('go'+(n+1)); if(f) f.focus({preventScroll:true});
  }
  $('go2').onclick=()=>go(2); $('go3').onclick=()=>go(3);
  $('back1').onclick=()=>go(1); $('back2').onclick=()=>go(2);
  // Step 1: back to wherever the timer was opened from.
  $('back0').onclick=()=>{ if(history.length > 1) history.back(); else location.hash = '#home'; };
  document.addEventListener('keydown',e=>{ if(e.key==='Enter' && timerVisible() && !$('s1').hidden && e.target===document.body) go(2); });

  // ---------- together: one timer for both partners ----------
  // Step 1: "Invite your partner" copies a link. The partner opens it and is in.
  // From then on Start, Pause, Stop, Restart and jumps happen on both devices;
  // each person hears the bell and voice on their own device.
  const T = window.TimerSync;
  const hashParam = k => { const m = location.hash.match(new RegExp('[?&]' + k + '=([^&]+)')); return m ? decodeURIComponent(m[1]) : ''; };
  const myName = () => { try{ return (window.Store?.auth.current()?.name || '').split(' ')[0]; }catch(e){ return ''; } };
  const linkFor = code => location.origin + location.pathname + '#timer?room=' + code + '&invite=1' + (myName() ? '&from=' + encodeURIComponent(myName()) : '');
  const escT = v => String(v).replace(/[&<>"']/g, c => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[c]));
  let invite = null, copied = false, iInvited = false;

  function send(msg){ if(together) try{ together.conn.send(msg); }catch(e){} }

  function receive(m){
    if(!m || !m.k) return;
    if(m.k==='settings' && !running){ $('turns').value = m.turns; $('len').value = m.len; plan = buildPlan(); renderStatic(); }
    if(m.k==='start'){
      $('turns').value = m.turns; if(typeof m.turnSec==='number') $('len').value = fmt(m.turnSec);
      if(running) stop('');
      plan = buildPlan(); renderStatic();
      if($('s3').hidden) go(3);
      startSoon(Math.max(0, (m.delay || 0) - 80));   // ~80 ms for the message to arrive
    }
    if(m.k==='pause') setPaused(true, m.cur===cur ? m.left : null);
    if(m.k==='resume') setPaused(false);
    if(m.k==='stop'){ clearTimeout(pending); pending=null; $('startBtn').disabled=false; if(running) stop(); }
    if(m.k==='jump'){ if($('s3').hidden) go(3); jumpTo(m.i); }
    if(m.k==='state' && !running){
      // Joined while the partner's timer was already running: catch up.
      $('turns').value = m.turns; $('len').value = fmt(m.turnSec); plan = buildPlan(); renderStatic();
      if($('s3').hidden) go(3);
      jumpTo(m.cur, m.left);
      if(m.paused) setPaused(true, m.left);
    }
  }

  function join(code){
    leave(true);
    audio(); unlockMedia();            // needs a tap: lets the bell ring later without one
    together = { code, peers: [], conn: null };
    together.conn = T.join(code, {
      name: myName() || 'Your partner',
      onMessage: receive,
      onPeers: list => {
        if(!together) return;
        const before = together.peers.length;
        together.peers = list;
        if(list.length > before && running){
          const s = plan[cur];
          send({ k:'state', ...settings(), cur, left: s && s.type==='timer' ? timerLeft : null, paused });
        }
        renderTogether();
      }
    });
    startKeepAlive();
    invite = null;
    renderTogether();
  }
  function leave(quiet){
    if(!together) return;
    try{ together.conn.leave(); }catch(e){}
    together = null; iInvited = false;
    if(!running) stopKeepAlive();
    if(!quiet){ if(/room=/.test(location.hash)) history.replaceState(null, '', '#timer'); renderTogether(); }
  }
  async function copyLink(){
    const url = linkFor(together.code);
    let ok = true;
    try{ await navigator.clipboard.writeText(url); }catch(err){ ok = false; }
    if(!ok){ try{ if(navigator.share){ await navigator.share({ title:'Shared dyad timer', url }); ok = true; } }catch(e){} }
    if(!ok) window.prompt('Copy this link and send it to your partner:', url);
    copied = true; renderTogether(); setTimeout(()=>{ copied=false; renderTogether(); }, 2500);
  }

  const names = list => { const n = [...new Set(list.map(p => p.name || 'Your partner'))]; return n.length < 3 ? n.join(' and ') : n.slice(0, -1).join(', ') + ' and ' + n.at(-1); };

  function renderTogether(){
    const one = $('together1'), three = $('together3'); if(!one || !three) return;
    if(!T || !T.available()){ one.hidden = three.hidden = true; return; }
    one.hidden = false;
    if(invite){
      // Arrived from a partner's link and hasn't tapped yet (browsers need a tap before sound).
      const html = `<div class="tg-invite"><p>${invite.from ? `<strong>${escT(invite.from)}</strong> invited you` : 'You were invited'} to a shared timer.</p>
        <button class="primary" data-tg="accept">Join</button></div>`;
      one.innerHTML = three.innerHTML = html; three.hidden = false; one.className = three.className = 'together on'; return;
    }
    if(!together){
      one.className = 'together';
      one.innerHTML = `<button data-tg="invite">Invite your partner</button>
        <p class="note">For online dyads. You both hear the bell, and Start, Pause and Stop happen for both of you.</p>`;
      three.hidden = true; three.innerHTML = ''; return;
    }
    const p = together.peers;
    const status = p.length
      ? `<span class="tg-dot live" aria-hidden="true"></span><span><strong>${escT(names(p))}</strong> ${p.length === 1 ? 'is' : 'are'} connected.</span>`
      : `<span class="tg-dot" aria-hidden="true"></span><span>${copied ? 'Link copied. Paste it into the chat of your video call.' : 'Waiting for your partner …'}</span>`;
    const actions = `${!p.length ? `<button class="link" data-tg="copy">${copied ? 'Copied' : 'Copy link again'}</button>` : ''}<button class="link muted" data-tg="leave">${p.length ? 'Disconnect' : 'Cancel'}</button>`;
    one.className = three.className = 'together on';
    one.innerHTML = three.innerHTML = `<div class="tg-head">${status}</div><div class="tg-row">${actions}</div>`;
    three.hidden = false;
  }

  document.addEventListener('click', async e => {
    const b = e.target.closest('[data-tg]'); if(!b) return;
    const a = b.dataset.tg;
    if(a==='invite'){ join(T.newCode()); iInvited = true; await copyLink(); }
    if(a==='accept'){ const code = invite.code; join(code); }
    if(a==='copy') copyLink();
    if(a==='leave') leave();
  });

  // Opened a link with #timer?room=CODE (from a partner, or "Open shared timer" on a booked dyad).
  function checkInvite(){
    const code = T ? T.clean(hashParam('room')) : '';
    if(!code || (together && together.code === code)) return;
    if(location.hash.replace(/^#\/?/, '').split(/[?\/&=]/)[0] !== 'timer') return;
    const fromPartner = !!hashParam('invite');
    if(navigator.userActivation?.hasBeenActive){ join(code); }      // already tapped in the app: join right away
    else invite = { code, from: hashParam('from') };
    // A partner's link skips the first two steps; a booked dyad starts at step 1 together.
    go(fromPartner ? 3 : 1);
    renderTogether();
  }
  window.addEventListener('hashchange', checkInvite);
  checkInvite();
  renderTogether();
  renderStatic();
})();
