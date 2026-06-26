/**
 * Frontend logo overrides keyed by school id. Takes priority over the
 * WIAA-sourced team.logo_url in TeamLogo — used for tracked entities that
 * WIAA serves no (or a wrong) logo for. The Central Wisconsin Storm is a
 * co-op registered under D.C. Everest's WIAA org, so without an override
 * its games carry DCE's evergreen mark; this gives it its own crest.
 *
 * Assets live in frontend/public/logos/ and ship as static files.
 */
const BASE = import.meta.env.BASE_URL;

export const LOGO_OVERRIDES = {
  "central-wisconsin-storm": `${BASE}logos/central-wisconsin-storm.svg`,
};

/** Local override URL for a school id, or null when there isn't one. */
export function logoOverrideFor(schoolId) {
  return schoolId ? LOGO_OVERRIDES[schoolId] ?? null : null;
}
