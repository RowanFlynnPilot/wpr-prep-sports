import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import Layout from "../components/Layout.jsx";
import { SPORT_IDS, configFor } from "../config/sports.js";
import { trackEvent } from "../utils/analytics.js";
import { SITE } from "../config/site.js";
import "../styles/MediaKit.css";

const DATA_BASE = `${import.meta.env.BASE_URL.replace(/\/$/, "")}/data`;

// Where ad-ops wants inquiries to land. Override at build time.
const CONTACT_EMAIL = import.meta.env.VITE_SPONSOR_EMAIL || SITE.contactEmail;

// Inventory taxonomy — mirrors docs/advertiser-inventory.md, rendered as a
// living sales page so WPR can send one link instead of a PDF. `slots`
// names the sponsors.json keys that back each surface (when present) so
// each card can show real Available/Sold status. `preview` drives the
// little "here's where your brand goes" lockup.
const INVENTORY = [
  {
    group: "Top of funnel — every page",
    items: [
      {
        title: "Title sponsor",
        blurb: "Your name in the masthead on every view, every sport. The single highest-visibility placement — an annual deal.",
        fit: "Sports medicine · hospital system · credit union",
        slots: ["title"],
        rateKey: "title",
        preview: { label: "Presented by", tone: "title" },
      },
      {
        title: "Scoreboard",
        blurb: "Above recent scores — seen on every dashboard, peak impressions on game weekends.",
        fit: "Pizza · sports bar · wings",
        slots: ["ticker"],
        rateKey: "ticker",
        preview: { label: "Scoreboard presented by", tone: "ticker" },
      },
      {
        title: "Section tabs",
        blurb: "A placement under each of the four dashboard tabs — Scores, Schedule, Standings, Spotlight. Four discrete surfaces.",
        fit: "Any local business · rotate by category",
        slots: ["tab:scores", "tab:schedule", "tab:standings", "tab:spotlight"],
        rateKey: "tabs",
        preview: { label: "This view presented by", tone: "ticker" },
      },
    ],
  },
  {
    group: "Conference standings — sells per conference",
    items: [
      {
        title: "Standings presented by",
        blurb: "One sponsor per conference, shown across every sport that conference plays. Wisconsin Valley, Great Northern, Big Rivers, Marawood, Cloverbelt.",
        fit: "Bank · credit union · insurance",
        rateKey: "standings",
        slots: [
          "standings:Wisconsin Valley",
          "standings:Great Northern",
          "standings:Big Rivers",
        ],
        countLabel: "5 conferences",
        preview: { label: "Wisconsin Valley standings presented by", tone: "standings" },
      },
    ],
  },
  {
    group: "Feature-tied — brand association, not just a banner",
    items: [
      {
        title: "Game of the Week",
        blurb: "The marquee matchup above each sport's hero. \"GOTW presented by\" — the placement everyone sees first.",
        fit: "Auto dealer · supper club · pizza",
        rateKey: "marquee",
        slots: SPORT_IDS.map((s) => `marquee:${s}`),
        countLabel: "per sport",
        preview: { label: "Game of the Week", tone: "marquee" },
      },
      {
        title: "Game recap",
        blurb: "On every game detail page, beside the recap and box score.",
        fit: "Pharmacy · clinic · local services",
        rateKey: "game-detail",
        slots: ["game-detail"],
        preview: { label: "Game recap presented by", tone: "ticker" },
      },
      {
        title: "Player of the Week",
        blurb: "The weekly standout, pinned at the top of every sport. \"Being the orthodontist behind Player of the Week\" is equity a banner can't buy.",
        fit: "Orthodontist · sports medicine · photo studio",
        slots: [],
        status: "ready",
        rateKey: "potw",
        preview: { label: "Player of the Week presented by", tone: "feature" },
      },
      {
        title: "Power Rankings",
        blurb: "Original cross-conference rankings — the kind of content fans argue about and check weekly.",
        fit: "Auto dealer · athletic gear",
        slots: [],
        status: "ready",
        rateKey: "power-rankings",
        preview: { label: "Power Rankings presented by", tone: "feature" },
      },
      {
        title: "Pick'em",
        blurb: "Weekly winner predictions — a return-every-week engagement hook.",
        fit: "Bank · credit union · insurance",
        slots: [],
        status: "ready",
        rateKey: "pickem",
        preview: { label: "Pick'em presented by", tone: "feature" },
      },
      {
        title: "Head-to-Head history",
        blurb: "Multi-season series records on every game page — \"Edgar leads 3-1\" is the stuff rivalries are made of. Prime real estate for Rivalry Week.",
        fit: "Sports bar · auto dealer · community bank",
        rateKey: "rivalry",
        slots: ["rivalry"],
        preview: { label: "Head-to-head presented by", tone: "feature" },
      },
      {
        title: "Weekly Roundup",
        blurb: `The Saturday-morning digest of the week's games, auto-built for the ${SITE.orgShort} newsletter. Your name rides along into every subscriber inbox.`,
        fit: "Grocery · bank · regional brand",
        rateKey: "digest",
        slots: ["digest"],
        preview: { label: "Weekly Roundup presented by", tone: "feature" },
      },
      {
        title: "Senior Spotlight",
        blurb: "Editor-curated senior profiles — the games end, the memories get framed. The most parent-treasured surface in the widget.",
        fit: "Photo studio · formalwear · college consultant",
        rateKey: "spotlight:senior",
        slots: ["spotlight:senior"],
        preview: { label: "Senior Spotlight presented by", tone: "feature" },
      },
    ],
  },
  {
    group: "Per-school — the underrated multiplier",
    items: [
      {
        title: "Team coverage sponsor",
        blurb: "Each school's page becomes its own surface — sell to a business right down the road from that school. Hyper-targeted to that exact community of parents, grandparents, and alums.",
        fit: "Neighborhood businesses, one per school",
        rateKey: "school",
        slots: ["school:wausau-east"],
        countLabel: "every school",
        preview: { label: "Wausau East coverage brought to you by", tone: "card" },
      },
    ],
  },
];

