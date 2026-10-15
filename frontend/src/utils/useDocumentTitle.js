import { useEffect } from "react";
import { SITE } from "../config/site.js";

/**
 * Per-route document titles. The hash router leaves `document.title` on
 * whatever index.html shipped, so every tab, history entry and shared
 * link read the same (critique run 18). Pages pass the specific part;
 * the org name is appended once. `null` leaves the title alone (while a
 * page is still loading its subject).
 */
export default function useDocumentTitle(title) {
  useEffect(() => {
    if (!title) return undefined;
    const prev = document.title;
    document.title = `${title} · ${SITE.orgShort ?? SITE.orgName ?? ""}`.replace(/ · $/, "");
    return () => {
      document.title = prev;
    };
  }, [title]);
}
