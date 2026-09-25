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
import type { MySquadLite, PublicSquad, SquadMemberState } from "@giggle/core";
import { Button } from "@/components/Button";
import { Modal } from "@/components/Modal";
import { Avatar } from "@/components/Avatar";
import { PersonAvatar } from "@/components/PersonAvatar";
import { Icon } from "@/components/Icons";
import { useToast } from "@/components/Toast";
import { WEB_DISCOVERY_ENABLED } from "@/lib/discovery";
import { pollWhileVisible } from "@/lib/poll";
import community from "@/components/Community.module.css";

const rank: Record<string, number> = { in_encounter: 0, matched: 1, searching: 2, idle: 3 };
function squadDestination(squad: MySquadLite | PublicSquad) {
  if (!WEB_DISCOVERY_ENABLED) return `/lobby?squad=${squad.squadId}`;
  return ["searching", "matched", "in_encounter"].includes(squad.status)
    ? `/matchmaking?squad=${squad.squadId}`
    : `/lobby?squad=${squad.squadId}`;
}
const message = (error: unknown, fallback: string) =>
  error instanceof Error ? error.message : fallback;

/* Tip-card idea sets (the approved "Try this next call" design) — the shuffle
 * button cycles through these, matching the studio's IDEAS list. */
type TipIcon = React.ComponentType<{ size?: number }>;
const IDEA_SETS: [TipIcon, string][][] = [
  [[Icon.music, "A song"], [Icon.book, "A story"], [Icon.wink, "Funniest moment"]],
  [[Icon.popcorn, "Snack reveal"], [Icon.dice, "Quick game"], [Icon.bulb, "Hot take"]],
  [[Icon.wave, "Best news"], [Icon.confetti, "Small win"], [Icon.mic, "Worst song"]],
];

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
  const [tipIndex, setTipIndex] = useState(0);
  const [tipShuffled, setTipShuffled] = useState(false);
  const active = squads?.[0];
  function shuffleTipIdeas() {
    setTipShuffled(false);
    setTipIndex((i) => (i + 1) % IDEA_SETS.length);
    // Re-adding .is-shuffled after the swap replays the skins' idea animations.
    requestAnimationFrame(() => requestAnimationFrame(() => setTipShuffled(true)));
  }
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
  function openCreate() {
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
  return (
    <div className={`gg-home gg-screen gg-screen-home ${community.home}`}>
      <div className="gg-home-heading">
        <div className="page-head">
          <p className={`eyebrow ${community.greeting}`}>YOUR LITTLE CORNER OF GIGGLE</p>
          <h1 className={`title ${community.heading}`}>Good to have <em>you here.</em></h1>
          <p className="lede">
            {WEB_DISCOVERY_ENABLED
              ? "Bring your friends. Meet another squad."
              : "A familiar face. A new inside joke. Make a little time for your people."}
          </p>
        </div>
        {active && (
          <Button variant="secondary" onClick={openCreate}>
            <Icon.plus size={18} />
            Start a squad
          </Button>
        )}
      </div>
      <div className="gg-home-grid">
        <div className="gg-home-primary">
          {loadError ? (
            <div role="alert" className="gg-home-panel card">
              <h2>We couldn’t load your squads.</h2>
              <p>{loadError}</p>
              <Button variant="secondary" onClick={retry}>
                Try again
              </Button>
            </div>
          ) : squads === null ? (
            <div role="status" className="gg-squad-feature">
              <span className="gg-spinner" /> Loading your squads…
            </div>
          ) : (
            <section className="gg-squad-feature card create">
              <span className="gg-eyebrow kicker">{active ? "Your squad" : "Create a squad"}</span>
              <h2 className="card-title">{active?.squadName ?? "Save a seat for your friends."}</h2>
              <div
                className="gg-squad-faces seat-row"
                aria-label={
                  active ? `${active.memberCount} people in your squad` : "Your first squad"
                }
              >
                {(roster.length
                  ? roster.slice(0, 4)
                  : [{ memberId: "you", userId: session.user?.id ?? "", displayName: session.user?.name ?? "You", avatar: null }]
                ).map((person) => (
                  <div className="gg-squad-seat seat filled" key={person.memberId}>
                    <PersonAvatar
                      userId={person.userId}
                      name={person.displayName}
                      avatar={person.avatar}
                      isMe={person.userId === session.user?.id}
                      size="fill"
                    />
                  </div>
                ))}
                {!active &&
                  [0, 1, 2].map((seat) => (
                    <div className="gg-squad-seat seat empty" key={`empty-${seat}`}>
                      <Icon.plus size={22} />
                    </div>
                  ))}
              </div>
              <div className="gg-squad-feature-footer card-foot">
                <p className="hint">
                  {active
                    ? `${active.memberCount} ${active.memberCount === 1 ? "person" : "people"} · ${active.status === "idle" ? "Ready to hang out" : active.status.replace(/_/g, " ")}`
                    : "Create a squad, then invite your friends."}
                </p>
                <Button onClick={active ? () => router.push(squadDestination(active)) : openCreate}>
                  {active ? "Back to your squad" : "Start a squad"}
                  <Icon.chevron size={18} />
                </Button>
              </div>
            </section>
          )}
        </div>
        <aside className="gg-home-side">
          <form
            className={`gg-join-form card join-card`}
            onSubmit={(event) => {
              event.preventDefault();
              void join();
            }}
          >
            <label htmlFor="squad-code" className="card-title">Got a seat saved?</label>
            <p className={`hint ${community.joinHint}`}>Pop in the invite code from your friends.</p>
            <div className="gg-join-row join">
              <input
                id="squad-code"
                className="input code"
                aria-label="Squad invite code"
                aria-invalid={!!joinError}
                aria-describedby={joinError ? "join-error" : undefined}
                value={code}
                placeholder="ABC-123"
                autoCapitalize="characters"
                autoComplete="off"
                spellCheck={false}
                maxLength={7}
                onChange={(event) => {
                  setCode(formatSquadCodeInput(event.target.value));
                  setJoinError("");
                }}
              />
              <Button
                type="submit"
                variant="secondary"
                loading={pending === "join"}
                disabled={!!pending || !isValidSquadCode(code)}
              >
                {requested.includes(code) ? "Request again" : "Join squad"}
              </Button>
            </div>
          </form>
          {joinError && (
            <p id="join-error" role="alert" className="gg-inline-error">
              {joinError}
            </p>
          )}
          {/* The approved mocks place the tip card in the right column under
              the join card (grid-areas "create join" / "create tip"); on phone
              it follows the join card in the single column. */}
          <section className="gg-tip card tip">
            <span className="tip-mark" aria-hidden="true">
              <Icon.sparkle size={22} />
            </span>
            <div className="tip-body">
              <h2 className="card-title tip-title">Try this next call</h2>
              <button
                type="button"
                className="icon-btn tip-shuffle"
                aria-label="New idea"
                onClick={shuffleTipIdeas}
              >
                <Icon.shuffle size={17} />
              </button>
              <ul className={`tip-ideas${tipShuffled ? " is-shuffled" : ""}`} aria-live="polite">
                {IDEA_SETS[tipIndex].map(([TipIcon, label]) => (
                  <li className="tip-idea" key={label}>
                    <TipIcon size={16} />
                    <span>{label}</span>
                  </li>
                ))}
              </ul>
              <Link href="/friends" className="link tip-cta">
                Find your people <Icon.arrowRight size={16} />
              </Link>
            </div>
          </section>
          {!!squads?.length && (
            <section className="gg-home-panel card">
              <h2>Your squads</h2>
              {squads.map((s) => (
                <div className="gg-home-row" key={s.squadId}>
                  <Avatar name={s.squadName} size={40} />
                  <div className="gg-home-row-copy">
                    <h3>{s.squadName}</h3>
                    <p>
                      {s.memberCount} people ·{" "}
                      {s.myRole === "leader" ? "You lead this squad" : "Member"}
                    </p>
                  </div>
                  <Button size="sm" variant="secondary" onClick={() => router.push(squadDestination(s))}>
                    Open
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    style={{ width: 44, padding: 0 }}
                    aria-label={`${s.myRole === "leader" ? "End" : "Leave"} ${s.squadName}`}
                    onClick={() => setLeaving(s)}
                  >
                    <Icon.close size={17} />
                  </Button>
                </div>
              ))}
            </section>
          )}
        {WEB_DISCOVERY_ENABLED && (
          <section className="gg-home-panel card">
            <div className="gg-home-panel-heading">
              <h2>Open squads</h2>
              <Link href="/discover">See all →</Link>
            </div>
            {openError ? (
              <div role="alert">
                <p>{openError}</p>
                <Button variant="ghost" onClick={retry}>
                  Try again
                </Button>
              </div>
            ) : openSquads === null ? (
              <p role="status">Loading open squads…</p>
            ) : !openSquads.length ? (
              <p>No open squads yet. Start one with your friends.</p>
            ) : (
              openSquads.slice(0, 3).map((s) => {
                const member = squads?.some((m) => m.squadId === s.squadId);
                const full = s.memberCount >= s.maxSlots;
                return (
                  <div className="gg-home-row" key={s.squadId}>
                    <Avatar name={s.squadName} size={40} />
                    <div className="gg-home-row-copy">
                      <h3>{s.squadName}</h3>
                      <p>
                        {s.memberCount} people · {s.tags?.[0] ?? "Open to a hello"}
                      </p>
                    </div>
                    <Button
                      size="sm"
                      variant="secondary"
                      loading={pending === s.squadId}
                      disabled={!member && (!!pending || full || requested.includes(s.squadId))}
                      onClick={() => (member ? router.push(squadDestination(s)) : void join(s))}
                    >
                      {member
                        ? "Open"
                        : requested.includes(s.squadId)
                          ? "Requested"
                          : full
                            ? "Full"
                            : s.joinPolicy === "request"
                              ? "Ask to join"
                              : "Join"}
                    </Button>
                  </div>
                );
              })
            )}

          </section>
        )}
        </aside>
      </div>
      <div className={community.note}><p className="hint">A good hangout starts with making everyone feel welcome.</p><Link href="/safety">The Giggle way ↗</Link></div>
      {createOpen && (
        <Modal
          title="Start a squad"
          subtitle="Choose a name. Invite friends next."
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
