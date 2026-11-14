"use client";
import { useId, useState } from "react";
import Link from "next/link";
import { Icon } from "./Icons";
import styles from "./LandingActions.module.css";

type Mode = "video" | "voice" | "chat" | "games";
const modes = [
  { id: "video", label: "Video", icon: Icon.cam, action: "Start a video call" },
  { id: "voice", label: "Voice", icon: Icon.mic, action: "Start a voice call" },
  { id: "chat", label: "Chat", icon: Icon.chat, action: "Start a chat" },
  { id: "games", label: "Games", icon: Icon.dice, action: "Play in a call" },
] as const;

export function LandingActions({ hrefs, gamesUrl }: { hrefs: Record<Mode, string>; gamesUrl: string }) {
  const group = useId();
  const [mode, setMode] = useState<Mode>("video");
  const chosen = modes.find(item => item.id === mode)!;
  return <div className={styles.launch}>
    <fieldset className={styles.modes}>
      <legend className={styles.legend}>How would you like to hang out?</legend>
      {modes.map(item => <label key={item.id} className={styles.mode}>
        <input type="radio" name={group} value={item.id} checked={mode === item.id} onChange={() => setMode(item.id)} />
        <item.icon size={21} color="currentColor" />
        <span>{item.label}</span>
      </label>)}
    </fieldset>
    <Link href={hrefs[mode]} className={styles.start}>{chosen.action}<Icon.arrowRight size={20} color="currentColor" /></Link>
    {mode === "games" && <a className={styles.standalone} href={gamesUrl}>Play games only<Icon.arrowRight size={16} color="currentColor" /></a>}
  </div>;
}
