"use client";

import { useEffect, useRef, useState } from "react";
import { CallPreviewStage } from "./CallPreviewStage";
import { Wordmark } from "../Brand";
import { Icon } from "../Icons";
import styles from "./CallLayoutCheck.module.css";

type Person = { name: string; image: string; ratio: number };
type Message = { author: string; text: string };
const people: Person[] = [
  { name: "You", image: "sq3.jpg", ratio: 1.5 },
  { name: "Alex", image: "alex.jpg", ratio: 1 },
  { name: "Maya", image: "sq4.jpg", ratio: 1.5 },
  { name: "Jules", image: "sq2.jpg", ratio: 1.5 },
  { name: "Sam", image: "sq1.jpg", ratio: 1.5 },
  { name: "Noor", image: "guest-4.jpg", ratio: 2 / 3 },
  { name: "Kim", image: "guest-3.jpg", ratio: 2 / 3 },
  { name: "Rohan", image: "guest-2.jpg", ratio: 4 / 5 },
  { name: "Leo", image: "guest-1.jpg", ratio: 1.5 },
  { name: "Rowan", image: "guest-5.jpg", ratio: 2 / 3 },
];

/** Photos simulate the camera source. The outer frame keeps that source ratio. */
function SampleFeed({ person, cameraOn }: { person: Person; cameraOn: boolean }) {
  return <div className={styles.feed}>
    {cameraOn ? <img className={styles.photo} style={{ objectPosition: person.image === "sq4.jpg" ? "65% center" : "center" }} src={`/img/call-preview/${person.image}`} alt={`${person.name}, sample camera`} />
      : <div className={styles.cameraOff}><Icon.cam size={24} color="#b8afa5" /><span>Camera off</span></div>}
    <span className={styles.name}>{person.name}</span>
  </div>;
}

