import type { RGB } from "../edit/types";
import { useT } from "../i18n/useT";
import { sameColor, toHex } from "../state/palette";

export function Swatches({ colors, value, onPick }: { colors: RGB[]; value: RGB | null; onPick(color: RGB): void }) {
  const t = useT();
  return (
    <div className="swatches" role="group" aria-label={t("color")}>
      {colors.map((c) => {
        const on = value !== null && sameColor(c, value);
        return (
          <button key={toHex(c)} className={`swatch ${on ? "pressed" : ""}`} style={{ background: toHex(c) }} aria-label={toHex(c)} aria-pressed={on} title={toHex(c)} onClick={() => onPick(c)} />
        );
      })}
    </div>
  );
}
