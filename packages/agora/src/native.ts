import type { AgoraToken, RemoteParticipant, VideoClient } from "./types";

// Native implementation backed by react-native-agora. Screens render video via
// <RtcSurfaceView canvas={{ uid }} /> — uid 0 is the local user. This client
// manages the engine, join/leave, mic/cam, and tracks remote uids.

export function createVideoClient(): VideoClient {
  // Lazy require so the web bundle never touches the native module.
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const Agora = require("react-native-agora");
  const createAgoraRtcEngine = Agora.createAgoraRtcEngine;
  const { ChannelProfileType, ClientRoleType } = Agora;

  let engine: any = null;
  let remotes: RemoteParticipant[] = [];
  const listeners = new Set<(r: RemoteParticipant[]) => void>();
  const remoteUids = new Set<number>();

  function emit() {
    remotes = Array.from(remoteUids).map((uid) => ({ uid, hasVideo: true, hasAudio: true }));
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
      engine = createAgoraRtcEngine();
      engine.initialize({ appId: token.appId });
      engine.registerEventHandler({
        onUserJoined: (_conn: any, uid: number) => {
          remoteUids.add(uid);
          emit();
        },
        onUserOffline: (_conn: any, uid: number) => {
          remoteUids.delete(uid);
          emit();
        },
      });
      engine.enableVideo();
      if (opts.video) engine.startPreview();
      engine.setChannelProfile(ChannelProfileType.ChannelProfileCommunication);
      engine.joinChannel(token.rtcToken, token.channelName, token.uid, {
        clientRoleType: ClientRoleType.ClientRoleBroadcaster,
        publishMicrophoneTrack: opts.audio,
        publishCameraTrack: opts.video,
        autoSubscribeAudio: true,
        autoSubscribeVideo: true,
      });
    },
    async leave() {
      try {
        engine?.leaveChannel();
        engine?.release();
      } catch {}
      remoteUids.clear();
      emit();
    },
    async setMicEnabled(on: boolean) {
      engine?.muteLocalAudioStream(!on);
    },
    async setCamEnabled(on: boolean) {
      engine?.muteLocalVideoStream(!on);
      if (on) engine?.startPreview();
      else engine?.stopPreview();
    },
    playLocal() {
      /* render <RtcSurfaceView canvas={{ uid: 0 }} /> in the screen */
    },
    playRemote() {
      /* render <RtcSurfaceView canvas={{ uid }} /> in the screen */
    },
  };
}
