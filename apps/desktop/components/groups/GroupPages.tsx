"use client";
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { GroupDirectory, EMPTY_GROUP_FILTERS, groupLabel, type DirectoryFilters, type GroupListing } from "./GroupDirectory";
import { GroupComposer, type GroupDraft } from "./GroupComposer";
import { Modal } from "@/components/Modal";
import { pollWhileVisible } from "@/lib/poll";
import { readGameIntent, readGamesIntent, withGameIntent } from "@/lib/gameIntent";
import styles from "./GroupDetail.module.css";
import buttons from "./Groups.module.css";

export type GroupPerson = { id: string; alias: string; owner?: boolean };
export type GroupDetails = {
  group: GroupListing & Partial<GroupDraft>;
  status: "owner" | "member" | "pending" | "none";
  members?: GroupPerson[];
  requests?: GroupPerson[];
  bans?: GroupPerson[];
};
export type GroupAdapter = {
  list: (filters: DirectoryFilters, signal: AbortSignal) => Promise<GroupListing[]>;
  get: (id: string, invite: string | undefined, signal?: AbortSignal) => Promise<GroupDetails>;
  create: (draft: GroupDraft) => Promise<string>;
  save: (id: string, draft: GroupDraft) => Promise<void>;
  join: (id: string, alias: string, invite?: string) => Promise<void>;
  open: (id: string) => Promise<string>;
  invite: (id: string) => Promise<string>;
  leave: (id: string, successor?: string) => Promise<void>;
  remove: (id: string) => Promise<void>;
  moderate: (id: string, action: "approve" | "reject" | "kick" | "unban", memberId: string) => Promise<void>;
  cancel?: (id: string) => Promise<void>;
};
type Confirmation = { action: "leave" | "delete" | "kick"; person?: GroupPerson };
const message = (error: unknown) => error instanceof Error ? error.message : "Could not complete this request. Try again.";
function inviteToken() {
  const value = new URLSearchParams(window.location.hash.slice(1)).get("invite");
  return value && /^[a-zA-Z0-9_-]{16,256}$/.test(value) ? value : undefined;
}
function MemberList({ people, actions }: { people: GroupPerson[]; actions: (person: GroupPerson) => ReactNode }) {
  return <ul className={styles.memberList}>{people.map(person => <li className={styles.row} key={person.id}>
    <span>{person.alias}{person.owner && <small>Owner</small>}</span><div>{actions(person)}</div>
  </li>)}</ul>;
}

