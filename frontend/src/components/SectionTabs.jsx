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

  return (
    <nav className="section-tabs" aria-label="Dashboard sections" ref={ref}>
      <ul className="section-tabs__list" role="tablist">
        {tabs.map((t) => (
          <li key={t.id} className="section-tabs__item" role="presentation">
            <button
              type="button"
              role="tab"
              aria-selected={t.id === active}
              className={
                "section-tabs__tab" +
                (t.id === active ? " section-tabs__tab--active" : "")
              }
              onClick={() => onChange(t.id)}
            >
              {t.label}
            </button>
          </li>
        ))}
      </ul>
    </nav>
  );
}