const PACKAGES = [
  { title: "Football Season Title", note: "Aug–Nov · title sponsor for football" },
  { title: "Basketball Season Title", note: "Nov–Mar · boys & girls hoops" },
  { title: "Tournament Special", note: "State-run coverage + bracket" },
  { title: "Senior Night Special", note: "Late-season, senior families" },
];

const WHY = [
  ["ti-target", "Hyper-targeted", "Parents, grandparents, alums, and students of specific schools."],
  ["ti-refresh", "Highly engaged", "Repeat weekly visits in season — multiple per week at peak."],
  ["ti-shield-check", "Brand-safe", "High school sports = community pride, never politics."],
  ["ti-lock", "Local exclusivity", "Lock competitors out of your category."],
  ["ti-chart-line", "Measurable", "Reportable impressions and per-sponsor click-throughs."],
];

function isAvailable(slotData) {
  // Available when unsold: no name, or a clearly-placeholder "Sample …".
  const name = slotData?.name;
  return !name || /^sample\b/i.test(name);
}

export default function MediaKitPage() {
  const [sponsors, setSponsors] = useState(null);
  const [schools, setSchools] = useState(null);
  const [pricing, setPricing] = useState(null);
  const schoolCount = schools?.length ?? null;

  useEffect(() => {
    let cancelled = false;
    fetch(`${DATA_BASE}/sponsors.json`)
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => !cancelled && setSponsors(d))
      .catch(() => {});
    fetch(`${DATA_BASE}/schools.json`)
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => !cancelled && Array.isArray(d) && setSchools(d))
      .catch(() => {});
    // Optional rate card (data/pricing.json) — cards show prices only
    // when ad-ops fills them in.
    fetch(`${DATA_BASE}/pricing.json`)
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => !cancelled && setPricing(d))
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);

  const availability = useMemo(() => {
    const slots = sponsors?.slots ?? {};
    return (item) => {
      if (item.status === "ready") return { kind: "ready", text: "Ready to sell" };
      if (!item.slots?.length) return { kind: "ready", text: "Available" };
      const open = item.slots.filter((k) => isAvailable(slots[k])).length;
      if (open === 0) return { kind: "sold", text: "Sold out" };
      if (open === item.slots.length) return { kind: "open", text: "Available" };
      return { kind: "open", text: `${open} open` };
    };
  }, [sponsors]);

  const breadcrumb = (
    <>
      <Link to="/" className="breadcrumb__back">
        <span aria-hidden="true" className="breadcrumb__back-arrow">‹</span>
        Back to scores
      </Link>
      <span aria-hidden="true" className="breadcrumb__sep">·</span>
      <span className="breadcrumb__current">Advertise</span>
    </>
  );

  return (
    <Layout breadcrumb={breadcrumb} sponsors={sponsors}>
      <section className="mk-hero">
        <span className="mk-hero__eyebrow">Sponsorship</span>
        <h1 className="mk-hero__title">
          Put your brand where {SITE.regionLabel} checks the score.
        </h1>
        <p className="mk-hero__sub">
          The only comprehensive hub for {SITE.regionShort} high school sports — schedules,
          scores, standings, and stats across {SPORT_IDS.length} sports
          {schoolCount ? ` and ${schoolCount} schools` : ""}. Loyal, local, and
          back every week of the season.
        </p>
        <div className="mk-hero__cta">
          <a
            className="mk-btn"
            href={`mailto:${CONTACT_EMAIL}?subject=Prep Sports sponsorship`}
            onClick={() => trackEvent("mediakit-contact", { placement: "hero" })}
          >
            Become a sponsor
          </a>
          <span className="mk-hero__contact">{CONTACT_EMAIL}</span>
        </div>
      </section>

      <ul className="mk-why">
        {WHY.map(([icon, h, d]) => (
          <li key={h} className="mk-why__item">
            <i className={`ti ${icon}`} aria-hidden="true" />
            <div>
              <span className="mk-why__h">{h}</span>
              <span className="mk-why__d">{d}</span>
            </div>
          </li>
        ))}
      </ul>

      {INVENTORY.map((section) => (
        <section key={section.group} className="mk-group">
          <h2 className="mk-group__title">{section.group}</h2>
          <div className="mk-grid">
            {section.items.map((item) => {
              const a = availability(item);
              return (
                <article key={item.title} className="mk-card">
                  <header className="mk-card__head">
                    <h3 className="mk-card__title">{item.title}</h3>
                    <span className={`mk-pill mk-pill--${a.kind}`}>{a.text}</span>
                  </header>
                  <SurfacePreview preview={item.preview} />
                  <p className="mk-card__blurb">{item.blurb}</p>
                  <div className="mk-card__foot">
                    <span className="mk-card__fit">{item.fit}</span>
                    {pricing?.rates?.[item.rateKey] && (
                      <span className="mk-card__rate">{pricing.rates[item.rateKey]}</span>
                    )}
                    {item.countLabel && (
                      <span className="mk-card__count">{item.countLabel}</span>
                    )}
                  </div>
                </article>
              );
            })}
          </div>
        </section>
      ))}

      <section className="mk-group">
        <h2 className="mk-group__title">Season &amp; tournament packages</h2>
        <div className="mk-packages">
          {PACKAGES.map((p) => (
            <div key={p.title} className="mk-package">
              <span className="mk-package__title">{p.title}</span>
              <span className="mk-package__note">{p.note}</span>
              {pricing?.packages?.[p.title] && (
                <span className="mk-package__rate">{pricing.packages[p.title]}</span>
              )}
            </div>
          ))}
        </div>
      </section>

      {schools && <EmbedBuilder schools={schools} />}

      <section className="mk-foot-cta">
        <h2 className="mk-foot-cta__title">Lock your category before a competitor does.</h2>
        <a
          className="mk-btn mk-btn--lg"
          href={`mailto:${CONTACT_EMAIL}?subject=Prep Sports sponsorship`}
          onClick={() => trackEvent("mediakit-contact", { placement: "footer" })}
        >
          Talk to {SITE.orgShort} advertising
        </a>
      </section>
    </Layout>
  );
}