export function GroupPages({ adapter, adult = false, id, creating = false }: {
  adapter: GroupAdapter; adult?: boolean; id?: string; creating?: boolean;
}) {
  const router = useRouter();
  const base = adult ? "/adult/groups" : "/groups", directory = adult ? base : "/discover";
  const [filters, setFilters] = useState<DirectoryFilters>(EMPTY_GROUP_FILTERS);
  const [search, setSearch] = useState("");
  useEffect(() => {
    const timer = setTimeout(() => setSearch(filters.search.trim()), 250);
    return () => clearTimeout(timer);
  }, [filters.search]);
  const requestFilters = useMemo(() => ({ ...filters, search }),
    [search, filters.mode, filters.publicTopic, filters.community, filters.language, filters.mine]);
  const [groups, setGroups] = useState<GroupListing[]>([]);
  const [details, setDetails] = useState<GroupDetails | null>(null);
  const [loading, setLoading] = useState(true), [error, setError] = useState("");
  const [busy, setBusy] = useState(false), [editing, setEditing] = useState(false);
  const [alias, setAlias] = useState(""), [notice, setNotice] = useState("");
  const [confirm, setConfirm] = useState<Confirmation | null>(null), [successor, setSuccessor] = useState("");
  const [revision, setRevision] = useState(0);
  const inFlight = useRef(false), mounted = useRef(false), generation = useRef(0);

  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; generation.current++; };
  }, []);
  const intentPath = (path: string) => withGameIntent(path, readGameIntent(window.location.search), readGamesIntent(window.location.search));
  const navigate = (path: string) => router.push(intentPath(path));

  useEffect(() => {
    if (creating) { setLoading(false); return; }
    const controller = new AbortController();
    let active = true, pending = false;
    generation.current++;
    setLoading(true);
    setError("");
    const load = async () => {
      if (pending || inFlight.current) return;
      pending = true;
      const current = ++generation.current;
      try {
        if (id) {
          const value = await adapter.get(id, inviteToken(), controller.signal);
          if (active && current === generation.current) setDetails(value);
        } else {
          const value = await adapter.list(requestFilters, controller.signal);
          if (active && current === generation.current) setGroups(value);
        }
      } catch (failure) {
        if (active && current === generation.current && !controller.signal.aborted) {
          setError(message(failure));
          if ([401, 403, 404].includes((failure as { status?: number }).status || 0)) setDetails(null);
        }
      } finally {
        pending = false;
        if (active && current === generation.current) setLoading(false);
      }
    };
    void load();
    const stop = pollWhileVisible(load, 15000);
    return () => { active = false; generation.current++; controller.abort(); stop(); };
  }, [adapter, id, creating, requestFilters, revision]);

  const run = useCallback(async (action: () => Promise<void>) => {
    if (inFlight.current) return;
    inFlight.current = true;
    generation.current++;
    setBusy(true);
    setError("");
    let succeeded = false;
    try { await action(); succeeded = true; }
    catch (failure) {
      if (mounted.current) {
        setError(message(failure));
        if ([401, 403, 404].includes((failure as { status?: number }).status || 0)) { setDetails(null); setLoading(false); }
      }
    }
    finally {
      inFlight.current = false;
      if (mounted.current) {
        setBusy(false);
        if (succeeded) setRevision(value => value + 1);
      }
    }
  }, []);

  async function submit(draft: GroupDraft) {
    await run(async () => {
      if (id) { await adapter.save(id, draft); setEditing(false); }
      else navigate(base + "/" + await adapter.create(draft));
    });
  }
  function openRoom() { if (id) void run(async () => navigate(await adapter.open(id))); }
  function joinGroup() { if (id) void run(() => adapter.join(id, alias.trim(), inviteToken())); }
  function copyInvite() {
    if (!id) return;
    void run(async () => {
      const token = await adapter.invite(id);
      const url = new URL(intentPath(base + "/" + id), window.location.origin);
      url.hash = new URLSearchParams({ invite: token }).toString();
      await navigator.clipboard.writeText(url.href);
      setNotice("Invite link copied.");
    });
  }
  function moderate(action: "approve" | "reject" | "unban", person: GroupPerson) {
    if (id) void run(() => adapter.moderate(id, action, person.id));
  }
  function confirmAction() {
    if (!id || !confirm) return;
    const chosen = confirm;
    void run(async () => {
      if (chosen.action === "kick") await adapter.moderate(id, "kick", chosen.person!.id);
      else if (chosen.action === "delete") await adapter.remove(id);
      else await adapter.leave(id, successor || undefined);
      setConfirm(null);
      if (chosen.action !== "kick") navigate(directory);
    });
  }

  if (creating || editing) return <GroupComposer adult={adult} editing={editing} initial={details?.group} busy={busy} error={error}
    onSubmit={submit} onCancel={() => editing ? setEditing(false) : navigate(directory)} />;
  if (!id) {
    return <GroupDirectory adult={adult} groups={groups} filters={filters} onFilters={setFilters}
      onOpen={group => navigate(base + "/" + group.id)} onCreate={() => navigate(base + "/new")}
      loading={loading || filters.search.trim() !== search} error={error} onRetry={() => setRevision(value => value + 1)} />;
  }
  if (!details) return <main className={styles.page}>
    <button className={styles.back} onClick={() => navigate(directory)}>Back to groups</button>
    {loading ? <p role="status">Opening group…</p> : <p className={styles.error} role="alert">{error || "Group not available."}</p>}
  </main>;

  const { group, status, members = [], requests = [], bans = [] } = details;
  const admitted = status === "owner" || status === "member", aliases = adult || group.identityMode === "aliases";
  const peers = members.filter(person => !person.owner);
  const deleting = confirm?.action === "delete" || confirm?.action === "leave" && status === "owner" && !peers.length;
  const requiresSuccessor = confirm?.action === "leave" && status === "owner" && peers.length > 0;
  return <main className={styles.page}>
    <button className={styles.back} onClick={() => navigate(directory)}>Back to groups</button>
    <h1 className={styles.title}>{group.title}</h1>
    {group.description && <p className={styles.description}>{group.description}</p>}
    <div className={styles.metadata}>
      <span>{group.mode === "chat" ? "Text chat" : group.mode === "voice" ? "Voice" : "Video"}</span>
      <span>{groupLabel("topic", group.publicTopic)}</span>
      <span>{groupLabel("language", group.language)}</span>
      <span>{group.onlineCount} online · {group.memberCount} {group.memberCount === 1 ? "member" : "members"}</span>
    </div>
    {!admitted && status !== "pending" && aliases && <label className={styles.field}>Your nickname
      <input value={alias} onChange={event => setAlias(event.target.value)} maxLength={24} minLength={2} autoComplete="nickname" />
      <small>Only this alias is shown in this group.</small>
    </label>}
    <div className={styles.actions}>
      {admitted ? <>
        <button className={buttons.primary} disabled={busy} onClick={openRoom}>Open room</button>
        <button className={buttons.secondary} disabled={busy} onClick={copyInvite}>Invite</button>
      </> : status === "pending" ? <>
        <p role="status">Request sent</p>
        {adapter.cancel && <button className={buttons.secondary} disabled={busy} onClick={() => void run(() => adapter.cancel!(id))}>Cancel request</button>}
      </> : <button className={buttons.primary} disabled={busy || aliases && alias.trim().length < 2} onClick={joinGroup}>
        {group.joinPolicy === "request" ? "Request to join" : "Join group"}
      </button>}
    </div>
    {status === "member" && <button className={styles.danger} disabled={busy} onClick={() => setConfirm({ action: "leave" })}>Leave group</button>}
    {notice && <p className={styles.notice} role="status">{notice}</p>}
    {error && <p className={styles.error} role="alert">{error}</p>}
    {status === "owner" && <details className={styles.management}>
      <summary>Manage group</summary>
      <div className={styles.actions}><button className={buttons.secondary} disabled={busy} onClick={() => setEditing(true)}>Group settings</button></div>
      <h2>Members</h2>
      <MemberList people={members} actions={person => !person.owner && <button className={styles.danger} disabled={busy}
        onClick={() => setConfirm({ action: "kick", person })}>Remove</button>} />
      <h2>Requests ({requests.length})</h2>
      <MemberList people={requests} actions={person => <>
        <button disabled={busy} onClick={() => moderate("approve", person)}>Approve</button>
        <button disabled={busy} onClick={() => moderate("reject", person)}>Decline</button>
      </>} />
      <h2>Banned members ({bans.length})</h2>
      <MemberList people={bans} actions={person => <button disabled={busy} onClick={() => moderate("unban", person)}>Unban</button>} />
      <div className={styles.actions}>
        <button className={styles.danger} disabled={busy} onClick={() => setConfirm({ action: "leave" })}>Leave group</button>
        <button className={styles.danger} disabled={busy} onClick={() => setConfirm({ action: "delete" })}>Delete group</button>
      </div>
    </details>}
    {confirm && <Modal title={confirm.action === "kick" ? "Remove member?" : deleting ? "Delete group?" : "Leave group?"}
      onClose={() => { if (!busy) setConfirm(null); }}>
      <p>{confirm.action === "kick" ? `${confirm.person?.alias} will be removed and cannot rejoin unless you unban them.`
        : deleting ? "This permanently deletes the group." : "You will leave this group."}</p>
      {requiresSuccessor && <label className={styles.field}>New owner
        <select value={successor} onChange={event => setSuccessor(event.target.value)}>
          <option value="">Choose a member</option>
          {peers.map(person => <option key={person.id} value={person.id}>{person.alias}</option>)}
        </select>
      </label>}
      <div className={styles.actions}>
        <button className={buttons.secondary} disabled={busy} onClick={() => setConfirm(null)}>Cancel</button>
        <button className={styles.dangerPrimary} disabled={busy || requiresSuccessor && !successor} onClick={confirmAction}>
          {confirm.action === "kick" ? "Remove member" : deleting ? "Delete group" : "Leave group"}
        </button>
      </div>
    </Modal>}
  </main>;
}
