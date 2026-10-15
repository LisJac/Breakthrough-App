/* Calendar entries for booked dyads and community events: an .ics file (Apple
 * Calendar, Outlook desktop and most phone calendars open it directly) plus links
 * that open Google Calendar or Outlook.com with the entry filled in.
 * An entry is { uid, start, end, title, body, link } with ISO times. */
(function(){
  const stamp = iso => new Date(iso).toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');   // 20261014T170000Z
  const plus = (iso, min) => new Date(Date.parse(iso) + min * 60e3).toISOString();
  const icsText = s => String(s).replace(/\\/g, '\\\\').replace(/\n/g, '\\n').replace(/([,;])/g, '\\$1');

  function dyadEntry(session, me, other){
    const link = session.meetingUrl || '';
    const body = [
      `Online dyad with ${other ? other.name : 'your buddy'}.`,
      link ? `Video call: ${link}` : '',
      me && me.question ? `Your question: ${me.question}` : '',
      other && other.question ? `${other.name.split(' ')[0]}'s question: ${other.question}` : '',
      'Open the Timer in Breakthrough Online when you both are ready.'
    ].filter(Boolean).join('\n');
    return { uid: session.id, start: session.slot, end: plus(session.slot, 60), title: `Dyad with ${other ? other.name : 'your buddy'}`, body, link };
  }

  function eventEntry(ev){
    const body = [
      ev.host ? `Community event with ${ev.host}.` : 'Community event.',
      ev.meetingUrl ? `Video call: ${ev.meetingUrl}` : '',
      ev.description || '',
      'Breakthrough Online'
    ].filter(Boolean).join('\n\n');
    return { uid: 'event-' + ev.id, start: ev.start, end: plus(ev.start, ev.durationMin || 60), title: ev.title, body, link: ev.meetingUrl || '' };
  }

  function ics(e){
    return [
      'BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Breakthrough Online//Dyads//EN', 'CALSCALE:GREGORIAN', 'METHOD:PUBLISH',
      'BEGIN:VEVENT',
      `UID:${e.uid}@breakthrough-online`,
      `DTSTAMP:${stamp(new Date().toISOString())}`,
      `DTSTART:${stamp(e.start)}`, `DTEND:${stamp(e.end)}`,
      `SUMMARY:${icsText(e.title)}`, `DESCRIPTION:${icsText(e.body)}`,
      ...(e.link ? [`LOCATION:${icsText(e.link)}`, `URL:${e.link}`] : []),
      'BEGIN:VALARM', 'ACTION:DISPLAY', `DESCRIPTION:${icsText(e.title)}`, 'TRIGGER:-PT15M', 'END:VALARM',
      'END:VEVENT', 'END:VCALENDAR', ''
    ].join('\r\n');
  }

  function googleUrl(e){
    const q = new URLSearchParams({ action:'TEMPLATE', text:e.title, dates:`${stamp(e.start)}/${stamp(e.end)}`, details:e.body, location:e.link });
    return 'https://calendar.google.com/calendar/render?' + q.toString();
  }

  function outlookUrl(e){
    const q = new URLSearchParams({ path:'/calendar/action/compose', rru:'addevent', subject:e.title, startdt:e.start, enddt:e.end, body:e.body, location:e.link });
    return 'https://outlook.live.com/calendar/0/deeplink/compose?' + q.toString();
  }

  // Inside the claude.ai preview the page can't hand over .ics files; it can once the app runs on its own.
  const canDownloadIcs = () => !window.claude;

  function downloadIcs(e){
    const blob = new Blob([ics(e)], { type:'text/calendar;charset=utf-8' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `${e.title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40) || 'dyad'}-${e.start.slice(0,10)}.ics`;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 4000);
  }

  window.Calendar = { dyadEntry, eventEntry, ics, googleUrl, outlookUrl, downloadIcs, canDownloadIcs };
})();
