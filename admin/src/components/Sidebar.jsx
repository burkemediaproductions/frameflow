import React, { useEffect, useMemo, useState } from "react";
import { NavLink, useLocation } from "react-router-dom";
import { useSettings } from "../context/SettingsContext";

// Utility to check if the current role can see an item. If the item has
// no roles specified (or roles is an empty array), it's visible to all.
const canSee = (itemRoles, role) => {
  if (!Array.isArray(itemRoles) || itemRoles.length === 0) return true;
  if (!role) return false;
  return itemRoles.includes(role);
};

// Stateless link component for sidebar links.
// Applies a primary class when the NavLink matches the current location.
const SidebarLink = ({ to, label, target }) => (
  <NavLink
    to={to}
    target={target || "_self"}
    className={({ isActive }) =>
      "su-btn su-nav-link" + (isActive ? " primary" : "")
    }
    style={{ display: "block", marginBottom: 8 }}
  >
    {label}
  </NavLink>
);

/**
 * Sidebar renders a navigation sidebar.
 * Props:
 * - onClose: optional callback for mobile close button
 * - role: current user's role, used to filter items by item.roles
 * - onLogout: optional callback you can pass if you want to run extra logic
 */
export default function Sidebar({ onClose, role = "ADMIN", onLogout }) {
  const { settings } = useSettings();
  const location = useLocation();

  // Default nav when settings.navSidebar isn't provided.
  const defaultNav = useMemo(
    () => [
      { label: "Dashboard", to: "/admin" },
      { label: "Menus", to: "/admin/menus" },
      { label: "Headers", to: "/admin/headers" },
      { label: "Footers", to: "/admin/footers" },
      { label: "Users", to: "/admin/users" },
      { label: "Taxonomies", to: "/admin/taxonomies" },
      { label: "Content", to: "/admin/content" },
      { label: "Quick Builder", to: "/admin/quick-builder" },
      {
        label: "Settings",
        children: [
          { label: "Settings", to: "/admin/settings" },
          { label: "Roles", to: "/admin/settings/roles" },
          { label: "Dashboards", to: "/admin/settings/dashboards" },
          { label: "Permissions", to: "/admin/settings/permissions" },
          { label: "Entry Views", to: "/admin/settings/entry-views" },
          { label: "List Views", to: "/admin/settings/list-views" },
        ],
      },
    ],
    []
  );

  // Determine which nav items to render: prefer settings.navSidebar, then settings.nav,
  // otherwise fall back to defaultNav.
  const items = useMemo(() => {
    const fromSidebar =
      Array.isArray(settings?.navSidebar) && settings.navSidebar.length > 0
        ? settings.navSidebar
        : null;

    const fromNav =
      !fromSidebar && Array.isArray(settings?.nav) && settings.nav.length > 0
        ? settings.nav
        : null;

    return fromSidebar || fromNav || defaultNav;
  }, [settings, defaultNav]);

  // Keep track of which parent menus are expanded.
  const [openParents, setOpenParents] = useState({});

  // Automatically open any parent whose children contain the current route.
  useEffect(() => {
    const path = location.pathname;
    const nextOpen = {};

    items.forEach((item, index) => {
      if (!Array.isArray(item.children) || item.children.length === 0) return;

      // If any visible child matches the current path, open the parent.
      const anyChildMatches = item.children.some((child) => {
        if (!child?.to) return false;
        // Also respect roles when deciding to auto-open
        if (!canSee(child.roles, role)) return false;
        return path === child.to || path.startsWith(child.to + "/") || path.startsWith(child.to);
      });

      if (anyChildMatches) nextOpen[index] = true;
    });

    setOpenParents((prev) => ({ ...prev, ...nextOpen }));
  }, [location.pathname, items, role]);

  const toggleParent = (index) => {
    setOpenParents((prev) => ({
      ...prev,
      [index]: !prev[index],
    }));
  };

  const handleLogout = () => {
    try {
      // Remove common token keys (safe even if some don't exist)
      localStorage.removeItem("token");
      localStorage.removeItem("access_token");
      localStorage.removeItem("jwt");
      localStorage.removeItem("serviceup_token");

      // Also clear any cached user
      localStorage.removeItem("user");
      localStorage.removeItem("me");
    } catch (e) {
      // ignore
    }

    if (typeof onLogout === "function") {
      onLogout();
      return;
    }

    // Default: send to login
    window.location.href = "/login";
  };

  return (
    <aside className="su-sidebar" aria-label="Main navigation">
      {onClose && (
        <button
          type="button"
          className="su-btn su-sidebar-close"
          onClick={onClose}
          aria-label="Close navigation menu"
        >
          ✕ Close
        </button>
      )}

      <div className="su-nav-header">Menu</div>

      {items.map((item, i) => {
        // Skip item if role isn't allowed
        if (!canSee(item.roles, role)) return null;

        const hasChildren = Array.isArray(item.children) && item.children.length > 0;

        // Simple link
        if (!hasChildren) {
          if (!item.to) return null;
          return (
            <SidebarLink
              key={i}
              to={item.to}
              label={item.label || "Untitled"}
              target={item.target}
            />
          );
        }

        // Parent group with children filtered by role
        const visibleChildren = item.children.filter((child) => canSee(child.roles, role));

        // If no visible children, fall back to parent link if it exists
        if (visibleChildren.length === 0) {
          if (!item.to) return null;
          return (
            <SidebarLink
              key={i}
              to={item.to}
              label={item.label || "Untitled"}
              target={item.target}
            />
          );
        }

        const isOpen = !!openParents[i];

        return (
          <div key={i} className={"su-nav-parent" + (isOpen ? " open" : "")}>
            <button
              type="button"
              className="su-btn su-nav-parent-toggle"
              onClick={() => toggleParent(i)}
              aria-expanded={isOpen ? "true" : "false"}
            >
              <span className="su-nav-parent-label">{item.label || "Section"}</span>
              <span className="su-nav-caret" aria-hidden="true">
                ▸
              </span>
            </button>

            {isOpen && (
              <div className="su-nav-children">
                {visibleChildren.map((child, ci) =>
                  child.to ? (
                    <SidebarLink
                      key={`${i}-${ci}`}
                      to={child.to}
                      label={child.label || "Link"}
                      target={child.target || item.target}
                    />
                  ) : null
                )}
              </div>
            )}
          </div>
        );
      })}

      {/* Logout pinned at bottom */}
      <div style={{ marginTop: 14, paddingTop: 12, borderTop: "1px solid var(--su-border)" }}>
        <button
          type="button"
          className="su-btn"
          style={{ width: "100%" }}
          onClick={handleLogout}
        >
          Logout
        </button>
      </div>
    </aside>
  );
}
