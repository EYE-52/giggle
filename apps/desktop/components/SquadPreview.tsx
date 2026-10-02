"use client";
import { useState, useEffect, useCallback } from "react";
import { useRouter } from "next/navigation";
import { Modal } from "@/components/Modal";
import { Button } from "@/components/Button";
import { PersonAvatar } from "@/components/PersonAvatar";
import styles from "./SquadPreview.module.css";
import { Icon } from "@/components/Icons";
import { useViewport } from "@/components/useViewport";
import { api, session, type PublicSquad, type SquadState, type SquadMemberState } from "@giggle/core";

const STATUS_LABEL: Record<string, string> = {
  idle: "Open",
  searching: "Searching",
  matched: "Matched",
  in_encounter: "Live",
};


export function SquadPreview({
  squad,
  onClose,
  onJoined,
}: {
  squad: PublicSquad;
  onClose: () => void;
  onJoined: (squadId: string | null, requested: boolean) => void;
}) {
  const router = useRouter();
  const { isPhone } = useViewport();
  const [detail, setDetail] = useState<SquadState | null>(null);
  const [joining, setJoining] = useState(false);
  const [requested, setRequested] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [detailError, setDetailError] = useState<string | null>(null);

  // Fetch full detail (tags + members + joinPolicy). Fall back to the PublicSquad
  // fields while loading.
  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        // Public preview endpoint — works even though we're not a member yet.
        setDetailError(null);
        const d = await api.getSquadPreview(squad.squadId);
        if (alive) setDetail(d);
      } catch (e) {
        console.error("getSquadPreview failed:", e);
        if (alive) setDetailError("Couldn't load live squad details.");
      }
    })();
    return () => { alive = false; };
  }, [squad.squadId]);

  // Merge live detail over the card-level snapshot.
  const tags = detail?.tags ?? squad.tags ?? [];
  const members: SquadMemberState[] = detail?.members ?? [];
  const joinPolicy = detail?.joinPolicy ?? squad.joinPolicy ?? "open";
  const isRequest = joinPolicy === "request";
  const memberCount = members.length || squad.memberCount;
  const maxSlots = detail?.maxSlots ?? squad.maxSlots;
  const statusRaw = detail?.status ?? squad.status;
  const statusLabel = STATUS_LABEL[statusRaw] ?? statusRaw;
  const isLive = statusRaw === "in_encounter";
  const leaderName = squad.leaderName ?? members.find(m => m.role === "leader")?.displayName;
  const isFull = memberCount >= maxSlots;

  const handleJoin = useCallback(async () => {
    setError(null);
    if (!session.isAuthed()) {
      setError("Sign in to continue.");
      router.push("/signin");
      return;
    }
    setJoining(true);
    try {
      const res = await api.joinSquadById(squad.squadId);
      if (res && "status" in res && res.status === "requested") {
        setRequested(true);
        onJoined(null, true);
        return;
      }
      onJoined((res as SquadState).squadId, false);
    } catch (e: unknown) {
      console.error("joinSquad failed:", e);
      const code = (e as { code?: string })?.code;
      if (code === "SQUAD_FULL" || code === "SQUAD_FULL_UPGRADE") {
        setError(`${squad.squadName} is full — try another squad.`);
      } else {
        setError((e as { message?: string })?.message || "Couldn't join that squad. Try again.");
      }
      setJoining(false);
    }
  }, [squad, onJoined, router]);

  // Am I already in this squad? Then Join makes no sense — offer Open + Leave.
  const myUserId = session.user?.id;
  const isMember = !!myUserId && members.some(m => m.userId === myUserId);
  // Until the roster resolves we can't know if the viewer is already a member,
  // so don't offer "Join" yet — otherwise a member who clicks fast (or whose
  // fetch is slow) would fire joinSquad on their own squad.
  const detailLoading = detail === null && !detailError;
  const [leaving, setLeaving] = useState(false);

  const openLobby = useCallback(() => {
    router.push(`/lobby?squad=${squad.squadId}`);
  }, [router, squad.squadId]);

  const handleLeave = useCallback(async () => {
    setError(null);
    setLeaving(true);
    try {
      await api.leaveSquad(squad.squadId);
      onJoined(null, false); // let the parent refresh its lists
      onClose();
    } catch (e: unknown) {
      setError((e as { message?: string })?.message || "Couldn't leave that squad. Try again.");
      setLeaving(false);
    }
  }, [squad.squadId, onJoined, onClose]);

  return (
    <Modal onClose={onClose} title={squad.squadName} subtitle={`${leaderName ? `Led by ${leaderName}` : "Open squad"} · ${memberCount} of ${maxSlots}`} width={480} sheet={isPhone}>
      <div className={styles.body}>
        <div className={styles.facts}>
          <span className={`chip ${styles.fact}`} data-live={isLive || undefined}>{isLive && <span className={styles.liveDot} aria-hidden="true" />}{statusLabel}</span>
          <span className={`chip ${styles.fact}`}><Icon.shield size={14} color="currentColor" />{isRequest ? "The leader approves new members" : "Anyone can join"}</span>
        </div>
        {detailError && <p role="alert" className={styles.error}>{detailError}</p>}

        <section aria-label="Interests" className={styles.section}>
          {tags.length > 0
            ? <div className={styles.tags}>{tags.map(tag => <span key={tag} className={`chip ${styles.tag}`}>{tag}</span>)}</div>
            : <p className="muted">No interests added yet.</p>}
        </section>

        <section aria-label="Members" className={styles.section}>
          {members.length > 0 ? (
            <ul className={styles.members}>
              {members.map(m => (
                <li key={m.memberId} className={styles.member}>
                  <span className={styles.face}><PersonAvatar userId={m.userId} name={m.displayName} avatar={m.avatar} size="fill" /></span>
                  <span className={styles.memberText}>
                    <b>{m.displayName}</b>
                    <small className="muted">{[m.role === "leader" ? "Leader" : null, m.country, ...(m.languages ?? []).slice(0, 2)].filter(Boolean).join(" · ") || "Member"}</small>
                  </span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="muted">{detailError ? "Couldn't load who is in this squad." : detailLoading ? "Loading members…" : "No members to show."}</p>
          )}
        </section>

        <footer className={styles.footer}>
          {requested ? (
            <p role="status" className={styles.sent}><Icon.send size={16} color="currentColor" />Request sent. The leader will review it.</p>
          ) : (
            <>
              {error && <p role="alert" className={styles.error}>{error}</p>}
              {isMember ? (
                <>
                  <Button onClick={openLobby} fullWidth>Open lobby<Icon.arrowRight size={18} /></Button>
                  <Button variant="danger" onClick={handleLeave} loading={leaving} fullWidth>Leave squad</Button>
                </>
              ) : (
                <Button onClick={handleJoin} disabled={joining || isFull || detailLoading} loading={joining || detailLoading} fullWidth>
                  {isFull ? "Squad full" : isRequest ? "Request to join" : "Join squad"}
                </Button>
              )}
            </>
          )}
        </footer>
      </div>
    </Modal>
  );
}
