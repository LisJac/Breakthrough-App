// Emails the person whose dyad was just booked: time in their own time zone,
// who booked it, the video call link, and a calendar file.
// Called by the app right after a booking. Only the person who booked can trigger it,
// and each booking is emailed at most once.
//
// Needs the secret RESEND_API_KEY (resend.com). Sends from hello@breakthrough-online.com
// (domain verified in Resend); EMAIL_FROM overrides the sender if set.
import { createClient } from "npm:@supabase/supabase-js@2.45.4";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json" } });

const esc = (s: string) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]!));
const stamp = (d: Date) => d.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
const icsText = (s: string) => String(s).replace(/\\/g, "\\\\").replace(/\n/g, "\\n").replace(/([,;])/g, "\\$1");

function when(iso: string, tz: string) {
  const d = new Date(iso), end = new Date(d.getTime() + 3600e3);
  try {
    const day = new Intl.DateTimeFormat("en-GB", { timeZone: tz, weekday: "long", day: "numeric", month: "long" }).format(d);
    const t = (x: Date) => new Intl.DateTimeFormat("en-GB", { timeZone: tz, hour: "2-digit", minute: "2-digit" }).format(x);
    return `${day}, ${t(d)}–${t(end)} (${tz.replace(/_/g, " ")})`;
  } catch {
    return d.toUTCString();
  }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  try {
    const { sessionId, appUrl } = await req.json();
    const url = Deno.env.get("SUPABASE_URL")!;
    const caller = createClient(url, Deno.env.get("SUPABASE_ANON_KEY")!, {
      global: { headers: { Authorization: req.headers.get("Authorization") ?? "" } },
    });
    const { data: { user } } = await caller.auth.getUser();
    if (!user) return json({ error: "Please sign in first." }, 401);

    const admin = createClient(url, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
    const { data: s } = await admin.from("sessions")
      .select("id, a, b, slot, meeting_url, booking_email_sent_at").eq("id", sessionId).maybeSingle();
    if (!s || s.a !== user.id) return json({ error: "Not your booking." }, 403);
    if (s.booking_email_sent_at) return json({ ok: true, already: true });

    const key = Deno.env.get("RESEND_API_KEY");
    if (!key) return json({ ok: false, skipped: "No email service connected yet (RESEND_API_KEY)." });

    const { data: people } = await admin.from("profiles").select("id, name, timezone, question").in("id", [s.a, s.b]);
    const booker = people?.find((p) => p.id === s.a), buddy = people?.find((p) => p.id === s.b);
    const { data: buddyUser } = await admin.auth.admin.getUserById(s.b);
    const to = buddyUser?.user?.email;
    if (!to || !buddy) return json({ error: "Buddy not found." }, 404);

    const first = (n?: string) => (n || "your buddy").split(" ")[0];
    const app = typeof appUrl === "string" && /^https:\/\//.test(appUrl) ? appUrl.split("#")[0] : "";
    const time = when(s.slot, buddy.timezone || "UTC");
    const link = s.meeting_url || "";
    const subject = `${first(booker?.name)} booked a dyad with you · ${time.split(",")[0]}`;

    const html = `<!doctype html><html><body style="margin:0;background:#f7f7f5;font-family:Roboto,Helvetica,Arial,sans-serif;color:#37352f">
<div style="max-width:520px;margin:0 auto;padding:32px 20px">
  <div style="font-size:15px;color:#787774;margin-bottom:24px">Breakthrough <span style="color:#1C3AFF">Online</span></div>
  <h1 style="font-size:24px;font-weight:500;line-height:1.25;margin:0 0 16px">${esc(first(booker?.name))} booked a dyad with you</h1>
  <p style="font-size:16px;line-height:1.5;margin:0 0 4px"><strong>${esc(time)}</strong></p>
  <p style="font-size:15px;line-height:1.5;margin:0 0 24px;color:#787774">${esc(booker?.name || "")}${booker?.question ? ` · ${esc(booker.question)}` : ""}</p>
  ${link ? `<p style="margin:0 0 12px"><a href="${esc(link)}" style="display:inline-block;background:#1C3AFF;color:#ffffff;text-decoration:none;padding:12px 20px;border-radius:6px;font-size:15px">Join video call</a></p>
  <p style="font-size:13px;color:#787774;margin:0 0 24px;word-break:break-all">${esc(link)}</p>` : ""}
  <p style="font-size:14px;line-height:1.5;margin:0 0 24px">The attached calendar file adds the dyad to your calendar.${app ? ` Open the timer in <a href="${esc(app)}#timer" style="color:#1C3AFF">Breakthrough Online</a> when you're both ready.` : ""}</p>
  ${app ? `<p style="font-size:13px;color:#787774;margin:0">Can't make it? Cancel it in the app under <a href="${esc(app)}#buddy" style="color:#787774">Find a buddy</a>, and ${esc(first(booker?.name))} will be told.</p>` : ""}
</div></body></html>`;
    const text = `${first(booker?.name)} booked a dyad with you.\n\n${time}\n${link ? `Video call: ${link}\n` : ""}${app ? `\nOpen the app: ${app}\n` : ""}`;

    const ics = [
      "BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//Breakthrough Online//Dyads//EN", "METHOD:PUBLISH",
      "BEGIN:VEVENT", `UID:${s.id}@breakthrough-online`, `DTSTAMP:${stamp(new Date())}`,
      `DTSTART:${stamp(new Date(s.slot))}`, `DTEND:${stamp(new Date(new Date(s.slot).getTime() + 3600e3))}`,
      `SUMMARY:${icsText(`Dyad with ${booker?.name || "your buddy"}`)}`,
      `DESCRIPTION:${icsText(`Online dyad with ${booker?.name || "your buddy"}.${link ? `\nVideo call: ${link}` : ""}`)}`,
      ...(link ? [`LOCATION:${icsText(link)}`, `URL:${link}`] : []),
      "BEGIN:VALARM", "ACTION:DISPLAY", "DESCRIPTION:Dyad", "TRIGGER:-PT15M", "END:VALARM",
      "END:VEVENT", "END:VCALENDAR", "",
    ].join("\r\n");

    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        from: Deno.env.get("EMAIL_FROM") || "Breakthrough Online <hello@breakthrough-online.com>",
        to: [to], subject, html, text,
        attachments: [{ filename: "dyad.ics", content: btoa(unescape(encodeURIComponent(ics))) }],
      }),
    });
    if (!res.ok) return json({ ok: false, error: `Email service: ${res.status} ${await res.text()}` }, 502);

    await admin.from("sessions").update({ booking_email_sent_at: new Date().toISOString() }).eq("id", s.id);
    return json({ ok: true });
  } catch (e) {
    return json({ ok: false, error: String(e) }, 500);
  }
});
