"use client";
import { useState } from "react";
import Link from "next/link";
import { Icon } from "./Icons";
import { Modal } from "./Modal";
import styles from "./LandingActions.module.css";

type Mode = "video" | "voice" | "chat" | "games";
const privateWays = [
  { id: "video", label: "Video call", detail: "Faces & familiar voices", icon: Icon.cam },
  { id: "voice", label: "Voice call", detail: "Cameras off, catch-up on", icon: Icon.mic },
  { id: "chat", label: "Text chat", detail: "Keep the conversation going", icon: Icon.chat },
] as const;

export function LandingActions({ hrefs, gamesUrl, groupHref }: { hrefs: Record<Mode, string>; gamesUrl: string; groupHref: string }) {
  const [privateOpen, setPrivateOpen] = useState(false);
  return <div className={styles.launch}>
    <div className={styles.options}>
    <Link href={groupHref} className={styles.start}>Start your group<Icon.arrowRight size={22} color="currentColor" /></Link>
    <button type="button" className={styles.private} aria-haspopup="dialog" onClick={() => setPrivateOpen(true)}>Private hangout<Icon.arrowRight size={20} color="currentColor" /></button>
    </div>
    {privateOpen && <Modal onClose={() => setPrivateOpen(false)} title={<span className={styles.dialogTitle}>Your people. Your plans.</span>} subtitle="An invite-only hangout, however you feel like joining." width="min(520px, calc(100vw - 32px))">
      <div className={styles.privateChoices}>
        {privateWays.map(way => <Link key={way.id} href={hrefs[way.id]} className={styles.way}>
          <span className={styles.wayIcon}><way.icon size={24} color="currentColor" /></span>
          <span><strong>{way.label}</strong><small>{way.detail}</small></span>
          <Icon.arrowRight size={19} color="currentColor" />
        </Link>)}
        <div className={styles.gameNight}>
          <div className={styles.gameHeading}><Icon.dice size={25} color="currentColor" /><div><strong>Make it game night.</strong><p>Play together in a call, or jump straight into games.</p></div></div>
          <div className={styles.gameLinks}><Link href={hrefs.games}>Play in a call<Icon.arrowRight size={16} color="currentColor" /></Link><a href={gamesUrl}>Games only<Icon.arrowRight size={16} color="currentColor" /></a></div>
        </div>
      </div>
    </Modal>}
  </div>;
}
