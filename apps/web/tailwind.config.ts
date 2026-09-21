import type { Config } from "tailwindcss";

const config: Config = {
  content: ["./src/**/*.{js,ts,jsx,tsx,mdx}"],
  darkMode: "media",
  theme: {
    extend: {
      colors: {
        // Backed by CSS custom properties (see globals.css) so every one of
        // these utilities -- bg-bg, text-ink, border-border, etc. -- already
        // in use across the app automatically follows prefers-color-scheme,
        // with no per-component dark: variants needed. Colors that don't
        // change between modes (accent, success, pending, danger, sidebar)
        // still go through a variable for consistency, they just aren't
        // redefined in the dark media query.
        bg: "rgb(var(--color-bg) / <alpha-value>)",
        surface: "rgb(var(--color-surface) / <alpha-value>)",
        sidebar: "rgb(var(--color-sidebar) / <alpha-value>)",
        "sidebar-hover": "rgb(var(--color-sidebar-hover) / <alpha-value>)",
        accent: "rgb(var(--color-accent) / <alpha-value>)",
        "accent-hover": "rgb(var(--color-accent-hover) / <alpha-value>)",
        success: "rgb(var(--color-success) / <alpha-value>)",
        pending: "rgb(var(--color-pending) / <alpha-value>)",
        danger: "rgb(var(--color-danger) / <alpha-value>)",
        ink: "rgb(var(--color-ink) / <alpha-value>)",
        muted: "rgb(var(--color-muted) / <alpha-value>)",
        border: "rgb(var(--color-border) / <alpha-value>)",
      },
      fontFamily: {
        sans: ["var(--font-sans)", "-apple-system", "BlinkMacSystemFont", "Segoe UI", "Roboto", "sans-serif"],
        mono: ["var(--font-mono)", "ui-monospace", "SFMono-Regular", "Menlo", "monospace"],
      },
      borderRadius: {
        card: "16px",
      },
      boxShadow: {
        card: "0 1px 2px 0 rgba(16, 24, 40, 0.05)",
        glass: "0 1px 2px 0 rgba(16, 24, 40, 0.04), 0 8px 24px 0 rgba(16, 24, 40, 0.05)",
      },
    },
  },
  plugins: [],
};

export default config;
