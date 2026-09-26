"use client";
import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  api,
  session,
  formatSquadCodeInput,
  isValidSquadCode,
} from "@giggle/core";
import type { Friend, MySquadLite, PublicSquad, SquadMemberState } from "@giggle/core";
import { Button } from "@/components/Button";
import { Modal } from "@/components/Modal";
import { Avatar } from "@/components/Avatar";
import { PersonAvatar } from "@/components/PersonAvatar";
import { Icon } from "@/components/Icons";
import { useToast } from "@/components/Toast";
import { WEB_DISCOVERY_ENABLED } from "@/lib/discovery";
import { pollWhileVisible } from "@/lib/poll";
import styles from "./home.module.css";

const rank: Record<string, number> = { in_encounter: 0, matched: 1, searching: 2, idle: 3 };
function squadDestination(squad: MySquadLite | PublicSquad) {
  if (!WEB_DISCOVERY_ENABLED) return `/lobby?squad=${squad.squadId}`;
  return ["searching", "matched", "in_encounter"].includes(squad.status)
    ? `/matchmaking?squad=${squad.squadId}`
    : `/lobby?squad=${squad.squadId}`;
}
const message = (error: unknown, fallback: string) =>
  error instanceof Error ? error.message : fallback;

export default function HomePage() {
  const router = useRouter();
  const { toast } = useToast();
  const [squads, setSquads] = useState<MySquadLite[] | null>(null);
  const [openSquads, setOpenSquads] = useState<PublicSquad[] | null>(null);
  const [loadError, setLoadError] = useState("");
  const [openError, setOpenError] = useState("");
  const [reload, setReload] = useState(0);
  const [roster, setRoster] = useState<SquadMemberState[]>([]);
  const [code, setCode] = useState("");
  const [joinError, setJoinError] = useState("");
  const [pending, setPending] = useState("");
  const action = useRef(false);
  const [createOpen, setCreateOpen] = useState(false);
  const [name, setName] = useState("");
  const [createError, setCreateError] = useState("");
  const [leaving, setLeaving] = useState<MySquadLite | null>(null);
  const [requested, setRequested] = useState<string[]>([]);
  const [friends, setFriends] = useState<Friend[] | null>(null);
  const [invited, setInvited] = useState<string[]>([]);
  const [inviteAfterCreate, setInviteAfterCreate] = useState<Friend | null>(null);
  const active = squads?.[0];
  useEffect(() => {
    if (new URLSearchParams(window.location.search).get("create") === "1") {
      setName("");
      setCreateOpen(true);
    }
  }, []);
  function ensureAuthed() {
    if (session.isAuthed()) return true;
    setJoinError("Sign in to continue.");
    router.push("/signin");
    return false;
  }
  useEffect(() => {
    let alive = true;
    async function load() {
      try {
        const data = await api.mySquads();
        if (alive) {
          setSquads(
            [...data.squads].sort(
              (a, b) =>
                (rank[a.status] ?? 4) - (rank[b.status] ?? 4) ||
                a.squadName.localeCompare(b.squadName),
            ),
          );
          setLoadError("");
          const approved = data.squads.find(squad => requested.includes(squad.squadId) || requested.includes(squad.squadCode));
          if (approved) {
            setRequested([]);
            router.replace(`/lobby?squad=${approved.squadId}`);
          }
        }
      } catch (error) {
        if (alive) setLoadError(message(error, "Couldn't load your squads."));
      }
    }
    void load();
    const stopPolling = pollWhileVisible(load, requested.length ? 3000 : 20000);
    return () => {
      alive = false;
      stopPolling();
    };
  }, [reload, requested, router]);
  useEffect(() => {
    if (!WEB_DISCOVERY_ENABLED) return;
    let alive = true;
    async function load() {
      try {
        const data = await api.discoverSquads();
        if (alive) {
          setOpenSquads(data.squads);
          setOpenError("");
        }
      } catch (error) {
        if (alive) setOpenError(message(error, "Couldn't load open squads."));
      }
    }
    void load();
    const stopPolling = pollWhileVisible(load, 20000);
    return () => {
      alive = false;
      stopPolling();
    };
  }, [reload]);
  useEffect(() => {
    let alive = true;
    setRoster([]);
    if (active)
      api
        .getSquad(active.squadId)
        .then((data) => {
          if (alive) setRoster(data.members);
        })
        .catch(() => {});
    return () => {
      alive = false;
    };
  }, [active?.squadId, active?.memberCount]);
  useEffect(() => {
    let alive = true;
    async function load() {
      try {
        const data = await api.listFriends();
        if (alive) setFriends(data.friends);
      } catch {
        if (alive) setFriends((previous) => previous ?? []);
      }
    }
    void load();
    const stopPolling = pollWhileVisible(load, 20000);
    return () => {
      alive = false;
      stopPolling();
    };
  }, [reload]);
  async function invite(friend: Friend) {
    if (!ensureAuthed()) return;
    if (!active) {
      // no squad yet: start one, then invite them straight away
      setInviteAfterCreate(friend);
      setName("");
      setCreateError("");
      setCreateOpen(true);
      return;
    }
    setPending(`invite-${friend.userId}`);
    try {
      await api.inviteUserToSquad(active.squadId, friend.userId);
      setInvited((previous) => [...previous, friend.userId]);
      toast(`Invite sent to ${friend.name}.`, "success");
    } catch (error) {
      toast(message(error, `Couldn't invite ${friend.name}. Try again.`), "error");
    } finally {
      setPending("");
    }
  }
  function openCreate() {
    setInviteAfterCreate(null);
    if (!ensureAuthed()) return;
    setName("");
    setCreateError("");
    setCreateOpen(true);
  }
  async function create() {
    if (action.current) return;
    if (!ensureAuthed()) return;
    if (!name.trim()) {
      setCreateError("Give your squad a name.");
      return;
    }
    action.current = true;
    setPending("create");
    setCreateError("");
    try {
      const squad = await api.createSquad({ squadName: name.trim(), tags: [] });
      if (inviteAfterCreate) await api.inviteUserToSquad(squad.squadId, inviteAfterCreate.userId).catch(() => {});
      setCreateOpen(false);
      router.push(`/lobby?squad=${squad.squadId}`);
    } catch (error) {
      setCreateError(message(error, "Couldn't create your squad. Try again."));
    } finally {
      action.current = false;
      setPending("");
    }
  }
  async function join(squad?: PublicSquad) {
    if (action.current) return;
    if (!ensureAuthed()) return;
    if (!squad && !isValidSquadCode(code)) {
      setJoinError("Use a squad code like ABC-123.");
      return;
    }
    action.current = true;
    setPending(squad?.squadId ?? "join");
    setJoinError("");
    try {
      const result = squad
        ? await api.joinSquadById(squad.squadId)
        : await api.joinSquad({ squadCode: formatSquadCodeInput(code) });
      if ("status" in result && result.status === "requested") {
        setRequested((previous) => [...previous, squad?.squadId ?? formatSquadCodeInput(code)]);
        toast("Request sent. You will enter if the leader approves.", "success");
      } else router.push(`/lobby?squad=${result.squadId}`);
    } catch (error) {
      const text = message(error, "Couldn't join. Check the code and try again.");
      if (squad) toast(text, "error");
      else setJoinError(text);
    } finally {
      action.current = false;
      setPending("");
    }
  }
  async function leave() {
    if (!leaving || action.current) return;
    if (!ensureAuthed()) return;
    const target = leaving;
    action.current = true;
    setPending("leave");
    try {
      if (target.myRole === "leader") await api.disbandSquad(target.squadId);
      else await api.leaveSquad(target.squadId);
      setSquads((previous) => previous?.filter((s) => s.squadId !== target.squadId) ?? []);
      setLeaving(null);
      toast(target.myRole === "leader" ? "Squad ended." : "You left the squad.", "success");
    } catch (error) {
      toast(message(error, "Couldn't leave your squad. Try again."), "error");
    } finally {
      action.current = false;
      setPending("");
    }
  }
  const retry = () => {
    setLoadError("");
    setOpenError("");
    setReload((value) => value + 1);
  };
  const people = [...(friends ?? [])].sort((a, b) => Number(b.online) - Number(a.online) || a.name.localeCompare(b.name));
  const onlineCount = people.filter((f) => f.online).length;
  const trayAction = active
    ? active.status === "in_encounter" || active.status === "matched"
      ? "Back to call"
      : "Open lobby"
    : "Start a squad";
  const seats = active ? Math.max(active.maxSlots, roster.length) : 0;
  return (
    <div className={`gg-screen gg-home-people ${styles.home}`}>
      <div className={styles.columns}>
        <section className={`card ${styles.panel}`} aria-labelledby="home-friends">
          <div className={styles.panelBody}>
          <header className={styles.panelHead}>
            <h2 id="home-friends" className={styles.panelTitle}>Friends</h2>
            {people.length > 0 && <span className={`count ${styles.count}`}>{onlineCount} online</span>}
            <Link href="/friends" className={`link ${styles.headLink}`}>Add friends</Link>
          </header>
          {friends === null ? (
            <p role="status" className={styles.quiet}><span className="gg-spinner" /> Loading friends…</p>
          ) : people.length === 0 ? (
            <div className={styles.empty}>
              <p>Friends you add show up here, ready to invite.</p>
              <Button variant="secondary" onClick={() => router.push("/friends")}>Find friends</Button>
            </div>
          ) : (
            <ul className={styles.list}>
              {people.map((friend) => {
                const sent = invited.includes(friend.userId);
                return (
                  <li key={friend.userId} className={styles.person}>
                    <PersonAvatar userId={friend.userId} name={friend.name} avatar={friend.avatar} size={40} online={friend.online} wrapClassName="pa" />
                    <span className={styles.personText}>
                      <b>{friend.name}</b>
                      <small className="muted">{friend.online ? "Online" : "Offline"}</small>
                    </span>
                    <Button
                      size="sm"
                      variant="secondary"
                      loading={pending === `invite-${friend.userId}`}
                      disabled={sent || (!!pending && pending !== `invite-${friend.userId}`)}
                      onClick={() => void invite(friend)}
                      aria-label={sent ? `${friend.name} invited` : `Invite ${friend.name}${active ? ` to ${active.squadName}` : ""}`}
                    >
                      {sent ? "Invited" : "Invite"}
                    </Button>
                  </li>
                );
              })}
            </ul>
          )}
          </div>
        </section>

        <section className={`card ${styles.panel}`} aria-labelledby="home-squads">
          <div className={styles.panelBody}>
          <header className={styles.panelHead}>
            <h2 id="home-squads" className={styles.panelTitle}>Squads</h2>
          </header>
          {loadError ? (
            <div role="alert" className={styles.empty}>
              <p>{loadError}</p>
              <Button variant="secondary" onClick={retry}>Try again</Button>
            </div>
          ) : squads === null ? (
            <p role="status" className={styles.quiet}><span className="gg-spinner" /> Loading your squads…</p>
          ) : (
            <ul className={styles.list}>
              {squads.map((s) => (
                <li key={s.squadId} className={styles.squadRow}>
                  <Avatar name={s.squadName} size={40} />
                  <span className={styles.personText}>
                    <b>{s.squadName}</b>
                    <small className="muted">
                      {s.status === "in_encounter" || s.status === "matched" ? "In a call" : s.status === "searching" ? "Finding a squad" : `${s.memberCount} of ${s.maxSlots}`}
                      {s.myRole === "leader" ? " · You lead" : ""}
                    </small>
                  </span>
                  <Button size="sm" variant="secondary" onClick={() => router.push(squadDestination(s))}>Open</Button>
                  <button type="button" className={`icon-btn ${styles.iconBtn}`} aria-label={`${s.myRole === "leader" ? "End" : "Leave"} ${s.squadName}`} onClick={() => setLeaving(s)}>
                    <Icon.close size={16} />
                  </button>
                </li>
              ))}
            </ul>
          )}
          {active && (
            <button type="button" className={`btn btn-secondary ${styles.newSquad}`} onClick={openCreate}>
              <Icon.plus size={18} /> Start another squad
            </button>
          )}
          <form
            className={`join ${styles.join}`}
            onSubmit={(event) => {
              event.preventDefault();
              void join();
            }}
          >
            <input
              id="squad-code"
              aria-label="Squad invite code"
              className="input code"
              aria-invalid={!!joinError}
              aria-describedby={joinError ? "join-error" : undefined}
              value={code}
              placeholder="Invite code"
              autoCapitalize="characters"
              autoComplete="off"
              spellCheck={false}
              maxLength={7}
              onChange={(event) => {
                setCode(formatSquadCodeInput(event.target.value));
                setJoinError("");
              }}
            />
            <Button type="submit" variant="secondary" loading={pending === "join"} disabled={!!pending || !isValidSquadCode(code)}>
              {requested.includes(code) ? "Request again" : "Join squad"}
            </Button>
          </form>
          {joinError && <p id="join-error" role="alert" className="gg-inline-error">{joinError}</p>}
          {WEB_DISCOVERY_ENABLED && (
            <div className={styles.open}>
              <header className={styles.panelHead}>
                <h3 className={styles.panelTitle}>Open squads</h3>
                <Link href="/discover" className={`link ${styles.headLink}`}>See all</Link>
              </header>
              {openError ? (
                <div role="alert"><p>{openError}</p><Button variant="ghost" onClick={retry}>Try again</Button></div>
              ) : openSquads === null ? (
                <p role="status" className={styles.quiet}>Loading open squads…</p>
              ) : !openSquads.length ? (
                <p className={styles.quiet}>No open squads right now.</p>
              ) : (
                <ul className={styles.list}>
                  {openSquads.slice(0, 3).map((s) => {
                    const member = squads?.some((m) => m.squadId === s.squadId);
                    const full = s.memberCount >= s.maxSlots;
                    return (
                      <li key={s.squadId} className={styles.squadRow}>
                        <Avatar name={s.squadName} size={40} />
                        <span className={styles.personText}>
                          <b>{s.squadName}</b>
                          <small className="muted">{s.memberCount} of {s.maxSlots}</small>
                        </span>
                        <Button
                          size="sm"
                          variant="secondary"
                          loading={pending === s.squadId}
                          disabled={!member && (!!pending || full || requested.includes(s.squadId))}
                          onClick={() => (member ? router.push(squadDestination(s)) : void join(s))}
                        >
                          {member ? "Open" : requested.includes(s.squadId) ? "Requested" : full ? "Full" : s.joinPolicy === "request" ? "Ask to join" : "Join"}
                        </Button>
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>
          )}
          </div>
        </section>
      </div>

      <div className={styles.trayDock}>
      <div className={`card ${styles.trayCard}`} role="region" aria-label={active ? `${active.squadName}, your squad` : "Your squad"}>
        <div className={styles.trayRow}>
        {active ? (
          <>
            <div className={styles.traySeats} aria-hidden="true">
              {Array.from({ length: Math.min(seats, 8) }, (_, i) => {
                const person = roster[i];
                return person ? (
                  <span key={person.memberId} className={styles.traySeat}>
                    <PersonAvatar userId={person.userId} name={person.displayName} avatar={person.avatar} size="fill" isMe={person.userId === session.user?.id} />
                  </span>
                ) : (
                  <span key={`open-${i}`} className={`${styles.traySeat} ${styles.openSeat}`} />
                );
              })}
            </div>
            <span className={styles.trayText}>
              <b>{active.squadName}</b>
              <small className="muted">{active.memberCount} of {active.maxSlots} here</small>
            </span>
          </>
        ) : (
          <span className={styles.trayText}>
            <b>No squad yet</b>
            <small className="muted">Start one, then invite friends.</small>
          </span>
        )}
        <Button onClick={() => (active ? router.push(squadDestination(active)) : openCreate())}>
          {trayAction}
          <Icon.arrowRight size={18} />
        </Button>
        </div>
      </div>
      </div>

      {createOpen && (
        <Modal
          title="Start a squad"
          subtitle={inviteAfterCreate ? `Name it, and ${inviteAfterCreate.name} gets an invite.` : "Name it, then invite friends."}
          onClose={() => {
            if (!pending) setCreateOpen(false);
          }}
          closeOnBackdrop={!pending}
          showClose={!pending}
        >
          <form
            className="gg-form-stack"
            onSubmit={(event) => {
              event.preventDefault();
              void create();
            }}
          >
            <label>
              Squad name
              <input
                className="input"
                value={name}
                maxLength={40}
                onChange={(event) => {
                  setName(event.target.value);
                  setCreateError("");
                }}
                disabled={!!pending}
              />
            </label>
            {createError && (
              <p role="alert" className="gg-inline-error">
                {createError}
              </p>
            )}
            <div className="gg-form-actions modal-foot">
              <Button variant="ghost" onClick={() => setCreateOpen(false)} disabled={!!pending}>
                Cancel
              </Button>
              <Button type="submit" loading={pending === "create"} disabled={!!pending}>
                Create squad
              </Button>
            </div>
          </form>
        </Modal>
      )}
      {leaving && (
        <Modal
          title={leaving.myRole === "leader" ? "End this squad?" : "Leave this squad?"}
          subtitle={
            leaving.myRole === "leader"
              ? "This closes the squad for everyone."
              : "Your friends can keep hanging out."
          }
          onClose={() => {
            if (!pending) setLeaving(null);
          }}
          closeOnBackdrop={!pending}
          showClose={!pending}
        >
          <div className="gg-form-actions modal-foot">
            <Button variant="secondary" disabled={!!pending} onClick={() => setLeaving(null)}>
              Stay
            </Button>
            <Button
              variant="danger"
              loading={pending === "leave"}
              disabled={!!pending}
              onClick={() => void leave()}
            >
              {leaving.myRole === "leader" ? "End squad" : "Leave squad"}
            </Button>
          </div>
        </Modal>
      )}
    </div>
  );
}
