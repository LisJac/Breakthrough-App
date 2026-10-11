/* Dyad timer — ported unchanged from the Dyad Timer artifact.
 * Only changes: audio clips come from js/clips.js, and keyboard shortcuts
 * only act while the Timer tab is open. */
(() => {
  const $ = id => document.getElementById(id);
  const timerVisible = () => !$('view-timer').hidden;
  const BELL_HOLD = 4200; // ms between bowl strike and voice

  // ---------- audio: synthesised singing bowl ----------
  let ctx = null;
  function audio(){ if(!ctx){ ctx = new (window.AudioContext||window.webkitAudioContext)(); } if(ctx.state==='suspended' && !paused) ctx.resume(); return ctx; }
  function bowl(){
    if(!$('bellOn').checked) return;
    const c = audio(), t = c.currentTime, f0 = 196;
    const out = c.createGain(); out.gain.value = .32; out.connect(c.destination);
    const partials = [[1,1,9],[2.71,.5,6],[5.2,.22,4],[8.4,.1,2.6],[12.1,.05,1.6]];
    partials.forEach(([r,amp,dec]) => {
      [-.6,.6].forEach(det => {
        const o = c.createOscillator(), g = c.createGain();
        o.type='sine'; o.frequency.value = f0*r + det*r;
        g.gain.setValueAtTime(0,t);
        g.gain.linearRampToValueAtTime(amp*.5,t+.008);
        g.gain.exponentialRampToValueAtTime(.0001,t+dec);
        o.connect(g); g.connect(out); o.start(t); o.stop(t+dec+.1);
      });
    });
    // soft mallet strike
    const n = c.createBuffer(1, c.sampleRate*.05, c.sampleRate), d = n.getChannelData(0);
    for(let i=0;i<d.length;i++) d[i]=(Math.random()*2-1)*Math.pow(1-i/d.length,3);
    const s = c.createBufferSource(), lp = c.createBiquadFilter(), sg = c.createGain();
    s.buffer=n; lp.type='lowpass'; lp.frequency.value=1800; sg.gain.value=.25;
    s.connect(lp); lp.connect(sg); sg.connect(out); s.start(t);
  }

  // ---------- voice: recorded instructions ----------
  const CLIP_SRC = window.DYAD_CLIPS || {};
  const clips = {};
  async function loadClips(){
    const c = audio();
    await Promise.all(Object.keys(CLIP_SRC).map(async k => {
      if(clips[k]) return;
      try{
        const bin = atob(CLIP_SRC[k]), buf = new Uint8Array(bin.length);
        for(let i=0;i<bin.length;i++) buf[i]=bin.charCodeAt(i);
        clips[k] = await new Promise((res,rej)=>c.decodeAudioData(buf.buffer,res,rej));
      }catch(e){ clips[k]=null; }
    }));
  }
  async function speak(clip, text, tk){
    if(!$('voiceOn').checked) return wait(Math.max(2500,text.length*70), tk);
    await loadClips(); if(tk!==token) return;
    const b = clips[clip];
    if(!b) return wait(Math.max(2500,text.length*70), tk);
    const c = audio(), s = c.createBufferSource(), g = c.createGain();
    g.gain.value = 1; s.buffer = b; s.connect(g); g.connect(c.destination); s.start();
    voiceSrc = s;
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
  let running=false, paused=false, token=0, cur=-1, timerLeft=0, wakeLock=null;
  function wait(ms, tk){
    return new Promise(res=>{
      let left = ms, last = performance.now();
      const id = setInterval(()=>{
        if(tk!==token){ clearInterval(id); return res(false); }
        const now=performance.now(); if(!paused) left -= now-last; last=now;
        if(left<=0){ clearInterval(id); res(true); }
      },50);
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

  async function run(tk, from=0){
    for(let i=from;i<plan.length;i++){
      if(!(await untilUnpaused(tk))) return;
      const s = plan[i]; mark(i);
      if(s.type==='bell'){
        $('phase').textContent = 'Singing bowl';
        bowl();
        if(!(await wait(s.last?6000:BELL_HOLD, tk))) return;
      } else if(s.type==='voice'){
        $('phase').textContent = 'Instruction';
        $('say').textContent = s.text; $('say').classList.remove('quiet');
        await speak(s.clip, s.text, tk); if(tk!==token) return;
      } else {
        $('phase').textContent = s.label;
        $('clock').classList.remove('idle');
        const seg = document.querySelector(`#strip .seg[data-i="${s.turn}"] i`);
        timerLeft = s.dur; let last = performance.now();
        const restAfter = totalTimer(i+1);
        await new Promise(res=>{
          const tick=()=>{
            if(tk!==token) return res();
            const now=performance.now(); if(!paused) timerLeft -= (now-last)/1000; last=now;
            $('clock').textContent = fmt(timerLeft);
            $('remainLabel').textContent = fmt(timerLeft+restAfter)+' left';
            if(seg && !paused) seg.style.width = (100*(1-timerLeft/s.dur))+'%';
            if(timerLeft<=0) return res();
            setTimeout(tick, 200);
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
    audio(); loadClips(); plan = buildPlan(); renderStatic();
    running=true; paused=false; token++; setButtons(); lock(); run(token);
  }
  function stop(msg='Stopped. Press Start to begin again.'){
    token++; running=false; paused=false;
    stopVoice(); if(ctx && ctx.state==='suspended') ctx.resume();
    unlock(); setButtons(); renderStatic();
    $('phase').textContent='Ready'; $('clock').classList.add('idle');
    $('say').textContent=msg; $('say').classList.add('quiet');
    document.querySelectorAll('#seq li').forEach(li=>li.classList.remove('done','now'));
  }
  function finish(){
    running=false; unlock(); setButtons();
    document.querySelectorAll('#seq li').forEach(li=>{li.classList.add('done');li.classList.remove('now');});
    document.querySelectorAll('#strip .seg').forEach(s=>s.classList.add('done'));
    $('phase').textContent='Complete'; $('clock').textContent='0:00'; $('clock').classList.add('idle');
    $('remainLabel').textContent='0:00 left';
    $('say').textContent='The dyad is complete.'; $('say').classList.add('quiet');
  }

  $('startBtn').onclick = () => {
    if(!running) return start();
    paused = !paused;
    if(ctx){ paused ? ctx.suspend() : ctx.resume(); }
    if(paused) $('phase').textContent = 'Paused';
    else if(plan[cur]) $('phase').textContent = plan[cur].type==='timer'?plan[cur].label:plan[cur].type==='bell'?'Singing bowl':'Instruction';
    setButtons();
  };
  $('stopBtn').onclick = () => stop();
  $('restartBtn').onclick = () => { stop(''); start(); };
  $('testBtn').onclick = () => { audio(); bowl(); setTimeout(()=>{ if(!running) speak('middle','Thank you partner. Change over.', token); }, 1500); };
  ['turns','len'].forEach(id=>$(id).addEventListener('input',()=>{ plan=buildPlan(); renderStatic(); }));
  document.addEventListener('visibilitychange',()=>{ if(running && document.visibilityState==='visible' && !wakeLock) lock(); });
  document.addEventListener('keydown',e=>{ if(e.code==='Space' && e.target===document.body && timerVisible() && !$('s3').hidden){ e.preventDefault(); $('startBtn').click(); }});

  $('len').addEventListener('blur',()=>{ const s=parseLen($('len').value); if(s!==null) $('len').value=fmt(s); });

  function jumpTo(i){
    audio(); loadClips(); stopVoice();
    if(!running){ plan = buildPlan(); renderStatic(); lock(); }
    token++; running=true; paused=false;
    if(ctx && ctx.state==='suspended') ctx.resume();
    document.querySelectorAll('#strip .seg i').forEach(x=>x.style.width='');
    const s=plan[i];
    if(s && s.type!=='timer'){ const nt=plan.slice(i).find(x=>x.type==='timer'); if(nt){ $('clock').textContent=fmt(nt.dur); $('remainLabel').textContent=fmt(totalTimer(i))+' left'; } }
    $('clock').classList.remove('idle');
    setButtons(); run(token, i);
  }
  $('seq').addEventListener('click',e=>{ const li=e.target.closest('li[data-i]'); if(li) jumpTo(+li.dataset.i); });
  $('seq').addEventListener('keydown',e=>{ const li=e.target.closest('li[data-i]'); if(li && (e.key==='Enter'||e.key===' ')){ e.preventDefault(); jumpTo(+li.dataset.i); }});
  $('strip').addEventListener('click',e=>{ const seg=e.target.closest('.seg'); if(!seg) return; const t=+seg.dataset.i; const idx=plan.findIndex(s=>s.turn===t); if(idx>=0) jumpTo(idx); });

  // ---------- steps ----------
  function go(n){
    if(n<3 && running) stop();
    ['s1','s2','s3'].forEach((id,i)=>$(id).hidden = i!==n-1);
    window.scrollTo(0,0);
    const f = n===3 ? $('startBtn') : $('go'+(n+1)); if(f) f.focus({preventScroll:true});
  }
  $('go2').onclick=()=>go(2); $('go3').onclick=()=>go(3);
  $('back1').onclick=()=>go(1); $('back2').onclick=()=>go(2);
  document.addEventListener('keydown',e=>{ if(e.key==='Enter' && timerVisible() && !$('s1').hidden && e.target===document.body) go(2); });

  renderStatic();
})();
