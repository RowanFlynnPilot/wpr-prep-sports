import { useEffect, useRef } from "react";

/**
 * Secondary tab strip under the pinned hero on the dashboard. Switches
 * which group of sections is visible so a sport page isn't one long
 * scroll. Sits below the sport switcher (two rows: pick the sport, then
 * pick the view).
 *
 * Mirrors SportSwitcher's overflow behavior: a right-edge fade hints
 * "scroll for more" only while the strip actually overflows (the
 * `--scrollable` class), so on wide viewports it stays flush.
 *
 * Renders nothing for a single tab — no point showing a lone tab.
 */
export default function SectionTabs({ tabs, active, onChange }) {
  const ref = useRef(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const update = () =>
      el.classList.toggle(
        "section-tabs--scrollable",
        el.scrollWidth > el.clientWidth + 1,
      );
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
  }, [tabs.length]);

  // Keep the active tab scrolled into view on narrow screens.
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const id = setTimeout(() => {
      const node = el.querySelector(".section-tabs__tab--active");
      if (!node) return;
      const target = node.offsetLeft - el.clientWidth / 2 + node.offsetWidth / 2;
      el.scrollLeft = Math.max(0, target);
    }, 0);
    return () => clearTimeout(id);
  }, [active]);

  if (tabs.length < 2) return null;

  // Arrow-key navigation. Announcing role="tab" without it is arguably worse
  // than plain buttons: a screen-reader user is told this is a tablist and
  // then finds the documented arrow keys do nothing. Automatic activation
  // (move + select together) matches how the tabs behave on click and keeps
  // the ?tab= URL in step.
  const onKeyDown = (e) => {
    const i = tabs.findIndex((t) => t.id === active);
    if (i < 0) return;
    const last = tabs.length - 1;
    let next = null;
    if (e.key === "ArrowRight") next = i === last ? 0 : i + 1;
    else if (e.key === "ArrowLeft") next = i === 0 ? last : i - 1;
    else if (e.key === "Home") next = 0;
    else if (e.key === "End") next = last;
    if (next === null) return;
    e.preventDefault();
    onChange(tabs[next].id);
    // Focus follows selection, or the user's focus is stranded on a tab
    // that is no longer the selected one.
    ref.current?.querySelector(`#${tabId(tabs[next].id)}`)?.focus();
  };

  return (
    <nav className="section-tabs" aria-label="Dashboard sections" ref={ref}>
      <ul className="section-tabs__list" role="tablist" onKeyDown={onKeyDown}>
        {tabs.map((t) => {
          const selected = t.id === active;
          return (
            <li key={t.id} className="section-tabs__item" role="presentation">
              <button
                type="button"
                role="tab"
                id={tabId(t.id)}
                aria-selected={selected}
                aria-controls={panelId(t.id)}
                // Roving tabindex: the tablist is ONE tab stop, then arrows
                // move within it — otherwise every tab is its own stop.
                tabIndex={selected ? 0 : -1}
                className={
                  "section-tabs__tab" + (selected ? " section-tabs__tab--active" : "")
                }
                onClick={() => onChange(t.id)}
              >
                {t.label}
              </button>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}

/** Shared id helpers so the panel in DashboardPage can point back here. */
export const tabId = (id) => `section-tab-${id}`;
export const panelId = (id) => `section-panel-${id}`;
