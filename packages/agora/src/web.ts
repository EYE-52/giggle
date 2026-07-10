import type { AgoraToken, RemoteParticipant, VideoClient } from "./types";

// Web implementation backed by agora-rtc-sdk-ng. The SDK is imported
// dynamically so it never runs during Next.js SSR.

export function createVideoClient(): VideoClient {
  let client: any = null;
  let AgoraRTC: any = null;
  let localVideoTrack: any = null;
  let localAudioTrack: any = null;
  let remotes: RemoteParticipant[] = [];
  const listeners = new Set<(r: RemoteParticipant[]) => void>();
  const remoteUsers = new Map<string | number, any>();

  function emit() {
    remotes = Array.from(remoteUsers.values()).map((u) => ({
      uid: u.uid,
      hasVideo: !!u.videoTrack,
      hasAudio: !!u.audioTrack,
    }));
    listeners.forEach((cb) => cb(remotes));
  }

  return {
    get remotes() {
      return remotes;
    },
    onRemoteChange(cb) {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
    async join(token: AgoraToken, opts = { audio: true, video: true }) {
      const mod = await import("agora-rtc-sdk-ng");
      AgoraRTC = mod.default ?? mod;
      // Silence the SDK's own console noise (e.g. benign "WS_ABORT: ping" on
      // leave/reconnect) — we surface meaningful video errors via our own UI.
      try { AgoraRTC.setLogLevel?.(4 /* NONE */); } catch {}
      try { AgoraRTC.disableLogUpload?.(); } catch {}
      client = AgoraRTC.createClient({ mode: "rtc", codec: "vp8" });

      client.on("user-published", async (user: any, mediaType: "video" | "audio") => {
        await client.subscribe(user, mediaType);
        remoteUsers.set(user.uid, user);
        if (mediaType === "audio") user.audioTrack?.play();
        emit();
      });
      client.on("user-unpublished", (user: any) => {
        remoteUsers.set(user.uid, user);
        emit();
      });
      client.on("user-left", (user: any) => {
        remoteUsers.delete(user.uid);
        emit();
      });

      await client.join(token.appId, token.channelName, token.rtcToken, token.uid);

      // Create local tracks best-effort (a missing camera/mic must not break join).
      const toPublish: any[] = [];
      if (opts.audio) {
        try {
          localAudioTrack = await AgoraRTC.createMicrophoneAudioTrack();
          toPublish.push(localAudioTrack);
        } catch {}
      }
      if (opts.video) {
        try {
          localVideoTrack = await AgoraRTC.createCameraVideoTrack();
          toPublish.push(localVideoTrack);
        } catch {}
      }
      if (toPublish.length) await client.publish(toPublish);
    },
    async leave() {
      try {
        localVideoTrack?.stop();
        localVideoTrack?.close();
        localAudioTrack?.stop();
        localAudioTrack?.close();
        await client?.leave();
      } catch {}
      remoteUsers.clear();
      emit();
    },
    async setMicEnabled(on: boolean) {
      // setMuted is the reliable, instant mute (keeps the track published) —
      // unlike setEnabled which unpublishes/stops capture and can race.
      try { await localAudioTrack?.setMuted(!on); }
      catch { try { await localAudioTrack?.setEnabled(on); } catch {} }
    },
    async setCamEnabled(on: boolean) {
      try { await localVideoTrack?.setMuted(!on); }
      catch { try { await localVideoTrack?.setEnabled(on); } catch {} }
    },
    playLocal(el?: unknown) {
      if (localVideoTrack && el) localVideoTrack.play(el as HTMLElement);
    },
    playRemote(uid, el?: unknown) {
      const u = remoteUsers.get(uid);
      if (u?.videoTrack && el) u.videoTrack.play(el as HTMLElement);
    },
  };
}
