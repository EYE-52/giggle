"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { api, ApiError } from "@giggle/core";
import type { AvatarSuggestOutcome, CharacterConfig } from "@giggle/core";
import { GiggleAvatar } from "../../../../packages/avatars/src";
import {
  PHOTO_ZOOM_MAX,
  PHOTO_ZOOM_MIN,
  clampCropOffsets,
  computeCrop,
  cropToJpegDataUrl,
  validatePhotoFile,
} from "@/lib/photoPrep";
import styles from "./photoMatch.module.css";

type PhotoMatchProps = {
  authed: boolean;
  /** The editor's current config — snapshotted as `base` when a match starts. */
  baseConfig: CharacterConfig;
  /** Replaces the editor state. The user still has to press Save. */
  onApply: (config: CharacterConfig) => void;
};

type Phase = "pick" | "preview" | "busy" | "result";
type Outcome =
  | { kind: "match"; configs: CharacterConfig[] }
  | { kind: "none"; status: Exclude<AvatarSuggestOutcome, "match"> }
  | { kind: "error"; code: string };

const optionLabels = ["Closest", "Option 2", "Option 3"];

const noMatchLines: Record<Exclude<AvatarSuggestOutcome, "match">, string> = {
  no_face: "We couldn’t find a face in that photo. Try one where your face is clear and uncovered.",
  multiple_faces: "We found more than one face. Try a photo with just you in it.",
  unclear_photo: "That photo was hard to read. Try a brighter, closer one.",
};

/** Short, human messages — raw server messages never reach the UI. */
function errorLine(code: string): string {
  switch (code) {
    case "RATE_LIMITED": return "That was quick — wait a moment before trying another photo.";
    case "QUOTA_EXCEEDED": return "You’ve used all of today’s photo matches. Try again tomorrow.";
    case "BUDGET_EXHAUSTED":
    case "UNAVAILABLE": return "Photo matching isn’t available right now. Try again later.";
    case "MATCH_TIMEOUT": return "Matching took too long. Try again in a moment.";
    case "IN_PROGRESS": return "An earlier match is still finishing. Try again in a moment.";
    case "INVALID_IMAGE":
    case "IMAGE_TOO_LARGE": return "That file didn’t work as a photo. Choose another one.";
    case "INVALID_REQUEST": return "Something went wrong preparing your photo. Choose another and try again.";
    case "MATCH_FAILED": return "We couldn’t turn that photo into character options. Try another photo.";
    case "FEATURE_DISABLED": return "Photo matching is switched off right now.";
    case "network_error": return "Couldn’t reach the matching service. Check your connection and try again.";
    default: return "Something went wrong matching your photo. Try again.";
  }
}

/** Errors where picking a different photo is the sensible next step. */
const chooseAnotherCodes = new Set([
  "INVALID_IMAGE", "IMAGE_TOO_LARGE", "INVALID_REQUEST", "MATCH_FAILED",
  "MATCH_TIMEOUT", "RATE_LIMITED", "IN_PROGRESS", "network_error",
]);

