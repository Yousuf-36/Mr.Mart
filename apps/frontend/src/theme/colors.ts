/**
 * Mr. Mart — Cherry Bold Design System (doc 01 §7).
 *
 * Rules:
 *  1. Brand red (#990011) != Alert red (#D7263D). Alert red is reserved for critical/urgent states.
 *  2. Minimum 56dp touch targets for primary action buttons.
 *  3. Visual-first: large numerals (28-40pt), minimal text, no paragraph text > 2-3 word labels.
 */

export const COLORS = {
  // Palette - Cherry Bold
  brandRed: "#990011", // Headers, brand chrome, active tabs
  alertRed: "#D7263D", // Critical alerts, escalated borders, errors
  bg: "#FCF6F5",       // App background
  cardBg: "#FFFFFF",   // Approval Card background
  ink: "#241111",      // Primary text
  inkMuted: "#665555", // Secondary labels

  // Status colors
  statusGreen: "#1E8E3E", // Healthy stock, approve button
  statusGreenBg: "#E6F4EA",
  statusYellow: "#F2A900", // Near reorder point warning
  statusYellowBg: "#FEF7E0",
  statusRedBg: "#FCE8E6",

  // Accent
  accentNavy: "#2F3C7E",
  borderLight: "#E8DFDE",
} as const;

export const LAYOUT = {
  minTouchTarget: 56, // 56dp minimum touch target
  borderRadius: 14,
} as const;
