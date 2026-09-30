import { RotateCcw, RotateCw } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import type { Point } from "../engine/types";
import type { StringKey } from "../i18n/strings";
import { useT } from "../i18n/useT";
import { isImageName, pickImage, readDroppedImage, toPngOrJpeg } from "../platform/files";
import { onNativeDrop } from "../platform/native";
import { appStore, useApp } from "../state/store";
import { PAD_HEIGHT, PAD_WIDTH, drawImage, drawStrokes, drawTyped, exportSignature, prepareCanvas } from "./render-signature";

type Mode = "draw" | "type" | "image";
const MODES: { mode: Mode; label: StringKey }[] = [
  { mode: "draw", label: "signDraw" },
  { mode: "type", label: "signType" },
  { mode: "image", label: "signImage" },
];
const INKS = { black: "#111111", blue: "#1d3a8a" };
const INK_RGB: Record<keyof typeof INKS, [number, number, number]> = { black: [17, 17, 17], blue: [29, 58, 138] };

export function SignatureDialog() {
  const dialog = useApp((s) => s.dialog);
  return dialog?.kind === "signature" ? <SignaturePad /> : null;
}

function SignaturePad() {
  const t = useT();
  const [mode, setMode] = useState<Mode>("draw");
  const [ink, setInk] = useState<keyof typeof INKS>("black");
  const [strokes, setStrokes] = useState<Point[][]>([]);
  const [name, setName] = useState("");
  const [family, setFamily] = useState<"sans" | "serif">("serif");
  const [image, setImage] = useState<Uint8Array | null>(null);
  const [whiten, setWhiten] = useState(true);
  /** Photos: ink recolour ("original" keeps the photo's colours) and rotation in degrees (−180…180). */
  const [photoInk, setPhotoInk] = useState<keyof typeof INKS | "original">("original");
  const [angle, setAngle] = useState(0);
  /** Adds degrees, wrapping into −180…180. */
  const turn = (by: number) => setAngle((a) => ((((a + by + 180) % 360) + 360) % 360) - 180);
  const canvas = useRef<HTMLCanvasElement>(null);

  const takeImage = (bytes: Uint8Array) => {
    setMode("image");
    setImage(bytes);
    setAngle(0);
  };
  const unreadable = () => appStore.getState().showNotice("imageUnreadable");
  // Dropping an image file anywhere on the app while this dialog is open uses it as the signature.
  // (In the app, the OS hands over file paths; in a browser the drop event carries the file.)
  useEffect(() => {
    let unlisten = () => {};
    let gone = false;
    void onNativeDrop((paths) => {
      const path = paths.find(isImageName);
      if (path) void readDroppedImage(path).then(takeImage, unreadable);
    }).then((u) => (gone ? u() : (unlisten = u)));
    return () => {
      gone = true;
      unlisten();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const onDrop = (e: React.DragEvent) => {
    e.preventDefault();
    const file = Array.from(e.dataTransfer.files).find((f) => isImageName(f.name));
    if (file) void file.arrayBuffer().then((b) => toPngOrJpeg(new Uint8Array(b))).then(takeImage, unreadable);
  };
  const drawing = useRef(false);

  useEffect(() => {
    const ctx = canvas.current && prepareCanvas(canvas.current, mode === "image" ? 4 : 2);
    if (!ctx) return;
    let cancelled = false;
    const isCancelled = () => cancelled;
    if (mode === "draw") drawStrokes(ctx, strokes, INKS[ink]);
    else if (mode === "type") void drawTyped(ctx, name, family, INKS[ink], isCancelled);
    else if (image)
      void drawImage(ctx, image, { clean: whiten, ink: photoInk === "original" ? null : INK_RGB[photoInk], rotation: angle }, isCancelled).catch(() => {
        if (cancelled) return;
        setImage(null);
        appStore.getState().showNotice("imageUnreadable");
      });
    return () => {
      cancelled = true;
    };
  }, [mode, strokes, name, family, image, whiten, ink, photoInk, angle]);

  const padPoint = (e: React.PointerEvent<HTMLCanvasElement>): Point => {
    const box = e.currentTarget.getBoundingClientRect();
    return [((e.clientX - box.left) * PAD_WIDTH) / (box.width || PAD_WIDTH), ((e.clientY - box.top) * PAD_HEIGHT) / (box.height || PAD_HEIGHT)];
  };
  const ready = mode === "draw" ? strokes.length > 0 : mode === "type" ? name.trim().length > 0 : image !== null;
  const close = () => appStore.getState().setDialog(null);
  const save = () => {
    const sig = canvas.current && exportSignature(canvas.current);
    if (!sig) return;
    const s = appStore.getState();
    const dropped = s.addSignature(sig);
    s.setDialog(null);
    if (dropped) s.showNotice("signatureDropped");
  };

  return (
    <div className="modal-backdrop" role="dialog" aria-modal="true" aria-label={t("signatureTitle")}>
      <div className="doc-message signature-dialog" onDragOver={(e) => e.preventDefault()} onDrop={onDrop}>
        <h2>{t("signatureTitle")}</h2>
        <div className="segmented" role="tablist">
          {MODES.map((m) => (
            <button key={m.mode} role="tab" aria-selected={mode === m.mode} className={mode === m.mode ? "pressed" : ""} onClick={() => setMode(m.mode)}>
              {t(m.label)}
            </button>
          ))}
        </div>
        {mode === "type" && (
          <div className="signature-controls">
            <input aria-label={t("typeYourName")} placeholder={t("typeYourName")} value={name} onChange={(e) => setName(e.target.value)} />
            <select aria-label={t("fontFamily")} value={family} onChange={(e) => setFamily(e.target.value as "sans" | "serif")}>
              <option value="serif">Noto Serif</option>
              <option value="sans">Noto Sans</option>
            </select>
          </div>
        )}
        {mode === "image" && (
          <div className="signature-controls">
            <button
              onClick={() =>
                void pickImage()
                  .then((bytes) => bytes && takeImage(bytes))
                  .catch(unreadable)
              }
            >
              {t("chooseImage")}
            </button>
            <span className="muted">{t("dropImageHint")}</span>
            <label>
              <input type="checkbox" checked={whiten} onChange={(e) => setWhiten(e.target.checked)} /> {t("removeWhite")}
            </label>
          </div>
        )}
        {mode === "image" && image && (
          <div className="signature-controls">
            <button className="icon-button" aria-label={t("rotateLeft")} title={t("rotateLeft")} onClick={() => turn(-90)}>
              <RotateCcw size={16} />
            </button>
            <button className="icon-button" aria-label={t("rotateRight")} title={t("rotateRight")} onClick={() => turn(90)}>
              <RotateCw size={16} />
            </button>
            <label className="straighten">
              {t("straighten")}
              <input type="range" min={-180} max={180} step={1} value={angle} onChange={(e) => setAngle(Number(e.target.value))} onDoubleClick={() => setAngle(0)} />
              <output>{angle}°</output>
            </label>
            {whiten && (
              <div className="swatches" role="group" aria-label={t("inkColor")}>
                <button className={`swatch custom-color ${photoInk === "original" ? "pressed" : ""}`} aria-label={t("originalColors")} title={t("originalColors")} aria-pressed={photoInk === "original"} onClick={() => setPhotoInk("original")} />
                {(Object.keys(INKS) as (keyof typeof INKS)[]).map((k) => (
                  <button key={k} className={`swatch ${photoInk === k ? "pressed" : ""}`} style={{ background: INKS[k] }} aria-label={INKS[k]} aria-pressed={photoInk === k} onClick={() => setPhotoInk(k)} />
                ))}
              </div>
            )}
          </div>
        )}
        <canvas
          ref={canvas}
          className={`signature-pad mode-${mode}`}
          style={{ aspectRatio: `${PAD_WIDTH} / ${PAD_HEIGHT}` }}
          onPointerDown={(e) => {
            if (mode !== "draw") return;
            drawing.current = true;
            e.currentTarget.setPointerCapture?.(e.pointerId);
            const p = padPoint(e);
            setStrokes((s) => [...s, [p]]);
          }}
          onPointerMove={(e) => {
            if (!drawing.current) return;
            const p = padPoint(e);
            setStrokes((s) => [...s.slice(0, -1), [...s[s.length - 1], p]]);
          }}
          onPointerUp={() => (drawing.current = false)}
        />
        <div className="signature-controls">
          {mode !== "image" && (
            <div className="swatches" role="group" aria-label={t("inkColor")}>
              {(Object.keys(INKS) as (keyof typeof INKS)[]).map((k) => (
                <button key={k} className={`swatch ${ink === k ? "pressed" : ""}`} style={{ background: INKS[k] }} aria-label={INKS[k]} aria-pressed={ink === k} onClick={() => setInk(k)} />
              ))}
            </div>
          )}
          {mode === "draw" && <button onClick={() => setStrokes([])}>{t("clear")}</button>}
          <span className="muted">{t("signatureHint")}</span>
        </div>
        <div className="form-actions">
          <button onClick={close}>{t("cancel")}</button>
          <button className="primary-button" disabled={!ready} onClick={save}>
            {t("save")}
          </button>
        </div>
      </div>
    </div>
  );
}
