// Event detail: when & where, "Are you coming?", who's coming (Event with RSVP design).
import { useState } from "react";
import { Clock, MapPin } from "lucide-react";
import { useRsvps } from "@/api/hooks";
import type { IssueDetail, Rsvp } from "@/api/types";
import { useBranch } from "@/app/BranchContext";
import { Avatar, DateBlock, TypeBadge } from "@/components/badges";
import { Button, Card, Dialog, inputClass } from "@/components/ui";
import { describeReminders, formatTime, inZone, zoneSuffix } from "@/lib/dates";
import { rsvpLabel } from "@/lib/labels";
import { targetName, useGroupDirectory } from "@/lib/items";
import { usePeople } from "@/people/usePeople";
import { RsvpButtons } from "./RsvpButtons";

export function EventHeader({ issue }: { issue: IssueDetail }) {
  const { zoneOf } = useBranch();
  const people = usePeople();
  const ev = issue.event!;
  const zone = zoneOf(issue.branch_id);
  const suffix = zoneSuffix(zone);
  return (
    <Card className="flex flex-col gap-5 p-6 sm:flex-row sm:items-center">
      <DateBlock date={inZone(ev.starts_at, zone)} />
      <div className="min-w-0">
        <div className="flex items-center gap-3">
          <TypeBadge type="event" />
          <span className="font-mono text-text-3">{issue.key}</span>
        </div>
        <h1 className={`mt-2 text-[30px] leading-9 font-bold break-anywhere sm:text-[38px] sm:leading-[46px] ${issue.state === "cancelled" ? "line-through" : ""}`}>
          {issue.title}
        </h1>
        <div className="mt-2 flex flex-wrap items-center gap-x-6 gap-y-1 text-[17px] text-text-2">
          <span className="inline-flex items-center gap-2">
            <Clock className="size-5" aria-hidden />
            {ev.all_day ? "All day" : `${formatTime(ev.starts_at, zone)}–${formatTime(ev.ends_at, zone)}`}
            {suffix && ` (${suffix} time)`}
          </span>
          {ev.location && (
            <span className="inline-flex items-center gap-2">
              <MapPin className="size-5" aria-hidden /> {ev.location}
            </span>
          )}
          <span>Organised by {people.short(issue.created_by)}</span>
        </div>
      </div>
    </Card>
  );
}

export function RsvpCard({ issue }: { issue: IssueDetail }) {
  const ev = issue.event!;
  const [note, setNote] = useState("");
  const ended = new Date(ev.ends_at).getTime() < Date.now();
  if (ev.my_rsvp == null) return null;
  const closed = issue.state !== "open" || ended;
  return (
    <Card className="p-6">
      <h2 className="mb-4 text-[20px] font-semibold">Are you coming?</h2>
      <RsvpButtons issueId={issue.id} current={ev.my_rsvp} note={note} disabled={closed} size="lg" />
      {!closed && (
        <>
          <label className="mt-5 block" htmlFor="rsvp-note">
            Note for the organiser <span className="text-text-3">(optional)</span>
          </label>
          <input
            id="rsvp-note"
            value={note}
            onChange={(e) => setNote(e.target.value)}
            maxLength={500}
            placeholder="e.g. I'll arrive at 18:30 after the bus duty"
            className={`${inputClass} mt-2`}
          />
          <p className="mt-3 text-[14px] text-text-2">
            The note is sent with your reply.
            {ev.reminders.length > 0 && ` You'll get a reminder ${describeReminders(ev.reminders)} before.`} If the time changes, you'll be told.
          </p>
        </>
      )}
      {closed && <p className="mt-3 text-text-2">{issue.state === "cancelled" ? "This event was cancelled." : "This event has ended, so replies are closed."}</p>}
    </Card>
  );
}

export function WhosComing({ issue }: { issue: IssueDetail }) {
  const ev = issue.event!;
  const people = usePeople();
  const groups = useGroupDirectory();
  const { branchById } = useBranch();
  const rsvps = useRsvps(issue.id);
  const [all, setAll] = useState(false);
  const c = ev.rsvp_counts;
  const total = c.going + c.maybe + c.declined + c.pending;
  const invited = issue.targets.map((t) => targetName(t, people, groups, (id) => branchById.get(id)?.name ?? "Branch")).join(", ");
  const going = (rsvps.data?.items ?? []).filter((r) => r.response === "going");
  const tile = (n: number, label: string, fg: string, bg: string, dashed?: boolean) => (
    <div className={`rounded-[12px] px-4 py-3 ${dashed ? "border-2 border-dashed border-border-strong" : ""}`} style={{ background: bg, color: fg }}>
      <div className="text-[26px] leading-8 font-bold tabular">{n}</div>
      <div>{label}</div>
    </div>
  );
  return (
    <Card className="p-6">
      <div className="mb-4 flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-[20px] font-semibold">Who's coming</h2>
        <span className="text-text-2">
          Invited: {invited || "nobody yet"} · {total} {total === 1 ? "person" : "people"}
        </span>
      </div>
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        {tile(c.going, "Going", "var(--success)", "var(--success-soft)")}
        {tile(c.maybe, "Maybe", "var(--warning)", "var(--warning-soft)")}
        {tile(c.declined, "Can't go", "var(--text)", "var(--sunken)")}
        {tile(c.pending, "No reply yet", "var(--text)", "transparent", true)}
      </div>
      {going.length > 0 && (
        <div className="mt-4 flex flex-wrap gap-2">
          {going.slice(0, 4).map((r) => (
            <span key={r.user_id} className="inline-flex items-center gap-2 rounded-full bg-sunken py-1 pr-4 pl-1">
              <Avatar first={r.first_name} last={r.last_name} id={r.user_id} size={32} />
              {r.first_name} {r.last_name[0]}.
            </span>
          ))}
          <Button className="rounded-full" onClick={() => setAll(true)}>
            See all {total}
          </Button>
        </div>
      )}
      {going.length === 0 && total > 0 && (
        <Button className="mt-4" onClick={() => setAll(true)}>
          See everyone
        </Button>
      )}
      <Dialog open={all} onOpenChange={setAll} title="Everyone invited" wide>
        <RsvpList items={rsvps.data?.items ?? []} />
      </Dialog>
    </Card>
  );
}

function RsvpList({ items }: { items: Rsvp[] }) {
  const order = { going: 0, maybe: 1, declined: 2, pending: 3 };
  return (
    <ul className="divide-y divide-border">
      {[...items]
        .sort((a, b) => order[a.response] - order[b.response] || a.first_name.localeCompare(b.first_name))
        .map((r) => (
          <li key={r.user_id} className="flex items-start gap-3 py-3">
            <Avatar first={r.first_name} last={r.last_name} id={r.user_id} size={32} />
            <div className="min-w-0 flex-1">
              <div>
                {r.first_name} {r.last_name}
              </div>
              {r.note && <div className="text-[14px] text-text-2">“{r.note}”</div>}
            </div>
            <span className="text-[14px] text-text-2">{rsvpLabel[r.response]}</span>
          </li>
        ))}
    </ul>
  );
}
