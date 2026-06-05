/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{vue,ts}"],
  theme: {
    extend: {
      colors: {
        void: "#02080f",
        ink: "#07111c",
        panel: "#0a1724",
        line: "rgba(127, 255, 246, 0.16)",
        aqua: {
          300: "#4efaf0",
          400: "#22e4d6",
          500: "#16c8bd",
          600: "#0ba79e"
        }
      },
      fontFamily: {
        sans: ["Inter", "ui-sans-serif", "system-ui", "sans-serif"],
        mono: ["JetBrains Mono", "SFMono-Regular", "Consolas", "monospace"]
      },
      boxShadow: {
        aqua: "0 0 34px rgba(34, 228, 214, 0.24)",
        panel: "0 24px 80px rgba(0, 0, 0, 0.45)"
      },
      backgroundImage: {
        grid:
          "linear-gradient(rgba(78,250,240,0.08) 1px, transparent 1px), linear-gradient(90deg, rgba(78,250,240,0.08) 1px, transparent 1px)"
      }
    }
  },
  plugins: []
};
