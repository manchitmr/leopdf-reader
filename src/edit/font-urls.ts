import latinSansBold from "@expo-google-fonts/noto-sans/700Bold/NotoSans_700Bold.ttf?url";
import latinSansRegular from "@expo-google-fonts/noto-sans/400Regular/NotoSans_400Regular.ttf?url";
import latinSerifBold from "@expo-google-fonts/noto-serif/700Bold/NotoSerif_700Bold.ttf?url";
import latinSerifRegular from "@expo-google-fonts/noto-serif/400Regular/NotoSerif_400Regular.ttf?url";
import sinhalaSansBold from "@expo-google-fonts/noto-sans-sinhala/700Bold/NotoSansSinhala_700Bold.ttf?url";
import sinhalaSansRegular from "@expo-google-fonts/noto-sans-sinhala/400Regular/NotoSansSinhala_400Regular.ttf?url";
import sinhalaSerifBold from "@expo-google-fonts/noto-serif-sinhala/700Bold/NotoSerifSinhala_700Bold.ttf?url";
import sinhalaSerifRegular from "@expo-google-fonts/noto-serif-sinhala/400Regular/NotoSerifSinhala_400Regular.ttf?url";
import tamilSansBold from "@expo-google-fonts/noto-sans-tamil/700Bold/NotoSansTamil_700Bold.ttf?url";
import tamilSansRegular from "@expo-google-fonts/noto-sans-tamil/400Regular/NotoSansTamil_400Regular.ttf?url";
import tamilSerifBold from "@expo-google-fonts/noto-serif-tamil/700Bold/NotoSerifTamil_700Bold.ttf?url";
import tamilSerifRegular from "@expo-google-fonts/noto-serif-tamil/400Regular/NotoSerifTamil_400Regular.ttf?url";
import type { FontSource } from "./font-registry";
import type { FontKey } from "./fonts";

const URLS: Record<FontKey, string> = {
  "latin-sans-regular": latinSansRegular,
  "latin-sans-bold": latinSansBold,
  "latin-serif-regular": latinSerifRegular,
  "latin-serif-bold": latinSerifBold,
  "sinhala-sans-regular": sinhalaSansRegular,
  "sinhala-sans-bold": sinhalaSansBold,
  "sinhala-serif-regular": sinhalaSerifRegular,
  "sinhala-serif-bold": sinhalaSerifBold,
  "tamil-sans-regular": tamilSansRegular,
  "tamil-sans-bold": tamilSansBold,
  "tamil-serif-regular": tamilSerifRegular,
  "tamil-serif-bold": tamilSerifBold,
};

export const fetchFontSource: FontSource = async (key) => {
  const response = await fetch(URLS[key]);
  if (!response.ok) throw new Error(`Font ${key} failed to load (${response.status})`);
  return new Uint8Array(await response.arrayBuffer());
};
