import { expect, test } from "vitest";
import { convertLegacy, isLegacyFont, legacyScript, unicodeItems } from "./legacy";

// From pandukabhaya's own test cases (the source of the FM table).
const UPSTREAM: [string, string][] = [
  ["o<od ud,s.dj msysgd we;s uykqjr k.rhu hqfkiafldaj úiska f,dal Wreuhla f,i kï lr we;'", "දළදා මාලිගාව පිහිටා ඇති මහනුවර නගරයම යුනෙස්කෝව විසින් ලෝක උරුමයක් ලෙස නම් කර ඇත."],
  ["o;a; iïfma%IKh\" ixLHdxl iïfma%IKh\" fyda ixLHdxl ikaksfõokh hkq ,laIHfhka-,laIHhg fyda ,laIHfhka-nyq ,laIHhkag ikaksfõokh isÿlrk kd,sldjla Tiafia fN!;sl jYfhka o;a; ^ixLHdxl o;a; m%jdyhla& udrejls'", "දත්ත සම්ප්‍රේෂණය, සංඛ්‍යාංක සම්ප්‍රේෂණය, හෝ සංඛ්‍යාංක සන්නිවේදනය යනු ලක්ෂ්‍යයෙන්-ලක්ෂ්‍යයට හෝ ලක්ෂ්‍යයෙන්-බහු ලක්ෂ්‍යයන්ට සන්නිවේදනය සිදුකරන නාලිකාවක් ඔස්සේ භෞතික වශයෙන් දත්ත (සංඛ්‍යාංක දත්ත ප්‍රවාහයක්) මාරුවකි."],
  ["m%ñ;slrK mÍlaIK ;lafiare lsÍu i|yd Ndú;d lrk ixLHdk l%ufõo oelafjk m%u; iSkq yeve;s jl%hl m%ia;drh fuys oelafõ", "ප්‍රමිතිකරණ පරීක්ෂණ තක්සේරු කිරීම සඳහා භාවිතා කරන සංඛ්‍යාන ක්‍රමවේද දැක්වෙන ප්‍රමත සීනු හැඩැති වක්‍රයක ප්‍රස්තාරය මෙහි දැක්වේ"],
  [";x lsiai fy;=@ wmß[a[d;x ;iaid’;s jodñ", "තං කිස්ස හෙතු? අපරිඤ්ඤාතං තස්සා’ති වදාමි"]
];

test.each(UPSTREAM)("FM: %s", (fmText, unicode) => {
  expect(convertLegacy(fmText, "sinhala")).toBe(unicode);
});

// Lines from the owner's sample PDFs (fonts noted), converted as a reader confirmed.
test.each([
  ["wo Èkfha Tn Tfí orejkaf.a fmdaIK wjYH;d", "අද දිනයේ ඔබ ඔබේ දරුවන්ගේ පෝෂණ අවශ්‍යතා"], // FM Ganganee
  ["ffjoH ,lañKs udf.dvr;ak", "වෛද්‍ය ලක්මිණි මාගොඩරත්න"], // A-KELANI
  ["Y%S ,dxlslhka i|yd wdydr ud¾f.damfoaY", "ශ්‍රී ලාංකිකයන් සඳහා ආහාර මාර්ගෝපදේශ"], // FM Ganganee
])("Sinhala sample: %s", (legacy, unicode) => {
  expect(convertLegacy(legacy, "sinhala")).toBe(unicode);
});

test.each([
  [",d;iwa Nghrhf;Nf - ehisa kfpo;r;rp", "இன்றைய போசாக்கே - நாளைய மகிழ்ச்சி"], // RAVIB
  ["r%f itj;jpa epGzu;", "சமூக வைத்திய நிபுணர்"], // Tharmini
  ["czTg; gphpTfs;", "உணவுப் பிரிவுகள்"], // Kalaham (ர drawn as "h")
])("Tamil sample: %s", (legacy, unicode) => {
  expect(convertLegacy(legacy, "tamil")).toBe(unicode);
});

test("font families", () => {
  expect(legacyScript("ZJQJBK+FMAbhayax")).toBe("sinhala");
  expect(legacyScript("BCDEEE+DL-Sumudu.")).toBe("sinhala");
  expect(legacyScript("UHCMKZ+Bamini-Regular")).toBe("tamil");
  expect(legacyScript("AbhayaLibre-Regular")).toBeNull(); // a Unicode font
  expect(legacyScript("IskoolaPota")).toBeNull();
  expect(isLegacyFont("Vanavil-Avvaiyar")).toBe(true); // legacy, but no table yet
  expect(legacyScript("Vanavil-Avvaiyar")).toBeNull();
});

test("only legacy runs are converted; each token keeps its place", () => {
  const q = (x: number) => [x, 0, x + 1, 0, x, 1, x + 1, 1] as [number, number, number, number, number, number, number, number];
  const chars = [..."Tfí"].map((c, i) => ({ c, font: "FMAbhaya", quad: q(i) })).concat([..." ok"].map((c, i) => ({ c, font: "Arial", quad: q(10 + i) })));
  const items = unicodeItems(chars);
  expect(items.map((i) => i.c).join("")).toBe("ඔබේ ok");
  expect(items[1]).toEqual({ c: "බේ", quad: [1, 0, 3, 0, 1, 1, 3, 1] }); // kombuva "f" + "í" → one token over both glyphs
});