// Per-school embed snippet builder — ad-ops (or the newsroom) picks a
// school + sport and copies ready-to-paste iframe code for an article
// or sidebar. The generated module carries that school's sponsor slot,
// so this doubles as the fulfillment tool for per-school sales.
const WIDGET_ORIGIN = SITE.widgetOrigin;

function EmbedBuilder({ schools }) {
  const sorted = useMemo(
    () => [...schools].sort((a, b) => a.name.localeCompare(b.name)),
    [schools],
  );
  const [schoolId, setSchoolId] = useState(() => sorted[0]?.id ?? "");
  const [sport, setSport] = useState("football");
  const [copied, setCopied] = useState(false);

  const frameId = `${SITE.storagePrefix}-team-${schoolId}`;
  const snippet = `<iframe id="${frameId}"
  src="${WIDGET_ORIGIN}#/${sport}/embed/${schoolId}"
  width="100%" height="330" frameborder="0" loading="lazy"
  style="border:0;display:block;max-width:640px;"></iframe>
<script>
  (function () {
    var f = document.getElementById('${frameId}');
    window.addEventListener('message', function (e) {
      if (!e.data || e.data.type !== '${SITE.messageNamespace}:resize') return;
      if (f && e.source === f.contentWindow && e.data.height > 0) {
        f.style.height = e.data.height + 'px';
      }
    });
  })();
</script>`;

  const copy = () => {
    navigator.clipboard?.writeText(snippet).then(() => {
      setCopied(true);
      trackEvent("mediakit-embed-copy", { school: schoolId, sport });
      setTimeout(() => setCopied(false), 2000);
    });
  };

  return (
    <section className="mk-group mk-embed">
      <h2 className="mk-group__title">Per-school embed builder</h2>
      <p className="mk-embed__lede">
        Drop a live team module into any {SITE.orgShort} story or sidebar —
        record, last/next game, and that school&apos;s sponsor. Pick a team,
        copy, paste into WordPress (Custom HTML block).
      </p>
      <div className="mk-embed__controls">
        <label>
          School
          <select value={schoolId} onChange={(e) => setSchoolId(e.target.value)}>
            {sorted.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
        </label>
        <label>
          Sport
          <select value={sport} onChange={(e) => setSport(e.target.value)}>
            {SPORT_IDS.map((id) => (
              <option key={id} value={id}>
                {configFor(id)?.label ?? id}
              </option>
            ))}
          </select>
        </label>
        <button type="button" className="mk-btn" onClick={copy}>
          {copied ? "Copied!" : "Copy embed code"}
        </button>
      </div>
      <pre className="mk-embed__code">
        <code>{snippet}</code>
      </pre>
      <p className="mk-embed__preview-note">
        Live preview:{" "}
        <a
          href={`${WIDGET_ORIGIN}#/${sport}/embed/${schoolId}`}
          target="_blank"
          rel="noopener noreferrer"
        >
          {WIDGET_ORIGIN}#/{sport}/embed/{schoolId}
        </a>
      </p>
    </section>
  );
}

// A small "here's where your brand appears" lockup so an advertiser can
// picture the placement. Brand name is a faint stand-in.
function SurfacePreview({ preview }) {
  if (!preview) return null;
  return (
    <div className={`mk-preview mk-preview--${preview.tone}`}>
      <span className="mk-preview__label">{preview.label}</span>
      <span className="mk-preview__brand">Your brand</span>
    </div>
  );
}
