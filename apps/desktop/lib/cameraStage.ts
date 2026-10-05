// Boxes only: the call owner moves its ORIGINAL video hosts into these slots.
export function arrangeCameraStage(ids: string[], width: number, height: number, featured?: string | null) {
  const people = [...new Set(ids)];
  if (!people.length || !Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) return [];
  const grid = (list: string[], w: number, h: number, x = 0, y = 0) => {
    if (!list.length) return [];
    const cols = Math.min(list.length, Math.max(1, Math.round(Math.sqrt(list.length * w / h))));
    const rows = Math.ceil(list.length / cols);
    const gap = Math.min(8, w / (cols * 4), h / (rows * 4));
    const cw = (w - gap * (cols - 1)) / cols, ch = (h - gap * (rows - 1)) / rows;
    return list.map((id, i) => ({ id, x: x + (i % cols) * (cw + gap), y: y + Math.floor(i / cols) * (ch + gap), width: cw, height: ch }));
  };
  if (!featured || !people.includes(featured) || people.length === 1) return grid(people, width, height);
  const audience = people.filter(id => id !== featured);
  const gap = Math.min(8, width / 20, height / 20);
  if (width < 600) {
    const hero = (height - gap) * .7;
    return [{ id: featured, x: 0, y: 0, width, height: hero }, ...grid(audience, width, height - hero - gap, 0, hero + gap)];
  }
  const hero = (width - gap) * .72;
  return [{ id: featured, x: 0, y: 0, width: hero, height }, ...grid(audience, width - hero - gap, height, hero + gap)];
}
