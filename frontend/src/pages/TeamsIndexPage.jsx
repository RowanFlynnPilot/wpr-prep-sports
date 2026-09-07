import { useMemo } from "react";
import { Link } from "react-router-dom";
import Layout from "../components/Layout.jsx";
import TeamLogo from "../components/TeamLogo.jsx";
import FavoriteButton from "../components/FavoriteButton.jsx";
import { useSportPrefix } from "../utils/links.js";
import { conferenceFor, groupByLetter, schoolsForSport } from "../utils/schoolSearch.js";
import { SITE_TITLE } from "../config/site.js";
import { SPORT_IDS } from "../config/sports.js";
import "../styles/TeamsIndex.css";

/**
 * All schools, A–Z, for the loaded sport — the browsable answer to "which
 * school?" for readers who won't type, and the one place every school
 * can be followed without first finding its team page.
 */
export default function TeamsIndexPage({ dataset, sponsors, sportConfig }) {
  const sportPrefix = useSportPrefix();
  const sportId = sportConfig?.id ?? dataset?.sport;
  const label = sportConfig?.label ?? "Teams";

  const fielding = useMemo(
    () => schoolsForSport(dataset?.schools, sportId),
    [dataset?.schools, sportId],
  );
  const others = useMemo(
    () =>
      (dataset?.schools ?? [])
        .filter((s) => !conferenceFor(s, sportId))
        .sort((a, b) => String(a.name).localeCompare(String(b.name))),
    [dataset?.schools, sportId],
  );
  const groups = useMemo(() => groupByLetter(fielding), [fielding]);

  const jumpTo = (letter) => {
    const el = document.getElementById(`letter-${letter}`);
    if (!el) return;
    el.scrollIntoView({ block: "start" });
    el.focus({ preventScroll: true });
  };

  const breadcrumb = (
    <>
      <Link to={sportPrefix} className="breadcrumb__back">
        <span aria-hidden="true" className="breadcrumb__back-arrow">‹</span>
        Back to {label}
      </Link>
      <span aria-hidden="true" className="breadcrumb__sep">·</span>
      <span className="breadcrumb__current">All schools</span>
    </>
  );

  return (
    <Layout
      breadcrumb={breadcrumb}
      sponsors={sponsors}
      footerStats={{
        sports: SPORT_IDS.length,
        games: dataset?.games?.length ?? 0,
        schools: dataset?.schools?.length ?? 0,
      }}
    >
      <section className="teams-index">
        <header className="section-header teams-index__head">
          <h1 className="teams-index__title">
            All schools <span className="teams-index__sport">· {label}</span>
          </h1>
          <span className="section-header__hint">
            {fielding.length} schools · follow one to pin it to the top of every sport
          </span>
        </header>
        <p className="sr-only">{SITE_TITLE}</p>

        {groups.length > 1 && (
          <nav className="teams-index__letters" aria-label="Jump to letter">
            {groups.map((g) => (
              <button key={g.letter} type="button" onClick={() => jumpTo(g.letter)}>
                {g.letter}
              </button>
            ))}
          </nav>
        )}

        {groups.map((g) => (
          <section
            key={g.letter}
            className="teams-index__group"
            aria-labelledby={`letter-${g.letter}`}
          >
            <h2 id={`letter-${g.letter}`} className="teams-index__letter" tabIndex={-1}>
              {g.letter}
            </h2>
            <ul className="teams-index__list">
              {g.schools.map((s) => {
                const conf = conferenceFor(s, sportId);
                const color = s.colors?.[0] ?? null;
                return (
                  <li
                    key={s.id}
                    className="teams-index__row"
                    style={color ? { "--school-color": color } : undefined}
                  >
                    <span className="teams-index__bar" aria-hidden="true" />
                    <Link to={`${sportPrefix}/team/${s.id}`} className="teams-index__main">
                      <TeamLogo
                        team={{ school_id: s.id, name: s.name, logo_url: s.logo_url ?? null }}
                        school={s}
                        size="sm"
                      />
                      <span className="teams-index__name">{s.name}</span>
                      <span className="teams-index__sub">
                        {[s.mascot, s.city].filter(Boolean).join(" · ")}
                        {conf ? ` · ${conf}` : ""}
                      </span>
                    </Link>
                    <FavoriteButton schoolId={s.id} schoolName={s.name} />
                  </li>
                );
              })}
            </ul>
          </section>
        ))}

        {others.length > 0 && (
          <p className="teams-index__others">
            No {label.toLowerCase()} team, but covered in other sports:{" "}
            {others.map((s, i) => (
              <span key={s.id}>
                {i > 0 ? ", " : ""}
                <Link to={`${sportPrefix}/team/${s.id}`}>{s.name}</Link>
              </span>
            ))}
            .
          </p>
        )}
      </section>
    </Layout>
  );
}
