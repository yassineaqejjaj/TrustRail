import type { Config } from "tailwindcss";

const config: Config = {
  content: ["./src/**/*.{js,ts,jsx,tsx,mdx}"],
  darkMode: "media",
  theme: {
    extend: {
      colors: {
        bg: "#F7F8FA",
        surface: "#FFFFFF",
        sidebar: "#101828",
        "sidebar-hover": "#1D2939",
        accent: "#315CFD",
        "accent-hover": "#2748D6",
        success: "#16845B",
        pending: "#B7791F",
        danger: "#C63434",
        ink: "#111827",
        muted: "#667085",
        border: "#E4E7EC",
      },
      fontFamily: {
        sans: [
          "Inter",
          "-apple-system",
          "BlinkMacSystemFont",
          "Segoe UI",
          "Roboto",
          "Helvetica Neue",
          "Arial",
          "sans-serif",
        ],
        mono: [
          "ui-monospace",
          "SFMono-Regular",
          "Menlo",
          "Consolas",
          "Liberation Mono",
          "monospace",
        ],
      },
      boxShadow: {
        card: "0 1px 2px 0 rgba(16, 24, 40, 0.05)",
      },
    },
  },
  plugins: [],
};

export default config;
