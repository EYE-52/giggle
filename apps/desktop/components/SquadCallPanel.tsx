"use client";
import { useEffect, useRef, useState } from "react";
import { session } from "@giggle/core";
import { squadCall, useSquadCall } from "@/lib/squadCall";
import { describeVideoError } from "@/lib/videoError";
import { ParticipantVideoTile } from "./ParticipantVideoTile";
import { ScreenShareButton } from "./ScreenShareButton";
import { isScreenSharing, useScreenSharingClock } from "@/lib/screenShareView";
import { Button } from "./Button";
import { Icon } from "./Icons";
import type { FaceOffPerson } from "./FaceOff";
import styles from "./SquadCallPanel.module.css";

/** The same squad call and capture sources used by lobby and encounter. */
export function SquadCallPanel({ squadId, people, selfUserId = session.user?.id, communicationMode = "video" }: { squadId: string; people: FaceOffPerson[]; selfUserId?:string; communicationMode?:"chat"|"voice"|"video" }) {
  const media = useSquadCall(squadId);
  const now = useScreenSharingClock(people);
  const screenOn = media.capture.screen === "active";
  const allowedKey=people.filter(person=>person.userId!==selfUserId && person.uid!=null).map(person=>person.uid).join("|");
  useEffect(()=>{void media.client?.setAllowedRemoteUids?.(allowedKey ? allowedKey.split("|") : []).catch(()=>{});},[media.client,allowedKey]);
  const micOn = media.capture.audio === "active", camOn = media.capture.video === "active";
  const [error, setError] = useState("");
  const busyRef = useRef(false);
  const [speaking, setSpeaking] = useState<string[]>([]);
  useEffect(() => media.client?.onVolumes?.(levels => {
    setSpeaking(levels.filter(level => level.level > 5).map(level => String(level.uid)));
  }), [media.client]);

  async function toggle(kind: "audio" | "video") {
    if (busyRef.current || media.pending) return;
    busyRef.current = true; setError("");
    try { await squadCall.setDevice(squadId, kind, kind === "audio" ? !micOn : !camOn); }
    catch (error) { setError(describeVideoError(error)); }
    finally { busyRef.current = false; }
  }

  const captureProblem = media.capture.audio === "denied" || media.capture.video === "denied"
    ? "A device is blocked. Allow access in your browser, then try its button again."
    : media.capture.audio === "unavailable" || media.capture.video === "unavailable"
      ? "A device couldn't start. Try its button again."
      : "";
  const notice = error || (media.error ? describeVideoError(media.error) : captureProblem);
  return <div className={styles.panel} data-testid="search-squad-call" aria-label="Your squad call">
    <div className={styles.tiles} data-count={people.length}>
      {people.map((person, index) => {
        const isMe = person.userId === selfUserId;
        const remote = media.remotes.find(remote => String(remote.uid) === String(person.uid));
        const hasVideo = isMe ? screenOn || camOn : !!remote?.hasVideo;
        const uid = isMe ? media.uid : person.uid;
        return <div key={person.userId ?? index} className={styles.tile}>
          <ParticipantVideoTile name={person.displayName} colorIndex={index} avatarValue={person.avatar ?? undefined}
            isLocal={isMe} hasVideo={hasVideo} screenSharing={isMe ? screenOn : isScreenSharing(person, now)} micOn={isMe ? micOn : remote?.hasAudio}
            isSpeaking={uid != null && speaking.includes(String(uid))} mutedForMe={remote?.mutedForMe}
            videoRef={element => {
              if (!element || !hasVideo) return;
              try { if (isMe) media.client?.playLocal(element); else if (person.uid != null) media.client?.playRemote(person.uid, element); }
              catch { setError("Couldn't show this video. Try reconnecting your call."); }
            }}
            onMute={!isMe && remote && person.uid != null ? muted => media.client!.setRemoteAudioMuted(person.uid!, muted) : undefined}
            statusText={isMe && media.pending ? "Connecting…" : "Camera off"} />
        </div>;
      })}
    </div>
    <div className={styles.controls} role="group" aria-label="Squad camera and microphone" aria-busy={media.pending}>
      <button type="button" className={styles.control} data-off={!micOn || undefined} disabled={media.pending || communicationMode === "chat"} aria-pressed={!micOn}
        aria-label={micOn ? "Mute microphone" : "Turn on microphone"} onClick={() => void toggle("audio")}>
        {micOn ? <Icon.mic size={19} /> : <Icon.micOff size={19} />}<span>{micOn ? "Mic" : "Mic off"}</span>
      </button>
      <button type="button" className={styles.control} data-off={!camOn || undefined} disabled={media.pending || communicationMode !== "video"} aria-pressed={camOn}
        aria-label={camOn ? "Turn camera off" : "Turn camera on"} onClick={() => void toggle("video")}>
        {camOn ? <Icon.cam size={19} /> : <Icon.camOff size={19} />}<span>{camOn ? "Camera" : "Camera off"}</span>
      </button>
      <ScreenShareButton client={media.client} capture={media.capture} disabled={media.pending || !media.joined}
        onStart={() => squadCall.startScreenShare(squadId)} onStop={() => squadCall.stopScreenShare(squadId)} onError={setError} />
      {communicationMode !== "chat" && !media.joined && !media.pending && <Button size="sm" variant="secondary" onClick={() => {
        setError(""); void squadCall.connect(squadId, null, { audio: true, video: communicationMode === "video" }).catch(error => setError(describeVideoError(error)));
      }}>Start squad call</Button>}
    </div>
    <p className={styles.status} role="status">{media.pending ? <><span className="gg-spinner" aria-hidden="true" />Connecting your devices…</> : media.joined ? "Keep chatting with your squad." : "Your devices stay off until you turn them on."}</p>
    {notice && <p role="alert" className={styles.error}>{notice}</p>}
  </div>;
}
