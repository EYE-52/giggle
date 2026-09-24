"use client";

import Link from "next/link";
import { Wordmark } from "@/components/Brand";
import { useEffect, useRef, useState } from "react";
import { GiggleAvatar, type AvatarExpression, type AvatarFace, type AvatarGlasses, type AvatarFacialHair } from "../../../../packages/avatars/src";
import { api, session, getMyAvatar, parseCharacter, encodeCharacter, CHARACTER_DEFAULTS, CHARACTER_OPTIONS, type CharacterConfig } from "@giggle/core";
import { saveMyAvatar } from "@/lib/avatarSync";
import PhotoMatch from "./PhotoMatch";
import styles from "./playground.module.css";

const initial: CharacterConfig = { ...CHARACTER_DEFAULTS };
const presets: { name: string; settings: typeof initial }[] = [
  { name: "Curls", settings: { ...initial, skin: "#684332", hairColor: "#25252a", shirtColor: "#c8502e", accent: "#eab676", expression: "laugh", freckles: true, eyeSize: 40 } },
  { name: "Bob", settings: { ...initial, hair: "bob", clothing: "sweater", earrings: "hoops", accessoryColor: "#d2a951", face: "round", skin: "#f6d4b8", hairColor: "#39302e", shirtColor: "#2f6f5e", accent: "#93b8d4", expression: "surprised", eyeSpacing: 40, faceWidth: 35 } },
  { name: "Swoop", settings: { ...initial, hair: "swoop", clothing: "jacket", face: "angular", skin: "#493126", hairColor: "#25252a", shirtColor: "#274e67", accessoryColor: "#e9a13b", accent: "#e5a9a0", glasses: "round", eyeSize: 45 } },
];
const sections = ["Face", "Hair", "Details", "Outfit", "Colors"] as const;
type Section = typeof sections[number];
const proportions = { faceWidth: "Face width", eyeSize: "Eye size", eyeSpacing: "Eye spacing", browTilt: "Brow angle", noseSize: "Nose size", mouthWidth: "Mouth width" } as const;
const colors = { skin: "Skin tone", hairColor: "Hair color", shirtColor: "Clothing", accessoryColor: "Accessories", accent: "Background" } as const;

const palettes: Record<keyof typeof colors, string[]> = {
  skin: ["#f6d4b8", "#efbd98", "#dca47c", "#bd815e", "#a36c4b", "#86523e", "#684332", "#493126"],
  hairColor: ["#25252a", "#39302e", "#633e30", "#9e5a39", "#c18a49", "#dfbf85", "#bcb4ad", "#ece0c9"],
  shirtColor: ["#f4ecdd", "#d97654", "#953d48", "#bd943e", "#657f6b", "#446c87", "#8c8ebe", "#30313b", "#c8502e", "#e9a13b", "#2f6f5e", "#274e67", "#6f5aa8"],
  accessoryColor: ["#d2a951", "#c5c7cc", "#74618c", "#466957", "#a45443", "#324d67", "#dfb9ae", "#292b32", "#c8502e", "#1f7a6d", "#e9a13b", "#8c2f39"],
  accent: ["#e5dbc9", "#e4dce9", "#d5e2dd", "#d9e6ef", "#f1d9ca", "#efdfa7", "#e6ccd4", "#dededc", "#eab676", "#a9c6a2", "#93b8d4", "#e5a9a0", "#274e67", "#b7a3d9"],
};
function ColorChoices({ name, value, onChange }: { name: keyof typeof colors; value: string; onChange: (color: string) => void }) {
  return <fieldset className={styles.colorGroup}><legend>{colors[name]}</legend><div className={styles.swatches}>{palettes[name].map((color, index) => <button key={color} type="button" aria-label={`${colors[name]} option ${index + 1}: ${color}`} title={color} aria-pressed={value.toLowerCase() === color} style={{ backgroundColor: color }} onClick={() => onChange(color)}>{value.toLowerCase() === color && <span aria-hidden="true">✓</span>}</button>)}<label className={styles.customColor}><span>Custom</span><input aria-label={`Custom ${colors[name].toLowerCase()}`} type="color" value={value} onChange={e => onChange(e.target.value)} /></label></div></fieldset>;
}

