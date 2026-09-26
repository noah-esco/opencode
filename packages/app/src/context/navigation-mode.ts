/**
 * Sidebar-first navigation.
 *
 * CURRENTLY FALSE, deliberately.
 *
 * The new design (settings.general.newLayoutDesigns, which is ON for this user)
 * renders pages/layout-new.tsx - Titlebar + main + DebugBar and NOTHING ELSE.
 * It has no sidebar. SidebarContent, and therefore the Code/Chat ModeSwitch,
 * only exist in the legacy pages/layout.tsx.
 *
 * So hiding the tab strip here removes the only way to move between sessions.
 * Turning this on requires first BUILDING a sidebar for the new layout; it is
 * not a matter of hiding the strip.
 */
export const SIDEBAR_NAV = false
