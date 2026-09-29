import { BookmarkPlus } from "lucide-react";
import { useEffect, useState } from "react";
import { getEngine } from "../engine/client";
import type { OutlineNode } from "../engine/types";
import { useT } from "../i18n/useT";
import { appStore, type DocTab } from "../state/store";
import { addBookmarkHere, deleteBookmark, renameBookmark } from "./bookmark-actions";
import { OutlineTree, type OutlineEditing } from "./LeftPanel";

/** The document's bookmarks: go to one, add one for the current page, rename (double-click) or delete. */
export function BookmarksPanel({ tab }: { tab: DocTab }) {
  const t = useT();
  const [nodes, setNodes] = useState<OutlineNode[]>(tab.info!.outline);
  const [editing, setEditing] = useState<string | null>(null);

  // Read the live outline so added, renamed, deleted and undone bookmarks show up.
  useEffect(() => {
    let cancelled = false;
    void getEngine()
      .outline(tab.id)
      .then((list: OutlineNode[]) => !cancelled && setNodes(list));
    return () => {
      cancelled = true;
    };
  }, [tab.id, tab.revision]);

  const edit: OutlineEditing | undefined = tab.info!.editable
    ? {
        editing,
        onEdit: setEditing,
        onRename: (path, title) => void renameBookmark(tab.id, path, title),
        onDelete: (path) => void deleteBookmark(tab.id, path),
      }
    : undefined;

  return (
    <div className="panel bookmarks">
      {edit && (
        <button
          className="panel-action"
          onClick={() =>
            void addBookmarkHere(tab.id).then((path) => {
              if (path) setEditing(path.join("."));
            })
          }
        >
          <BookmarkPlus size={16} /> {t("addBookmark")}
        </button>
      )}
      {nodes.length === 0 ? (
        <p className="muted panel-empty">{t("noBookmarks")}</p>
      ) : (
        <OutlineTree nodes={nodes} onSelect={(page) => appStore.getState().goToPage(tab.id, page)} edit={edit} />
      )}
    </div>
  );
}
