import type { AgoraToken, CaptureState, RemoteParticipant, VideoClient } from "./types";

export type CallSnapshot = {
  squadId: string | null;
  encounterId: string | null;
  client: VideoClient | null;
  uid: number | null;
  joined: boolean;
  pending: boolean;
  capture: CaptureState;
  remotes: RemoteParticipant[];
  error: unknown;
};

/** A squad owns its call; pages only subscribe and attach playback surfaces. */
export function createCallSession(deps: {
  createClient: () => VideoClient;
  getToken: (squadId: string, encounterId: string | null) => Promise<AgoraToken>;
  setPresence: (squadId: string, encounterId: string | null, on: boolean) => Promise<unknown>;
}) {
  const empty: CallSnapshot = { squadId: null, encounterId: null, client: null, uid: null, joined: false, pending: false, capture: { audio: "off", video: "off" }, remotes: [], error: null };
  let snapshot = empty;
  let epoch = 0;
  let queue: Promise<unknown> = Promise.resolve();
  let record: { squadId: string; encounterId: string | null; client: VideoClient; unsubscribe: (() => void)[] } | null = null;
  const listeners = new Set<() => void>();
  const update = (patch: Partial<CallSnapshot>) => {
    snapshot = { ...snapshot, ...patch };
    listeners.forEach(cb => cb());
  };
  const serial = <T>(job: () => Promise<T>): Promise<T> => {
    const next = queue.catch(() => {}).then(job);
    queue = next;
    return next;
  };

  function stop(): Promise<void> {
    epoch += 1;
    const old = record;
    const oldScope = snapshot.squadId ? { squadId: snapshot.squadId, encounterId: snapshot.encounterId } : null;
    record = null;
    old?.unsubscribe.forEach(off => off());
    // Release capture immediately, even if a token, prompt or transfer is pending.
    const closing = old?.client.leave().catch(() => {});
    // A dismissed browser prompt may resolve much later. New calls must not
    // wait for it; the old job's epoch still rejects and closes any late tracks.
    queue = Promise.resolve();
    snapshot = empty;
    listeners.forEach(cb => cb());
    return serial(async () => {
      await closing;
      if (oldScope) await deps.setPresence(oldScope.squadId, oldScope.encounterId, false).catch(() => {});
    });
  }

  async function renew() {
    return serial(async () => {
      const current = record, attempt = epoch;
      if (!current || !snapshot.joined || !current.client.renewToken) return;
      try {
        const token = await deps.getToken(current.squadId, current.encounterId);
        if (current !== record || attempt !== epoch) return;
        await current.client.renewToken(token);
      } catch (error) {
        if (current === record && attempt === epoch) update({ error });
      }
    });
  }

  function connect(squadId: string, encounterId: string | null = null, devices = { audio: false, video: false }) {
    if (snapshot.squadId && snapshot.squadId !== squadId) void stop();
    const attempt = epoch;
    update({ pending: true, error: null, ...(record ? {} : { squadId, encounterId }) });
    return serial(async () => {
      const assertCurrent = () => { if (attempt !== epoch) throw new Error("Call cancelled."); };
      let current = record;
      let fresh = false;
      try {
        assertCurrent();
        update({ pending: true });
        if (current && current.squadId === squadId && current.encounterId === encounterId && snapshot.joined) return current.client;
        const token = await deps.getToken(squadId, encounterId);
        assertCurrent();
        if (!current) {
          fresh = true;
          current = { squadId, encounterId, client: deps.createClient(), unsubscribe: [] };
          record = current;
          const owned = current;
          update({ squadId, encounterId, client: current.client, uid: token.uid });
          current.unsubscribe.push(current.client.onRemoteChange(remotes => { if (record === owned) update({ remotes }); }));
          const offCapture = current.client.onCaptureState?.(capture => { if (record === owned) update({ capture }); });
          const offToken = current.client.onTokenExpiring?.(() => { void renew(); });
          const offConnection = current.client.onConnectionState?.(state => {
            if (record === owned && state === "DISCONNECTED") update({ joined: false });
            if (record === owned && state === "CONNECTED" && !snapshot.pending) update({ joined: true });
          });
          if (offCapture) current.unsubscribe.push(offCapture);
          if (offToken) current.unsubscribe.push(offToken);
          if (offConnection) current.unsubscribe.push(offConnection);
          await current.client.join(token, devices);
        } else {
          if (!current.client.moveToChannel) throw new Error("This device cannot change call rooms.");
          update({ joined: false });
          await current.client.moveToChannel(token);
        }
        assertCurrent();
        current.encounterId = encounterId;
        update({ joined: true, encounterId, uid: token.uid });
        await deps.setPresence(squadId, encounterId, true);
        assertCurrent();
        return current.client;
      } catch (error) {
        if (attempt === epoch) {
          if (fresh && !snapshot.joined && current === record) {
            current?.unsubscribe.forEach(off => off());
            record = null;
            update({ client: null, capture: { audio: "off", video: "off" }, remotes: [] });
            await current?.client.leave().catch(() => {});
          }
          if (attempt === epoch) {
            // Token preparation can mark presence before a join. Restore the
            // room that is still connected, or clear both flags on failure.
            await deps.setPresence(squadId, record ? record.encounterId : encounterId, snapshot.joined).catch(() => {});
            if (attempt === epoch) update({ error });
          }
        }
        if (attempt !== epoch) {
          // Run after replacement work: a late token must not leave the old
          // encounter marked present or clear a newer call in the same squad.
          await serial(async () => {
            if (record?.squadId === squadId) {
              if (snapshot.joined) await deps.setPresence(squadId, record.encounterId, true);
            } else {
              await deps.setPresence(squadId, encounterId, false);
            }
          }).catch(() => {});
        }
        throw error;
      } finally {
        if (attempt === epoch) update({ pending: false });
      }
    });
  }

  function setDevice(squadId: string, kind: "audio" | "video", on: boolean): Promise<void> {
    if (!record || record.squadId !== squadId || !snapshot.joined) {
      if (!on) return Promise.resolve();
      const wasConnected = !!record && record.squadId === squadId;
      return connect(squadId, wasConnected ? record!.encounterId : null, { audio: kind === "audio", video: kind === "video" })
        .then(() => wasConnected ? setDevice(squadId, kind, on) : undefined);
    }
    const attempt = epoch;
    update({ pending: true, error: null });
    return serial(async () => {
      try {
        if (attempt !== epoch || record?.squadId !== squadId) throw new Error("Call cancelled.");
        await (kind === "audio" ? record.client.setMicEnabled(on) : record.client.setCamEnabled(on));
      } catch (error) {
        if (attempt === epoch) update({ error });
        throw error;
      } finally {
        if (attempt === epoch) update({ pending: false });
      }
    });
  }

  return {
    getSnapshot: () => snapshot,
    getServerSnapshot: () => empty,
    subscribe(cb: () => void) { listeners.add(cb); return () => listeners.delete(cb); },
    connect,
    setDevice,
    stop,
    returnToSquad: () => record && (record.encounterId || !snapshot.joined) ? connect(record.squadId) : Promise.resolve(record?.client ?? null),
    bindSquad(squadId: string) { if (snapshot.squadId && snapshot.squadId !== squadId) void stop(); },
  };
}
