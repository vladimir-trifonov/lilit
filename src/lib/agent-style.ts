/**
 * Deterministic agent styling — icons and colors derived from agent type string.
 * No hardcoded agent names. Any agent type gets a stable, unique appearance.
 *
 * Client-safe: no Node.js dependencies.
 */

// ---- Hash ----

/** Simple string hash (djb2) returning a positive integer. */
function hashString(str: string): number {
  let hash = 5381;
  for (let i = 0; i < str.length; i++) {
    hash = ((hash << 5) + hash + str.charCodeAt(i)) >>> 0;
  }
  return hash;
}

// ---- Icons ----

/** Pool of neutral role-agnostic emojis. Hash picks one deterministically. */
const ICON_POOL = [
  "\u{1F916}", // 🤖
  "\u{1F9E0}", // 🧠
  "\u{2699}\uFE0F", // ⚙️
  "\u{1F4A1}", // 💡
  "\u{1F527}", // 🔧
  "\u{1F9ED}", // 🧭
  "\u{1F4CB}", // 📋
  "\u{1F4BB}", // 💻
  "\u{1F6E1}\uFE0F", // 🛡️
  "\u{1F680}", // 🚀
  "\u{1F50D}", // 🔍
  "\u{1F3AF}", // 🎯
  "\u{26A1}",  // ⚡
  "\u{1F4D0}", // 📐
  "\u{1F9EA}", // 🧪
  "\u{1F310}", // 🌐
];

/**
 * Get a deterministic icon for an agent type.
 * Same string always produces the same emoji.
 */
export function getAgentIcon(agentType: string): string {
  return ICON_POOL[hashString(agentType) % ICON_POOL.length];
}

// ---- Colors (OKLCH) ----

/**
 * Generate a deterministic OKLCH color from an agent type string.
 * Distributes hues evenly across the wheel for visual variety.
 * Returns a CSS `oklch(...)` value.
 */
export function getAgentColor(agentType: string): string {
  const hue = hashString(agentType) % 360;
  return `oklch(0.65 0.15 ${hue})`;
}

