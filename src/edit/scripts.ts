export type Script = "latin" | "sinhala" | "tamil";

export interface ScriptRun {
  script: Script;
  text: string;
  /** UTF-16 offset of the run in the source text. */
  start: number;
}

const SINHALA = /[඀-෿\u{111E0}-\u{111FF}]/u;
const TAMIL = /[஀-௿\u{11FC0}-\u{11FFF}]/u;
/** Characters that always stay in the current run so shaping keeps working: spaces, joiners, combining marks. */
const STICKY = /[\s‌‍\p{M}]/u;

export function scriptOf(ch: string): Script | null {
  if (SINHALA.test(ch)) return "sinhala";
  if (TAMIL.test(ch)) return "tamil";
  if (/[\p{L}\p{N}]/u.test(ch)) return "latin";
  return null;
}

/**
 * Splits text into runs that each use one script's font. Neutral characters (spaces, joiners,
 * punctuation) stay in the current run if its font has them, otherwise they go to a Latin run.
 */
export function splitScripts(text: string, hasGlyph: (script: Script, ch: string) => boolean = () => true): ScriptRun[] {
  const runs: ScriptRun[] = [];
  let leading = "";
  let offset = 0;
  const push = (script: Script, chunk: string, at: number) => {
    const last = runs[runs.length - 1];
    if (last && last.script === script) last.text += chunk;
    else runs.push({ script, text: chunk, start: at });
  };
  for (const ch of text) {
    const script = scriptOf(ch);
    const last = runs[runs.length - 1];
    if (script === null) {
      if (!last) leading += ch;
      else if (STICKY.test(ch) || hasGlyph(last.script, ch)) last.text += ch;
      else push("latin", ch, offset);
    } else {
      if (leading) {
        const fits = Array.from(leading).every((c) => STICKY.test(c) || hasGlyph(script, c));
        push(fits ? script : "latin", leading, 0);
        leading = "";
      }
      push(script, ch, offset);
    }
    offset += ch.length;
  }
  if (leading) push("latin", leading, 0);
  return runs;
}