export default function AvatarPlayground() {
  const [avatar, setAvatar] = useState(presets[0].settings);
  const [section, setSection] = useState<Section>("Face");
  const [notice, setNotice] = useState("");
  const [authed, setAuthed] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState("");
  const edited = useRef(false);
  useEffect(() => {
    let cancelled = false;
    setAuthed(session.isAuthed());
    if (!session.isAuthed()) return;
    const local = parseCharacter(getMyAvatar());
    if (local) setAvatar(local);
    void api.getMyProfile().then(profile => {
      const saved = parseCharacter(profile.avatar);
      if (!cancelled && !edited.current && saved) setAvatar(saved);
    }).catch(() => { if (!cancelled) setSaveError("Couldn’t load your saved character. You can still edit and try saving again."); });
    return () => { cancelled = true; };
  }, []);
  async function save() {
    setSaving(true); setSaveError(""); setNotice("");
    try {
      await saveMyAvatar(encodeCharacter(avatar));
      setNotice("Saved to your profile. Friends and squads will see this character.");
    } catch { setSaveError("Couldn’t save your character. Your changes are still here—try again."); }
    finally { setSaving(false); }
  }
  function update<K extends keyof typeof initial>(key: K, value: typeof initial[K]) {
    edited.current = true;
    setAvatar(current => ({ ...current, [key]: value }));
    setNotice("");
  }
  function applyFromPhoto(config: CharacterConfig) {
    edited.current = true;
    setAvatar(config);
    setNotice("Photo match applied — press Save to keep it.");
  }
  function download() {
    const blob = new Blob([JSON.stringify({ version: 1, ...avatar }, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url; link.download = "giggle-character.json"; link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    setNotice("Character settings exported. Your profile has not changed.");
  }
  return <main className={styles.page}>
    <header className={styles.header}><Link href="/" aria-label="Giggle home"><Wordmark size={26} /></Link><Link href={authed ? "/profile" : "/"}>{authed ? "Back to profile" : "Back to Giggle"} ↗</Link></header>
    <section className={styles.intro}><div><h1>Your character.</h1><p>Choose a look, then make it yours.</p></div><span className={styles.editorLabel}>Character studio</span></section>
    <fieldset className={styles.studio} disabled={saving} aria-label="Character editor">
      <section className={styles.preview} aria-label="Your character preview">
        <div className={styles.stage}><div className={styles.character}><GiggleAvatar {...avatar} size="100%" label="Your customized character" /></div></div>
        <div className={styles.expressionRow} aria-label="Expression">{(["smile", "laugh", "wink", "surprised"] as AvatarExpression[]).map(value => <button type="button" key={value} aria-pressed={avatar.expression === value} onClick={() => update("expression", value)}>{value}</button>)}</div>
        <label className={styles.motion}><input type="checkbox" checked={avatar.animated} onChange={e => update("animated", e.target.checked)} /> Animate</label>
        <div className={styles.presets}><span>Start with a look</span><div>{presets.map(preset => <button type="button" key={preset.name} aria-label={`Start with ${preset.name}`} onClick={() => { edited.current = true; setAvatar({ ...preset.settings }); setNotice(""); }}><GiggleAvatar {...preset.settings} animated={false} size={58} label="" /></button>)}</div></div>
      </section>
      <section className={styles.controls} aria-label="Customize your character">
        <div className={styles.tabs} aria-label="Character controls">{sections.map(value => <button key={value} type="button" aria-pressed={section === value} onClick={() => setSection(value)}>{value}</button>)}</div>
        <div className={styles.panel}>
          {section === "Face" && <>
            <fieldset><legend>Face shape</legend><div className={styles.choices}>{(["soft", "round", "angular"] as AvatarFace[]).map(value => <button key={value} type="button" aria-pressed={avatar.face === value} onClick={() => update("face", value)}><GiggleAvatar {...avatar} hair="bald" headwear="none" face={value} size={62} animated={false} label="" />{value}</button>)}</div></fieldset>
            <details className={styles.adjustments}><summary>Fine-tune proportions</summary><div className={styles.sliderGrid}>{(Object.keys(proportions) as (keyof typeof proportions)[]).map(key => <label key={key} className={styles.slider}><span>{proportions[key]}<output>{avatar[key]}</output></span><input type="range" min="0" max="100" value={avatar[key]} aria-label={proportions[key]} onChange={e => update(key, Number(e.target.value))} /></label>)}</div></details>
          </>}
          {section === "Hair" && <>
            <fieldset><legend>Hairstyle</legend><div className={styles.choices}>{CHARACTER_OPTIONS.hair.map(value => <button key={value} type="button" aria-pressed={avatar.hair === value} onClick={() => update("hair", value)}><GiggleAvatar {...avatar} hair={value} headwear="none" size={68} animated={false} label="" />{value}</button>)}</div></fieldset>
            <fieldset><legend>Facial hair</legend><div className={styles.choices}>{(["none", "stubble", "beard", "mustache"] as AvatarFacialHair[]).map(value => <button key={value} type="button" aria-pressed={avatar.facialHair === value} onClick={() => update("facialHair", value)}>{value}</button>)}</div></fieldset>
          </>}
          {section === "Details" && <>
            <fieldset><legend>Glasses</legend><div className={styles.choices}>{(["none", "round", "square"] as AvatarGlasses[]).map(value => <button key={value} type="button" aria-pressed={avatar.glasses === value} onClick={() => update("glasses", value)}><GiggleAvatar {...avatar} glasses={value} size={68} animated={false} label="" />{value}</button>)}</div></fieldset>
            <label className={styles.toggle}><input type="checkbox" checked={avatar.freckles} onChange={e => update("freckles", e.target.checked)} /> Freckles</label>
          </>}
          {section === "Outfit" && <>
            <fieldset><legend>Clothes</legend><div className={styles.choices}>{CHARACTER_OPTIONS.clothing.map(value => <button key={value} type="button" aria-pressed={avatar.clothing === value} onClick={() => update("clothing", value)}><GiggleAvatar {...avatar} clothing={value} size={76} animated={false} label="" />{value}</button>)}</div></fieldset>
            <ColorChoices name="shirtColor" value={avatar.shirtColor} onChange={value => update("shirtColor", value)} />
            <fieldset><legend>Headwear</legend><div className={styles.choices}>{CHARACTER_OPTIONS.headwear.map(value => <button key={value} type="button" aria-pressed={avatar.headwear === value} onClick={() => update("headwear", value)}><GiggleAvatar {...avatar} headwear={value} size={68} animated={false} label="" />{value}</button>)}</div></fieldset>
            <fieldset><legend>Earrings</legend><div className={styles.choices}>{CHARACTER_OPTIONS.earrings.map(value => <button key={value} type="button" aria-pressed={avatar.earrings === value} onClick={() => update("earrings", value)}>{value}</button>)}</div></fieldset>
          </>}
          {section === "Colors" && (Object.keys(colors) as (keyof typeof colors)[]).map(key => <ColorChoices key={key} name={key} value={avatar[key]} onChange={value => update(key, value)} />)}
        </div>
        <div className={styles.actions}>{authed ? <button type="button" disabled={saving} onClick={save}>{saving ? "Saving…" : "Save to profile"}</button> : <Link href="/signin">Sign in to save</Link>}<button type="button" onClick={download}>Export</button><button type="button" onClick={() => { edited.current = true; setAvatar({ ...initial }); setNotice("Character reset."); }}>Reset</button></div>
        {saveError && <p role="alert" className={styles.error}>{saveError}</p>}
        <p role="status" className={styles.notice}>{notice}</p>
        <PhotoMatch authed={authed} baseConfig={avatar} onApply={applyFromPhoto} />
        <p className={styles.note}>Your character is made from Giggle’s own artwork.</p>
      </section>
    </fieldset>
  </main>;
}
