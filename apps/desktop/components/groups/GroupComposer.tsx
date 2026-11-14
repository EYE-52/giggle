"use client";
import { useId, useState, type FormEvent } from "react";
import { Icon } from "@/components/Icons";
import { GROUP_COMMUNITIES, GROUP_LANGUAGES, GROUP_TOPICS } from "./GroupDirectory";
import styles from "./Groups.module.css";

export type GroupDraft = {
  title: string;
  description: string;
  alias: string;
  mode: "chat" | "voice" | "video";
  visibility: "open" | "private";
  joinPolicy: "open" | "request" | "invite";
  identityMode: "names" | "aliases";
  publicTopic: string;
  community: string;
  language: string;
};
const defaults: GroupDraft = { title: "", description: "", alias: "", mode: "video", visibility: "open", joinPolicy: "open", identityMode: "aliases", publicTopic: "games", community: "everyone", language: "any" };
const roomTypes = [{ value: "chat", label: "Text chat", icon: Icon.chat }, { value: "voice", label: "Voice", icon: Icon.mic }, { value: "video", label: "Video", icon: Icon.cam }] as const;

export function GroupComposer({ initial, adult = false, editing = false, busy, error, onSubmit, onCancel }: {
  initial?: Partial<GroupDraft>;
  adult?: boolean;
  editing?: boolean;
  busy: boolean;
  error?: string;
  onSubmit: (draft: GroupDraft) => void;
  onCancel: () => void;
}) {
  const id = useId();
  const [draft, setDraft] = useState<GroupDraft>({ ...defaults, ...initial });
  const update = (patch: Partial<GroupDraft>) => setDraft(value => ({ ...value, ...patch }));
  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!busy) onSubmit(draft);
  }
  return <main className={styles.composer}>
    <button type="button" className={styles.back} onClick={onCancel} disabled={busy}><Icon.chevron size={16} color="currentColor" />Back to groups</button>
    <h1>{editing ? "Make it yours." : "Make room for your people."}</h1>
    <p>{editing ? "Update your group’s details and who can join." : "Start a group for the conversations you want to have."}</p>
    <form className={styles.form} onSubmit={submit}>
      <label className={styles.field}>Group name<input autoFocus name="title" required maxLength={32} value={draft.title} onChange={event => update({ title: event.target.value })} placeholder={adult ? "After hours" : "Friday game night"} disabled={busy} /></label>
      <fieldset className={styles.choices}><legend>Room type</legend><div className={styles.choiceRow}>
        {roomTypes.map(type => <label key={type.value}><input type="radio" name={id + "-mode"} value={type.value} checked={draft.mode === type.value} onChange={() => update({ mode: type.value })} disabled={busy || editing} /><type.icon size={20} color="currentColor" /><span>{type.label}</span></label>)}
      </div></fieldset>
      <fieldset className={styles.choices}><legend>Who can find your group?</legend><div className={styles.accessChoices}>
        <label><input type="radio" name={id + "-visibility"} checked={draft.visibility === "open"} onChange={() => update({ visibility: "open", joinPolicy: "open" })} disabled={busy} /><span><strong>Public</strong><small>People can find you in Rooms.</small></span></label>
        <label><input type="radio" name={id + "-visibility"} checked={draft.visibility === "private"} onChange={() => update({ visibility: "private", joinPolicy: "invite" })} disabled={busy} /><span><strong>Invite only</strong><small>Share a link with your people.</small></span></label>
      </div></fieldset>
      {draft.visibility === "open" && <label className={styles.checkRow}><input type="checkbox" checked={draft.joinPolicy === "request"} onChange={event => update({ joinPolicy: event.target.checked ? "request" : "open" })} disabled={busy} /><span>Approve new members before they join</span></label>}
      {!adult && <fieldset className={styles.choices}><legend>Names in this group</legend><div className={styles.choiceRow}>
        <label><input type="radio" name={id + "-identity"} checked={draft.identityMode === "aliases"} onChange={() => update({ identityMode: "aliases" })} disabled={busy || editing} /><span>Nicknames</span></label>
        <label><input type="radio" name={id + "-identity"} checked={draft.identityMode === "names"} onChange={() => update({ identityMode: "names" })} disabled={busy || editing} /><span>Profile names</span></label>
      </div></fieldset>}
      {!editing && (adult || draft.identityMode === "aliases") && <label className={styles.field}>Your nickname<input name="alias" autoComplete="nickname" required minLength={2} maxLength={24} value={draft.alias} onChange={event => update({ alias: event.target.value })} placeholder="What should people call you?" disabled={busy} /><small>This is the name people in this group will see.</small></label>}
      <label className={styles.field}>About this group <span className={styles.optional}>Optional</span><textarea name="description" maxLength={160} rows={2} value={draft.description} onChange={event => update({ description: event.target.value })} placeholder="Give people a feel for the conversation." disabled={busy} /></label>
      <details className={styles.moreOptions} open={editing || undefined}>
        <summary>Topics and preferences<Icon.chevron size={15} color="currentColor" /></summary>
        <div className={styles.filterFields}>
          <label className={styles.field}>Topic<select value={draft.publicTopic} onChange={event => update({ publicTopic: event.target.value })} disabled={busy}>{GROUP_TOPICS.map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
          {adult && <label className={styles.field}>Room community<select value={draft.community} onChange={event => update({ community: event.target.value })} disabled={busy}>{GROUP_COMMUNITIES.map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>}
          <label className={styles.field}>Language<select value={draft.language} onChange={event => update({ language: event.target.value })} disabled={busy}>{GROUP_LANGUAGES.map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
        </div>
      </details>
      {error && <p className={styles.error} role="alert">{error}</p>}
      <div className={styles.formActions}><button className={styles.primary} type="submit" disabled={busy}>{busy ? "Saving…" : editing ? "Save changes" : "Create group"}<Icon.arrowRight size={18} color="currentColor" /></button></div>
    </form>
  </main>;
}
