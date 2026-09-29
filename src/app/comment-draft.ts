/** The comment card's unsaved text, so save/close/quit can store it first (the card may never see a blur). */
export interface CommentDraft {
  pending(): boolean;
  flush(): Promise<unknown>;
}

let current: CommentDraft | null = null;

/** Returns the unregister function. */
export function registerCommentDraft(draft: CommentDraft): () => void {
  current = draft;
  return () => {
    if (current === draft) current = null;
  };
}

export const hasPendingComment = () => current?.pending() ?? false;

export async function flushComment(): Promise<void> {
  if (current?.pending()) await current.flush();
}
