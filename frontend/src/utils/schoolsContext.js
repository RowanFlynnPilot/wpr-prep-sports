import { createContext, useContext } from "react";

/**
 * The loaded sport's school roster, shared with chrome that renders
 * outside the page tree (the masthead's school finder). SportShell
 * provides `{ schools, schoolIndex, sportId }` once a dataset is in;
 * chrome rendered outside a sport route (media kit, error screen) reads
 * null and simply omits the finder.
 */
export const SchoolsContext = createContext(null);

export function useSchoolsContext() {
  return useContext(SchoolsContext);
}
