"use client";
import { useEffect, useId, useState } from "react";
import { classifyVibe } from "@giggle/core";
import { MAX_TOPICS, normalizeTopics, SUGGESTED_TOPICS } from "@/lib/topics";
import { Chip } from "./Chip";
import { Button } from "./Button";
import styles from "./TopicPicker.module.css";

export function TopicPicker({ value, onChange, disabled = false }: { value: string[]; onChange: (topics: string[]) => void; disabled?: boolean }) {
  const [query, setQuery] = useState("");
  const [custom, setCustom] = useState<string[]>([]);
  const [error, setError] = useState("");
  const hintId = useId();
  useEffect(() => {
    try {
      const saved = JSON.parse(localStorage.getItem("giggle.customVibes") ?? "[]");
      if (Array.isArray(saved)) setCustom(saved.filter(t => typeof t === "string" && t.length <= 15 && classifyVibe(t) === "ok").slice(0, 40));
    } catch {}
  }, []);
  function toggle(topic: string) {
    setError("");
    const selected = value.some(t => t.toLowerCase() === topic.toLowerCase());
    if (selected) onChange(value.filter(t => t.toLowerCase() !== topic.toLowerCase()));
    else if (value.length < MAX_TOPICS && classifyVibe(topic) === "ok") onChange([...value, topic]);
  }
  function add() {
    const label = query.normalize("NFKC").replace(/^[#\s]+/, "").replace(/\s+/g, " ").trim();
    if (!label) return;
    if (classifyVibe(label) !== "ok") { setError("Sexual, hateful and harmful topics aren't allowed. Choose another topic."); return; }
    if (label.length > 15) { setError("Keep topics to 15 characters or fewer."); return; }
    if (value.length >= MAX_TOPICS && !value.some(t => t.toLowerCase() === label.toLowerCase())) { setError("Choose up to five topics. Remove one to add another."); return; }
    onChange(normalizeTopics([...value, label]));
    const next = [...new Set([label, ...custom])].slice(0, 40);
    setCustom(next);
    try { localStorage.setItem("giggle.customVibes", JSON.stringify(next)); } catch {}
    setQuery(""); setError("");
  }
  const options = [...new Map([...value, ...custom, ...SUGGESTED_TOPICS].filter(t => classifyVibe(t) === "ok").map(t => [t.toLowerCase(), t])).values()];
  return <fieldset className={styles.picker} disabled={disabled}>
    <legend>Topics <span>{value.length}/{MAX_TOPICS}</span></legend>
    <p id={hintId}>Choose what you want to talk about. Optional.</p>
    <div className={styles.options} role="group" aria-label="Choose topics">
      {options.filter(t => value.some(v => v.toLowerCase() === t.toLowerCase()) || t.toLowerCase().includes(query.toLowerCase())).map(topic => <Chip key={topic.toLowerCase()} selected={value.some(t => t.toLowerCase() === topic.toLowerCase())} disabled={!value.some(t => t.toLowerCase() === topic.toLowerCase()) && value.length >= MAX_TOPICS} onClick={() => toggle(topic)}>{topic}</Chip>)}
    </div>
    <div className={styles.add}>
      <input className="input" value={query} aria-label="Find or add a topic" aria-describedby={hintId} maxLength={32} placeholder="Find or add a topic" onChange={event => { setQuery(event.target.value); setError(""); }} onKeyDown={event => { if (event.key === "Enter") { event.preventDefault(); add(); } }} />
      <Button variant="secondary" size="sm" disabled={!query.trim()} onClick={add}>Add</Button>
    </div>
    {error && <p role="alert" className={styles.error}>{error}</p>}
  </fieldset>;
}
