/* Shared timer: connects two (or more) timers in a "room" so Start, Pause, Stop and
 * jumps happen on every device at once. Nothing is stored; messages are passed live.
 *
 * Live site: Supabase Realtime broadcast + presence (no database table needed).
 * Preview / no Supabase: BroadcastChannel, so two windows of the same browser can
 * be tested side by side.
 *
 * TimerSync.join(room, { name, onMessage, onPeers }) -> { send(msg), leave() }
 * onPeers gets the list of *other* people in the room: [{ id, name }]. */
(() => {
  const me = Math.random().toString(36).slice(2, 10);

  function viaSupabase(room, { name, onMessage, onPeers }){
    const S = window.SharedStore;
    const ch = S.realtimeChannel('timer-' + room, { config: { broadcast: { self: false }, presence: { key: me } } });
    const peers = () => onPeers(Object.values(ch.presenceState()).flat()
      .filter(p => p.id !== me).map(p => ({ id: p.id, name: p.name })));
    ch.on('broadcast', { event: 't' }, ({ payload }) => onMessage(payload));
    ch.on('presence', { event: 'sync' }, peers);
    ch.subscribe(status => { if(status === 'SUBSCRIBED') ch.track({ id: me, name }); });
    return {
      send: msg => ch.send({ type: 'broadcast', event: 't', payload: msg }),
      leave: () => { try{ ch.untrack(); }catch(e){} S.removeChannel(ch); }
    };
  }

  function viaBroadcastChannel(room, { name, onMessage, onPeers }){
    const bc = new BroadcastChannel('breakthrough.timer.' + room);
    const seen = new Map();   // id -> { name, at }
    const report = () => onPeers([...seen].map(([id, p]) => ({ id, name: p.name })));
    const hello = k => bc.postMessage({ sys: k, id: me, name });
    bc.onmessage = ({ data }) => {
      if(data.sys){
        if(data.id === me) return;
        if(data.sys === 'bye') seen.delete(data.id);
        else { const isNew = !seen.has(data.id); seen.set(data.id, { name: data.name, at: Date.now() }); if(data.sys === 'hi' && isNew) hello('here'); }
        return report();
      }
      onMessage(data.msg);
    };
    hello('hi');
    const beat = setInterval(() => {
      hello('here');
      const old = [...seen].filter(([, p]) => Date.now() - p.at > 8000);
      if(old.length){ old.forEach(([id]) => seen.delete(id)); report(); }
    }, 3000);
    const bye = () => hello('bye');
    window.addEventListener('pagehide', bye);
    return {
      send: msg => bc.postMessage({ msg }),
      leave: () => { bye(); clearInterval(beat); window.removeEventListener('pagehide', bye); bc.close(); }
    };
  }

  window.TimerSync = {
    available: () => !!(window.SharedStore?.realtimeChannel || window.BroadcastChannel),
    join(room, opts){
      return window.SharedStore?.realtimeChannel ? viaSupabase(room, opts) : viaBroadcastChannel(room, opts);
    },
    // Short codes people can read out loud: no 0/O, 1/I/L.
    newCode(){ const a = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'; return Array.from({ length: 6 }, () => a[Math.floor(Math.random() * a.length)]).join(''); },
    // A booked dyad gets a fixed room, so both people land in the same one.
    codeFor(sessionId){ return String(sessionId).replace(/[^a-z0-9]/gi, '').slice(0, 6).toUpperCase(); },
    clean: c => String(c || '').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 12)
  };
})();
