/* Local testing only: adds three sample participants with some evening
 * availability this week, plus a few board entries, so matching can be tried
 * from a single browser. Not loaded in production. */
(function(){
  window.DevSeed = function(db, uid){
    const M = window.Matching;
    const people = [
      { name:'Maya (sample)', email:'maya@example.com', question:'Who am I?', timezone:'Europe/London' },
      { name:'Tom (sample)',  email:'tom@example.com',  question:'What is another?', timezone:'Europe/Berlin' },
      { name:'Inês (sample)', email:'ines@example.com', question:'What is life?', timezone:'Europe/Lisbon' }
    ];
    const days = M.weekDays(0).slice(1);           // tomorrow onwards
    const pick = [[18,19,20],[7,19],[12,13,20]];   // local hours, varied per person
    people.forEach((p, i) => {
      if(db.users.some(u => u.email === p.email)) return;
      const u = Object.assign({ id:uid(), lookingForBuddy:true, createdAt:new Date().toISOString() }, p);
      db.users.push(u);
      const slots = [];
      days.forEach((d, k) => { if((k + i) % 2 === 0) pick[i].forEach(h => slots.push(M.slotFor(d, h))); });
      db.availability[u.id] = slots;
    });
    const author = db.users.find(u => u.email === 'maya@example.com');
    const author2 = db.users.find(u => u.email === 'tom@example.com');
    const items = [
      { type:'book', title:'I Am That', creator:'Sri Nisargadatta Maharaj', link:'', note:'Sample entry. Dialogues on self-enquiry.', authorId:author.id },
      { type:'book', title:'Who Am I?', creator:'Ramana Maharshi', link:'', note:'Sample entry. A short text on the question itself.', authorId:author2.id },
      { type:'film', title:'Samsara', creator:'Ron Fricke', link:'', note:'Sample entry. Wordless film, good after a long day of dyads.', authorId:author.id }
    ];
    items.forEach((it, i) => {
      if(db.inspiration.some(x => x.title === it.title)) return;
      db.inspiration.push(Object.assign({ id:uid(), createdAt:new Date(Date.now() - i * 3600e3).toISOString() }, it));
    });
  };
})();
