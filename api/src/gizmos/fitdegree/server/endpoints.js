// api/src/gizmos/fitdegree/server/endpoints.js

/**
 * FitDegree endpoint map.
 *
 * IMPORTANT:
 * - Some code calls endpoints as strings (TEAM_MEMBERS)
 * - Some code calls them as functions (instructors())
 * This file supports BOTH for backwards/forwards compatibility.
 *
 * Based on real FitDegree network calls seen in DevTools:
 * - List employees/instructors: GET /employee/?company_id=...
 * - Token endpoint: GET /employees/token/?api_token=...
 */

export const FITDEGREE_ENDPOINTS = {
  // ✅ Canonical endpoints (real FitDegree base endpoints)
  EMPLOYEES: "/employee/",
  EMPLOYEE_BY_ID: "/employee/", // same endpoint, uses id=12345
  TOKEN: "/employees/token/",

  // ✅ Back-compat “old names” that previously pointed at /api/v1/*
  // Treat team members / instructors as employees
  TEAM_MEMBERS: "/employee/",
  UPCOMING_CLASSES: "/classes/", // may differ per FitDegree account; keep as placeholder

  // ✅ Friendly string aliases
  employees: "/employee/",
  employee: "/employee/",
  instructors: "/employee/",
  teamMembers: "/employee/",
  team_members: "/employee/",
  upcomingClasses: "/classes/",
  classes: "/classes/",

  // ✅ Function aliases (in case router calls endpoints.instructors())
  EMPLOYEES_FN() {
    return "/employee/";
  },
  employeesFn() {
    return "/employee/";
  },
  instructorsFn() {
    return "/employee/";
  },
  instructors() {
    return "/employee/";
  },
  teamMembersFn() {
    return "/employee/";
  },
  team_members_fn() {
    return "/employee/";
  },
  team_members() {
    return "/employee/";
  },

  // Classes placeholders (keep, but will likely need adjustment)
  upcoming_classes() {
    return "/classes/";
  },
  upcomingClassesFn() {
    return "/classes/";
  },
  classesFn() {
    return "/classes/";
  },
};
