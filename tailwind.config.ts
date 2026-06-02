import type { Config } from "tailwindcss";

export default {
  content: ["./src/**/*.{html,ts,tsx}"],
  theme: {
    extend: {
      colors: {
        ink: "#17212b",
        panel: "#f6f7f9",
        surface: "#ffffff",
        accent: "#0f766e",
        "accent-soft": "#e6f4f1",
        signal: "#be123c"
      },
      fontFamily: {
        mono: ["ui-monospace", "SFMono-Regular", "Menlo", "Monaco", "Consolas", "monospace"]
      },
      boxShadow: {
        card: "0 1px 2px 0 rgb(15 23 42 / 0.04), 0 1px 3px 0 rgb(15 23 42 / 0.06)",
        drawer: "-12px 0 32px -12px rgb(15 23 42 / 0.25)",
        menu: "0 8px 24px -6px rgb(15 23 42 / 0.18)"
      },
      keyframes: {
        "drawer-in": {
          from: { transform: "translateX(100%)" },
          to: { transform: "translateX(0)" }
        },
        "fade-in": {
          from: { opacity: "0" },
          to: { opacity: "1" }
        }
      },
      animation: {
        "drawer-in": "drawer-in 0.22s cubic-bezier(0.32, 0.72, 0, 1)",
        "fade-in": "fade-in 0.18s ease-out"
      }
    }
  },
  plugins: []
} satisfies Config;
