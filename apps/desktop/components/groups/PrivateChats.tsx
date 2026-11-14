"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { pollWhileVisible } from "@/lib/poll";
import { Modal } from "@/components/Modal";
import styles from "./GroupDetail.module.css";
import buttons from "./Groups.module.css";

export type PrivateChatRequest = {
  id: string;
  alias: string;
  mode: string;
  direction: "incoming" | "outgoing";
  status: string;
  expiresAt: number;
  roomPath?: string;
};
export type PrivateChatAdapter = {
  list: (source: string) => Promise<PrivateChatRequest[]>;
  invite: (source: string, member: string) => Promise<void>;
  accept: (id: string) => Promise<void>;
  decline: (id: string) => Promise<void>;
  cancel: (id: string) => Promise<void>;
  open: (path: string) => Promise<void>;
};
const errorMessage = (error: unknown) => error instanceof Error ? error.message : "Could not complete this request.";

export function usePrivateChats(source: string | undefined, adapter: PrivateChatAdapter) {
  const [requests, setRequests] = useState<PrivateChatRequest[]>([]);
  const [error, setError] = useState("");
  const [loadError, setLoadError] = useState("");
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [revision, setRevision] = useState(0);
  const generation = useRef(0);
  const inFlight = useRef(false);
  const mounted = useRef(false);
  const currentSource = useRef(source);
  currentSource.current = source;
  useEffect(() => {
    setRequests([]);
    setOpen(false);
    setError("");
    setLoadError("");
  }, [source]);

  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; generation.current++; };
  }, []);

  useEffect(() => {
    let active = true, loading = false;
    generation.current++;
    if (!source) {
      setRequests([]);
      setOpen(false);
      return;
    }
    const load = async () => {
      if (loading || inFlight.current) return;
      loading = true;
      const current = ++generation.current;
      try {
        const values = await adapter.list(source);
        if (active && current === generation.current) {
          setRequests(values);
          setLoadError("");
        }
      } catch (failure) {
        if (active && current === generation.current) {
          setLoadError(errorMessage(failure));
          if ([401, 403, 404].includes((failure as { status?: number }).status || 0)) setRequests([]);
        }
      } finally { loading = false; }
    };
    void load();
    const stop = pollWhileVisible(load, 5000);
    return () => { active = false; generation.current++; stop(); };
  }, [source, adapter, revision]);

  const act = useCallback(async (action: () => Promise<void>, showAfter = false) => {
    if (inFlight.current) return;
    inFlight.current = true;
    generation.current++;
    const startedFor = currentSource.current;
    setBusy(true);
    setError("");
    try {
      await action();
    } catch (failure) {
      if (mounted.current && startedFor === currentSource.current) setError(errorMessage(failure));
    } finally {
      inFlight.current = false;
      if (mounted.current) {
        setBusy(false);
        if (showAfter && startedFor === currentSource.current) setOpen(true);
        setRevision(value => value + 1);
      }
    }
  }, []);

  const invite = async (member: string) => {
    if (source) await act(() => adapter.invite(source, member), true);
  };
  const current = requests.filter(request => request.status === "accepted" || request.status === "pending" && request.expiresAt > Date.now());
  const count = current.filter(request => request.status === "pending").length;
  const panel = open && <Modal title="Private chats" onClose={() => setOpen(false)}>
    <div className={styles.requests}>
      {(error || loadError) && <p className={styles.error} role="alert">{error || loadError}</p>}
      {!current.length && <p>No private chat requests.</p>}
      <ul className={styles.memberList}>
        {current.map(request => <li key={request.id} className={styles.row}>
          <span>{request.alias}<small>
            {request.mode === "chat" ? "Text chat" : request.mode === "voice" ? "Voice" : "Video"}
            {" · "}{request.status === "accepted" ? "Accepted" : request.direction === "incoming" ? "Invited you" : "Request sent"}
          </small></span>
          <div>
            {request.status === "accepted" && request.roomPath ?
              <button className={buttons.secondary} disabled={busy} onClick={() => void act(() => adapter.open(request.roomPath!))}>Open private room</button> :
              request.direction === "incoming" ? <>
                <button disabled={busy} onClick={() => void act(() => adapter.accept(request.id))}>Accept</button>
                <button disabled={busy} onClick={() => void act(() => adapter.decline(request.id))}>Decline</button>
              </> :
              <button disabled={busy} onClick={() => void act(() => adapter.cancel(request.id))}>Cancel</button>}
          </div>
        </li>)}
      </ul>
    </div>
  </Modal>;
  return { invite, count, panel, show: () => setOpen(true) };
}