export function CallLayoutCheck() {
  const [device, setDevice] = useState<"phone" | "tablet" | "desktop">("phone");
  const [mineCount, setMineCount] = useState(2);
  const [theirCount, setTheirCount] = useState(2);
  const [cameraShape, setCameraShape] = useState("comfortable");
  const [cameraOn, setCameraOn] = useState(true);
  const [chatOpen, setChatOpen] = useState(false);
  const [micOn, setMicOn] = useState(true);
  const [left, setLeft] = useState(false);
  const [scope, setScope] = useState<"everyone" | "squad">("everyone");
  const [drafts, setDrafts] = useState({ everyone: "", squad: "" });
  const [messages, setMessages] = useState<Record<typeof scope, Message[]>>({
    everyone: [{ author: "Maya", text: "Hey everyone! 👋" }, { author: "Alex", text: "Okay, important question. Best midnight snack?" }],
    squad: [{ author: "Alex", text: "They seem fun!" }],
  });
  const [showSettings, setShowSettings] = useState(false);
  const messageEnd = useRef<HTMLDivElement>(null);
  useEffect(() => { messageEnd.current?.scrollIntoView({ block: "nearest" }); }, [messages, scope, chatOpen]);
  const widths = { phone: 390, tablet: 768, desktop: 1180 };
  const personFor = (id: string): Person => {
    const index = Number(id.split("-")[1]);
    if (id.startsWith("theirs")) {
      const person = people[(index + 2) % people.length];
      return person;
    }
    if (index < 2) return people[index];
    return { name: ["Dev", "Isha", "Ben", "Ari", "Nico", "Zoe"][index - 2], image: "", ratio: 1 };
  };
  const ratioFor = (id: string) => cameraShape === "comfortable"
    ? (id.startsWith("theirs") ? 4 / 5 : 4 / 3)
    : personFor(id).ratio;
  const cameraOnFor = (id: string) => !id.startsWith("mine") || id === "mine-1" || (id === "mine-0" && cameraOn);
  const mine = Array.from({ length: mineCount }, (_, i) => ({ id: `mine-${i}`, cameraOn: cameraOnFor(`mine-${i}`), aspectRatio: ratioFor(`mine-${i}`) }));
  const theirs = Array.from({ length: theirCount }, (_, i) => ({ id: `theirs-${i}`, cameraOn: true, aspectRatio: ratioFor(`theirs-${i}`) }));
  function sendMessage() {
    const text = drafts[scope].trim();
    if (!text) return;
    setMessages(current => ({ ...current, [scope]: [...current[scope], { author: "You", text }].slice(-200) }));
    setDrafts(current => ({ ...current, [scope]: "" }));
  }
  return <main className={styles.page}>
    <div className={styles.previewLabel}><Wordmark size={23} /><span>Call design · sample people</span></div>
    <section className={styles.previewShell} data-device={device} style={{ width: widths[device] }} aria-label="Interactive sample call">
      <header className={styles.header}>
        <div><strong>Good company.</strong><span>Your squad meets The weekend club</span></div>
        <span className={styles.live}><i /> Preview</span>
      </header>
      {left ? <div className={styles.ended}><Wordmark size={30} /><h1>See you around.</h1><p>You left the sample call.</p><button onClick={() => setLeft(false)}>Rejoin preview</button></div> : <>
        <div className={styles.callBody} data-chat={chatOpen}>
          <div className={styles.stageWrap}>
            <CallPreviewStage mine={mine} theirs={theirs}
              renderPerson={id => <SampleFeed person={personFor(id)} cameraOn={cameraOnFor(id)} />} />
          </div>
          {chatOpen && <aside className={styles.chat} aria-label="Preview chat">
            <div className={styles.chatHeader}><strong>{scope === "squad" ? "Just your squad." : "A conversation for everyone."}</strong><button onClick={() => setChatOpen(false)} aria-label="Back to video"><Icon.close size={18} /></button></div>
            <div className={styles.chatTabs} aria-label="Chat audience"><button aria-pressed={scope === "everyone"} onClick={() => setScope("everyone")}>Everyone</button><button aria-pressed={scope === "squad"} onClick={() => setScope("squad")}>Your squad</button></div>
            <p className={styles.chatHint}>{scope === "squad" ? "Only your squad can see these messages." : "Say hello to both squads."}</p>
            <div className={styles.messages} role="log" aria-live="polite">{messages[scope].map((message, index) => <div key={index} className={styles.message} data-own={message.author === "You"}><small>{message.author}</small><p>{message.text}</p></div>)}<div ref={messageEnd} /></div>
            <form className={styles.composer} onSubmit={event => { event.preventDefault(); sendMessage(); }}><input value={drafts[scope]} maxLength={2000} onChange={event => setDrafts(current => ({ ...current, [scope]: event.target.value }))} placeholder="Say something…" aria-label="Preview chat message" /><button type="submit" disabled={!drafts[scope].trim()} aria-label="Send message"><Icon.enter size={19} color="#faf7f2" /></button></form>
          </aside>}
        </div>
        <div className={styles.controls}>
          <button className={!micOn ? styles.controlOff : ""} onClick={() => setMicOn(value => !value)} aria-pressed={!micOn} aria-label={micOn ? "Mute microphone" : "Unmute microphone"}><Icon.mic size={21} color="currentColor" /><span>{micOn ? "Mic" : "Muted"}</span></button>
          <button className={!cameraOn ? styles.controlOff : ""} onClick={() => setCameraOn(value => !value)} aria-pressed={!cameraOn} aria-label={cameraOn ? "Turn camera off" : "Turn camera on"}><Icon.cam size={21} color="currentColor" /><span>Camera</span></button>
          <button className={chatOpen ? styles.controlActive : ""} onClick={() => setChatOpen(value => !value)} aria-pressed={chatOpen} aria-label="Toggle chat"><Icon.chat size={21} color="currentColor" /><span>Chat</span></button>
          <button className={styles.leave} onClick={() => { setLeft(true); setChatOpen(false); }} aria-label="Leave sample call"><svg width="23" height="23" viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M4 14v3H1v-5c5-6 17-6 22 0v5h-3v-3l-4-2H8z" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" /></svg><span>Leave</span></button>
        </div>
      </>}
    </section>
    <div className={styles.previewTools}><div className={styles.deviceTabs} aria-label="Preview screen size">{(["phone", "tablet", "desktop"] as const).map(value => <button key={value} aria-pressed={device === value} onClick={() => setDevice(value)}>{value[0].toUpperCase() + value.slice(1)}</button>)}</div><button className={styles.settingsToggle} onClick={() => setShowSettings(value => !value)} aria-expanded={showSettings}><Icon.settings size={16} color="currentColor" />Try layouts</button></div>
    {showSettings && <div className={styles.settings} aria-label="Layout preview settings">
      <label>Your squad<select value={mineCount} onChange={event => setMineCount(Number(event.target.value))}>{Array.from({ length: 8 }, (_, i) => <option key={i} value={i + 1}>{i + 1} people</option>)}</select></label>
      <label>Their squad<select value={theirCount} onChange={event => setTheirCount(Number(event.target.value))}>{Array.from({ length: 8 }, (_, i) => <option key={i} value={i + 1}>{i + 1} people</option>)}</select></label>
      <label>Cameras<select value={cameraShape} onChange={event => setCameraShape(event.target.value)}><option value="comfortable">Typical call</option><option value="mixed">Mixed camera shapes</option></select></label>
      <p>Mixed camera shapes use the original photo proportions. Extra friends in your squad join with cameras off. All controls stay inside this preview.</p>
    </div>}
  </main>;
}
