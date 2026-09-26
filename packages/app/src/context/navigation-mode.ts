/**
 * Sidebar-first navigation.
 *
 * true  - sessions are navigated from the sidebar and the titlebar tab strip is
 *         hidden. Both layouts now have a sidebar: the legacy pages/layout.tsx
 *         via SidebarContent, and the new pages/layout-new.tsx via
 *         LayoutNewSidebar (which is driven by the same tabs context the strip
 *         used, so it is that strip relocated rather than a parallel notion of
 *         "open sessions").
 * false - upstream behaviour: tab strip on top.
 *
 * One constant so this stays a one-line revert and the tab strip component
 * itself is never edited, which keeps rebases against upstream cheap.
 */
export const SIDEBAR_NAV = true