export default function PhotoMatch({ authed, baseConfig, onApply }: PhotoMatchProps) {
  const [enabled, setEnabled] = useState(false);
  const [open, setOpen] = useState(false);
  const [phase, setPhase] = useState<Phase>("pick");
  const [outcome, setOutcome] = useState<Outcome | null>(null);
  const [pickError, setPickError] = useState("");
  const [photoUrl, setPhotoUrl] = useState("");
  const [dims, setDims] = useState({ w: 0, h: 0 });
  const [zoom, setZoom] = useState(PHOTO_ZOOM_MIN);
  const [offsets, setOffsets] = useState({ offsetX: 0, offsetY: 0 });

  const bitmapRef = useRef<ImageBitmap | null>(null);
  const urlRef = useRef<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const cameraInputRef = useRef<HTMLInputElement>(null);
  const dragRef = useRef<{ pointerId: number; startX: number; startY: number; offsetX: number; offsetY: number } | null>(null);
  /** Bumped on cancel/close/unmount so late resolutions are ignored. */
  const flowRef = useRef(0);

  // Feature flag check — render nothing while unknown, off, or unreachable.
  useEffect(() => {
    if (!authed) return;
    let cancelled = false;
    api.getAvatarSuggestStatus()
      .then(status => { if (!cancelled && status.enabled) setEnabled(true); })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [authed]);

  const dropPhoto = useCallback(() => {
    if (bitmapRef.current) { bitmapRef.current.close(); bitmapRef.current = null; }
    if (urlRef.current) { URL.revokeObjectURL(urlRef.current); urlRef.current = null; }
    setPhotoUrl("");
    setDims({ w: 0, h: 0 });
    setZoom(PHOTO_ZOOM_MIN);
    setOffsets({ offsetX: 0, offsetY: 0 });
    if (fileInputRef.current) fileInputRef.current.value = "";
    if (cameraInputRef.current) cameraInputRef.current.value = "";
  }, []);

  const resetToPick = useCallback(() => {
    flowRef.current += 1;
    dropPhoto();
    setPhase("pick");
    setOutcome(null);
    setPickError("");
  }, [dropPhoto]);

  // Never keep the photo around after unmount.
  useEffect(() => () => {
    flowRef.current += 1;
    if (bitmapRef.current) { bitmapRef.current.close(); bitmapRef.current = null; }
    if (urlRef.current) { URL.revokeObjectURL(urlRef.current); urlRef.current = null; }
  }, []);

  function closePanel() {
    setOpen(false);
    resetToPick();
  }

  async function onFile(file: File | null | undefined) {
    if (!file) return;
    setPickError("");
    const valid = validatePhotoFile(file);
    if (!valid.ok) {
      setPickError(valid.reason === "size"
        ? "That photo is larger than 10 MB. Choose a smaller one."
        : "Please choose a JPEG, PNG, or WebP photo.");
      return;
    }
    const version = flowRef.current;
    try {
      const bitmap = await createImageBitmap(file, { imageOrientation: "from-image" });
      if (version !== flowRef.current) { bitmap.close(); return; }
      if (bitmapRef.current) bitmapRef.current.close();
      bitmapRef.current = bitmap;
      if (urlRef.current) URL.revokeObjectURL(urlRef.current);
      urlRef.current = URL.createObjectURL(file);
      setPhotoUrl(urlRef.current);
      setDims({ w: bitmap.width, h: bitmap.height });
      setZoom(PHOTO_ZOOM_MIN);
      setOffsets({ offsetX: 0, offsetY: 0 });
      setOutcome(null);
      setPhase("preview");
    } catch {
      setPickError("We couldn’t read that photo. Try a different file.");
    }
  }

  async function match() {
    const bitmap = bitmapRef.current;
    if (!bitmap || phase !== "preview") return;
    const version = flowRef.current;
    setPhase("busy");
    setOutcome(null);
    const rect = computeCrop({ imgW: dims.w, imgH: dims.h, zoom, offsetX: offsets.offsetX, offsetY: offsets.offsetY });
    let image: string;
    try {
      image = cropToJpegDataUrl(bitmap, rect);
    } catch {
      setPhase("result");
      setOutcome({ kind: "error", code: "INVALID_REQUEST" });
      dropPhoto();
      return;
    }
    try {
      const result = await api.suggestAvatar({ image, base: baseConfig, requestId: crypto.randomUUID() });
      if (version !== flowRef.current) return;
      if (result.status === "match" && Array.isArray(result.configs) && result.configs.length > 0) {
        setOutcome({ kind: "match", configs: result.configs });
      } else if (result.status !== "match") {
        setOutcome({ kind: "none", status: result.status });
      } else {
        setOutcome({ kind: "error", code: "MATCH_FAILED" });
      }
      setPhase("result");
    } catch (error) {
      if (version !== flowRef.current) return;
      setOutcome({ kind: "error", code: error instanceof ApiError ? error.code : "network_error" });
      setPhase("result");
    } finally {
      // The photo (bitmap, object URL, data URL) is dropped once the request
      // finishes; only the offered configs remain.
      if (version === flowRef.current) dropPhoto();
    }
  }

  function apply(config: CharacterConfig) {
    onApply(config);
    closePanel();
  }

  function changeZoom(value: number) {
    setZoom(value);
    setOffsets(current => clampCropOffsets({
      imgW: dims.w, imgH: dims.h, zoom: value, offsetX: current.offsetX, offsetY: current.offsetY,
    }));
  }

  // Drag-to-reposition. The preview shows exactly the rect computeCrop returns,
  // so moving the photo re-centers the crop via offsets.
  function onPointerDown(event: React.PointerEvent<HTMLDivElement>) {
    if (phase === "busy") return;
    dragRef.current = { pointerId: event.pointerId, startX: event.clientX, startY: event.clientY, offsetX: offsets.offsetX, offsetY: offsets.offsetY };
    event.currentTarget.setPointerCapture(event.pointerId);
  }

  function onPointerMove(event: React.PointerEvent<HTMLDivElement>) {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== event.pointerId || dims.w === 0) return;
    const span = event.currentTarget.clientWidth || 1;
    const delta = 2 / (span * zoom); // viewport px → offset units at this zoom
    setOffsets(clampCropOffsets({
      imgW: dims.w, imgH: dims.h, zoom,
      offsetX: drag.offsetX - (event.clientX - drag.startX) * delta,
      offsetY: drag.offsetY - (event.clientY - drag.startY) * delta,
    }));
  }

  function endDrag(event: React.PointerEvent<HTMLDivElement>) {
    if (dragRef.current?.pointerId === event.pointerId) dragRef.current = null;
  }

  function onKeyDown(event: React.KeyboardEvent<HTMLDivElement>) {
    if (phase === "busy") return;
    const step = 0.05;
    let dx = 0, dy = 0;
    if (event.key === "ArrowLeft") dx = -step;
    else if (event.key === "ArrowRight") dx = step;
    else if (event.key === "ArrowUp") dy = -step;
    else if (event.key === "ArrowDown") dy = step;
    else return;
    event.preventDefault();
    setOffsets(current => clampCropOffsets({
      imgW: dims.w, imgH: dims.h, zoom, offsetX: current.offsetX + dx, offsetY: current.offsetY + dy,
    }));
  }

  if (!authed || !enabled) return null;

  const rect = computeCrop({ imgW: dims.w, imgH: dims.h, zoom, offsetX: offsets.offsetX, offsetY: offsets.offsetY });

  return (
    <section className={styles.photoSection} aria-label="Use a photo">
      <input
        ref={fileInputRef} type="file" className={styles.hiddenInput}
        accept="image/jpeg,image/png,image/webp" aria-label="Photo file"
        onChange={event => void onFile(event.target.files?.[0])}
      />
      <input
        ref={cameraInputRef} type="file" className={styles.hiddenInput}
        accept="image/jpeg,image/png,image/webp" capture="user" aria-label="Camera photo"
        onChange={event => void onFile(event.target.files?.[0])}
      />
      {!open ? (
        <button type="button" className={styles.openButton} onClick={() => setOpen(true)}>Use a photo</button>
      ) : (
        <div className={styles.panel}>
          {phase === "pick" && <>
            <p className={styles.consent}>
              Your photo is shrunk and sent once to an AI service to pick matching character options — Giggle
              doesn’t store it. You can keep editing by hand.
            </p>
            <div className={styles.row}>
              <button type="button" className={styles.primaryButton} onClick={() => fileInputRef.current?.click()}>Choose a photo</button>
              <button type="button" className={styles.secondaryButton} onClick={() => cameraInputRef.current?.click()}>Take a photo</button>
              <button type="button" className={styles.secondaryButton} onClick={closePanel}>Cancel</button>
            </div>
            {pickError && <p role="alert" className={styles.error}>{pickError}</p>}
          </>}
          {(phase === "preview" || phase === "busy") && <>
            <p className={styles.hint}>Frame it so your face and all your hair fit — drag the photo (or use arrow keys) and zoom to tighten.</p>
            <div
              className={styles.previewStage}
              role="group"
              aria-label="Photo preview — drag or use arrow keys to reposition"
              tabIndex={0}
              onPointerDown={onPointerDown}
              onPointerMove={onPointerMove}
              onPointerUp={endDrag}
              onPointerCancel={endDrag}
              onKeyDown={onKeyDown}
            >
              <img
                src={photoUrl} alt="" draggable={false} className={styles.previewImg}
                style={{ width: `${(dims.w / rect.sw) * 100}%`, left: `${(-rect.sx / rect.sw) * 100}%`, top: `${(-rect.sy / rect.sh) * 100}%` }}
              />
            </div>
            <label className={styles.zoomRow}>
              <span>Zoom</span>
              <input
                type="range" min={PHOTO_ZOOM_MIN} max={PHOTO_ZOOM_MAX} step={0.01} value={zoom}
                aria-label="Photo zoom" disabled={phase === "busy"} onChange={event => changeZoom(Number(event.target.value))}
              />
            </label>
            <div className={styles.row}>
              <button type="button" className={styles.primaryButton} disabled={phase === "busy"} onClick={() => void match()}>
                {phase === "busy" ? "Matching…" : "Match my photo"}
              </button>
              <button type="button" className={styles.secondaryButton} disabled={phase === "busy"} onClick={resetToPick}>Choose another</button>
              <button type="button" className={styles.secondaryButton} onClick={closePanel}>Cancel</button>
            </div>
            <div aria-live="polite">
              {phase === "busy" && <p className={styles.statusLine}><span className={styles.dots} aria-hidden="true" />Matching your photo…</p>}
            </div>
          </>}
          {phase === "result" && outcome && (
            <div aria-live="polite">
              {outcome.kind === "match" && <>
                <p className={styles.resultLine}>Here are the closest matches from your photo.</p>
                <div className={styles.options}>
                  {outcome.configs.slice(0, 3).map((config, index) => (
                    <div key={index} className={styles.option}>
                      <GiggleAvatar {...config} animated={false} size={84} label="" />
                      <span className={styles.optionLabel}>{optionLabels[index] ?? `Option ${index + 1}`}</span>
                      <button type="button" className={styles.secondaryButton} onClick={() => apply(config)}>Apply</button>
                    </div>
                  ))}
                </div>
                <p className={styles.saveHint}>Applying only changes the editor here — press Save to keep it.</p>
              </>}
              {outcome.kind === "none" && <p className={styles.resultLine}>{noMatchLines[outcome.status]}</p>}
              {outcome.kind === "error" && <p className={styles.resultLine}>{errorLine(outcome.code)}</p>}
              <div className={styles.row}>
                {(outcome.kind === "none" || (outcome.kind === "error" && chooseAnotherCodes.has(outcome.code))) && (
                  <button type="button" className={styles.secondaryButton} onClick={resetToPick}>Choose another</button>
                )}
                <button type="button" className={styles.secondaryButton} onClick={closePanel}>Edit manually</button>
              </div>
            </div>
          )}
        </div>
      )}
    </section>
  );
}
