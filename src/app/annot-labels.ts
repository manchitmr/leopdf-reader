import { ArrowUpRight, Circle, Highlighter, MessageSquare, Minus, Pencil, Signature, Square, Strikethrough, StickyNote, Underline, type LucideIcon } from "lucide-react";
import type { AnnotKind } from "../edit/types";
import type { StringKey } from "../i18n/strings";

export const KIND_LABEL: Record<AnnotKind, StringKey> = {
  highlight: "markupHighlight", underline: "markupUnderline", strikeout: "markupStrikeout", ink: "annotInk", line: "drawLine", arrow: "drawArrow",
  rect: "drawRect", oval: "drawOval", note: "annotNote", stamp: "annotStamp", other: "annotOther",
};

export const KIND_ICON: Record<AnnotKind, LucideIcon> = {
  highlight: Highlighter, underline: Underline, strikeout: Strikethrough, ink: Pencil, line: Minus, arrow: ArrowUpRight,
  rect: Square, oval: Circle, note: StickyNote, stamp: Signature, other: MessageSquare,
};

export const MARKUP_KINDS = new Set<AnnotKind>(["highlight", "underline", "strikeout"]);
export const DRAW_KINDS = new Set<AnnotKind>(["ink", "line", "arrow", "rect", "oval"]);
