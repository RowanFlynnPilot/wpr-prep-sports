# School Spirit photo workflow

Reader-submitted photos are surfaced inside the widget in two places:

- **Dashboard strip** — a horizontally-scrolling rail above the Pickem
  section showing the most recent ~12 approved photos. Filters to the
  current sport when possible.
- **Per-game gallery** — a grid on the game-detail page showing photos
  that either pin to that specific game (via `game_id`) or were submitted
  for one of the participating schools within a week of game time.

Photos render from `data/spirit.json` (a flat list under `photos:[]`).
The widget treats that file as **read-only output** from the editorial
workflow described below — do not hand-edit production entries inside
the widget repo.

## Data shape

`data/spirit.json`

```jsonc
{
  "photos": [
    {
      "id": "unique-string",                  // any stable id; safe choice: <approved_at>-<school>-<seq>
      "school_id": "wausau-east",             // must match a school slug in data/schools.json
      "sport": "football",                    // sport id (football, boys_basketball, etc.)
      "game_id": null,                        // optional — pin to a specific game if relevant
      "image_url": "https://wausaupilotandreview.com/wp-content/uploads/.../full.jpg",
      "thumb_url": null,                      // optional — falls back to image_url
      "caption": "Friday night Lumberjack pride",
      "credit": "Submitted by Jane Doe",
      "approved_at": "2025-09-20T14:30:00Z",  // ISO 8601 UTC
      "tags": ["student-section"]             // optional, free-form
    }
  ]
}
```

Required fields the widget actually uses: `id`, `school_id`, `image_url`,
`approved_at`. Everything else is opportunistic — missing captions or
credits degrade gracefully.

## Submission + moderation flow (WordPress side)

The widget never accepts uploads directly. All photos enter via WPR's
WordPress install, where editors already have authenticated review
tools. Recommended setup:

1. **Submission form** — Gravity Forms (or WPForms) on a page like
   `/submit-prep-sports-photo/`. Fields:
   - Photo upload (single file, JPG/PNG/HEIC; convert HEIC server-side)
   - School (dropdown, populated from `data/schools.json`)
   - Sport (dropdown)
   - Optional: game date, your name (for credit), caption
   - Consent checkbox: "I have the right to share this photo."

2. **Notification + queue** — Gravity Forms email notification to the
   sports editor. Submissions land in the GF entries area for review.

3. **Approval** — Editor reviews → if approved, attaches the photo to
   the WP Media Library (so the image URL is publicly accessible) and
   marks the GF entry as "approved" (custom status or tag).

4. **Export to `data/spirit.json`** — three options, pick whichever fits
   WPR's bandwidth:

   - **Option A (lowest setup, highest friction): manual paste.**
     Editor copies the approved entry into `data/spirit.json` via the
     GitHub web editor and commits. Acceptable while volume is low.

   - **Option B (cleanest, requires WP work): custom REST endpoint.**
     A small WP plugin or `functions.php` snippet exposes
     `/wp-json/wpr/v1/spirit?status=approved` returning approved
     submissions in the schema above. The scraper picks this up on its
     cron and writes `data/spirit.json` automatically. Pros: no manual
     copy step. Cons: WPR engineering time.

   - **Option C (medium): Google Sheets bridge.** GF posts approved
     entries to a Sheet (Zapier integration or GF webhook). The scraper
     pulls the Sheet via the public CSV export URL on its cron. Pros:
     editor lives in the Sheet UI for approvals. Cons: another moving
     part.

5. **Deploy** — committing `data/spirit.json` triggers the existing
   `deploy.yml` workflow; photos appear in the widget within a couple
   minutes.

## Moderation reminders

Public photo submissions can be a vector for harassment, copyright
issues, or inappropriate content. Hard requirements:

- **Never auto-publish.** Every photo must be reviewed by a human
  before its entry lands in `data/spirit.json`.
- **Verify likeness consent** for any minors clearly identifiable in
  the photo (a Wisconsin athletic association best-practice).
- **Keep an audit trail.** The originating GF entry (with submitter
  email + IP) should be retained for at least a year so flagged
  content can be traced.
- **Hot-removal path.** To pull a photo immediately, delete its entry
  from `data/spirit.json` and commit — the deploy will roll out the
  same day. The image stays in the WP Media Library; consider deleting
  it there too if the issue is the content itself.

## Submit-photo link

The widget renders a "Submit your photo →" link in both spirit
surfaces, pointed at
`https://wausaupilotandreview.com/submit-prep-sports-photo/`. Update
this URL in [`SpiritGallery.jsx`](../frontend/src/components/SpiritGallery.jsx)
(the exported `SpiritSubmitLink` component) once WPR confirms the
final submission page URL.
