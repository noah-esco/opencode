/**
 * Sidebar-first navigation.
 *
 * true  - the sidebar is the primary way to move between sessions, and the
 *         titlebar tab strip is hidden. Session history lives in one place.
 * false - upstream behaviour: tab strip on top, sidebar collapsed by default.
 *
 * Kept as one constant so this is a one-line revert, and so the tab strip
 * component itself stays untouched (cheaper rebases against upstream).
 */
export const SIDEBAR_NAV = true
