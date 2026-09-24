/**
 * Pure image-prep helpers for the "Use a photo" character-matching flow.
 * No React, no network, no storage — keep them unit-testable.
 */

export const PHOTO_MAX_BYTES = 10 * 1024 * 1024;
export const PHOTO_ACCEPTED_TYPES = ["image/jpeg", "image/png", "image/webp"] as const;
export const PHOTO_ZOOM_MIN = 1;
export const PHOTO_ZOOM_MAX = 2.5;

export type PhotoValidation = { ok: true } | { ok: false; reason: "type" | "size" };

/** Browser-side gate before anything is decoded: type + ≤ 10 MB. */
export function validatePhotoFile(file: File): PhotoValidation {
  if (!(PHOTO_ACCEPTED_TYPES as readonly string[]).includes(file.type)) return { ok: false, reason: "type" };
  if (file.size > PHOTO_MAX_BYTES) return { ok: false, reason: "size" };
  return { ok: true };
}

/** Integer source rectangle, always a square fully inside the image. */
export interface CropRect {
  sx: number;
  sy: number;
  sw: number;
  sh: number;
}

export interface CropInput {
  imgW: number;
  imgH: number;
  /** 1 = widest view (largest centered square) … 2.5 = tightest. Clamped. */
  zoom: number;
  /** Crop-center shifts as fractions of half the base square. Clamped. */
  offsetX: number;
  offsetY: number;
}

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

/**
 * Source rect for the square preview. At zoom 1 it is the largest centered
 * square that fits the image; higher zoom tightens it around the center, and
 * offsets shift that center (drag/arrow keys). The rect is clamped inside the
 * image so it can always be drawn directly.
 */
export function computeCrop({ imgW, imgH, zoom, offsetX, offsetY }: CropInput): CropRect {
  const w = Math.max(1, Math.round(imgW));
  const h = Math.max(1, Math.round(imgH));
  const base = Math.min(w, h);
  const side = Math.max(1, Math.round(base / clamp(zoom, PHOTO_ZOOM_MIN, PHOTO_ZOOM_MAX)));
  const cx = w / 2 + offsetX * (base / 2);
  const cy = h / 2 + offsetY * (base / 2);
  return {
    sx: clamp(Math.round(cx - side / 2), 0, w - side),
    sy: clamp(Math.round(cy - side / 2), 0, h - side),
    sw: side,
    sh: side,
  };
}

/**
 * Clamp drag offsets to the range where the crop square still touches image
 * edges (mirrors computeCrop's clamping, so dragging never feels "loose").
 */
export function clampCropOffsets({ imgW, imgH, zoom, offsetX, offsetY }: CropInput): { offsetX: number; offsetY: number } {
  const w = Math.max(1, Math.round(imgW));
  const h = Math.max(1, Math.round(imgH));
  const base = Math.min(w, h);
  const side = base / clamp(zoom, PHOTO_ZOOM_MIN, PHOTO_ZOOM_MAX);
  const maxX = (w - side) / base;
  const maxY = (h - side) / base;
  return { offsetX: clamp(offsetX, -maxX, maxX), offsetY: clamp(offsetY, -maxY, maxY) };
}

/**
 * Draw the crop onto a square `size`×`size` canvas and export a JPEG data URL.
 * Canvas re-encoding drops EXIF (orientation, GPS, camera ids) from the source.
 */
export function cropToJpegDataUrl(bitmap: CanvasImageSource, rect: CropRect, size = 512, quality = 0.85): string {
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Canvas is unavailable");
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(bitmap, rect.sx, rect.sy, rect.sw, rect.sh, 0, 0, size, size);
  return canvas.toDataURL("image/jpeg", quality);
}
