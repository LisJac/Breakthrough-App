/* Calendar entries for a booked dyad: an .ics file (Apple Calendar, Outlook
 * desktop and most phone calendars open it directly) plus links that open
 * Google Calendar or Outlook.com with the event filled in. */
(function(){
  const stamp = iso => new Date(iso).toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');   // 20261014T170000Z
  const endOf = iso => new Date(Date.parse(iso) + 3600e3).toISOString();
  const icsText = s => String(s).replace(/\\/g, '\\\\').replace(/\n/g, '\\n').replace(/([,;])/g, '\\$1');

  function details(slot, me, other){
    const lines = [
      `Online dyad with ${other ? other.name : 'your buddy'}.`,
      me && me.question ? `Your question: ${me.question}` : '',
      other && other.question ? `${other.name.split(' ')[0]}'s question: ${other.question}` : '',
      'Open the Timer in the Breakthrough App when you both are ready.'
    ].filter(Boolean);
    return { title: `Dyad with ${other ? other.name : 'your buddy'}`, body: lines.join('\n'), start: slot, end: endOf(slot) };
  }

  function ics(session, me, other){
    const e = details(session.slot, me, other);
    return [
      'BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Breakthrough App//Dyads//EN', 'CALSCALE:GREGORIAN', 'METHOD:PUBLISH',
      'BEGIN:VEVENT',
      `UID:${session.id}@breakthrough-app`,
      `DTSTAMP:${stamp(new Date().toISOString())}`,
      `DTSTART:${stamp(e.start)}`, `DTEND:${stamp(e.end)}`,
      `SUMMARY:${icsText(e.title)}`, `DESCRIPTION:${icsText(e.body)}`,
      'BEGIN:VALARM', 'ACTION:DISPLAY', `DESCRIPTION:${icsText(e.title)}`, 'TRIGGER:-PT15M', 'END:VALARM',
      'END:VEVENT', 'END:VCALENDAR', ''
    ].join('\r\n');
  }

  function googleUrl(session, me, other){
    const e = details(session.slot, me, other);
    const q = new URLSearchParams({ action:'TEMPLATE', text:e.title, dates:`${stamp(e.start)}/${stamp(e.end)}`, details:e.body });
    return 'https://calendar.google.com/calendar/render?' + q.toString();
  }

  function outlookUrl(session, me, other){
    const e = details(session.slot, me, other);
    const q = new URLSearchParams({ path:'/calendar/action/compose', rru:'addevent', subject:e.title, startdt:e.start, enddt:e.end, body:e.body });
    return 'https://outlook.live.com/calendar/0/deeplink/compose?' + q.toString();
  }

  // Inside the claude.ai preview the page can't hand over .ics files; it can once the app runs on its own.
  const canDownloadIcs = () => !window.claude;

  function downloadIcs(session, me, other){
    const blob = new Blob([ics(session, me, other)], { type:'text/calendar;charset=utf-8' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `dyad-${session.slot.slice(0,10)}.ics`;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 4000);
  }

  window.Calendar = { ics, googleUrl, outlookUrl, downloadIcs, canDownloadIcs };
})();
