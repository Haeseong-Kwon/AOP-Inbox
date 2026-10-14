/** Pixel-art helpers: sprites are drawn as character maps and rendered as crisp SVG rects. */

export const PALETTE: Record<string, string> = {
  K: "var(--px-deep)",
  D: "var(--px-dark)",
  S: "var(--px-shell)",
  L: "var(--px-light)",
  H: "var(--px-head)",
  h: "var(--px-head-shade)",
  E: "var(--px-eye)",
  M: "var(--px-eye)",
  G: "var(--px-glow)",
};

/** One <rect> per horizontal run of the same colour; `.` is transparent. */
export function Pixels({ map, x = 0, y = 0 }: { map: readonly string[]; x?: number; y?: number }) {
  const rects: { x: number; y: number; w: number; fill: string }[] = [];
  map.forEach((row, r) => {
    let c = 0;
    while (c < row.length) {
      const ch = row[c];
      let end = c + 1;
      while (end < row.length && row[end] === ch) end++;
      if (ch !== "." && PALETTE[ch]) rects.push({ x: x + c, y: y + r, w: end - c, fill: PALETTE[ch] });
      c = end;
    }
  });
  return (
    <>
      {rects.map((p) => (
        <rect key={`${p.x}-${p.y}`} x={p.x} y={p.y} width={p.w} height={1} fill={p.fill} />
      ))}
    </>
  );
}
