/** @type {import('tailwindcss').Config} */
export default {
  // Tailwind only emits the classes it can see in these files. If a class
  // ever renders as unstyled in production but works in dev, this glob is
  // the first place to look.
  content: ["./index.html", "./src/**/*.{js,jsx,ts,tsx}"],
  theme: {
    extend: {
      fontFamily: {
        // `font-mono` is the arena's voice, so it is bound explicitly rather
        // than left to whatever monospace the OS picks.
        mono: ["JetBrains Mono", "ui-monospace", "SFMono-Regular", "Menlo", "monospace"],
        sans: ["Space Grotesk", "ui-sans-serif", "system-ui", "-apple-system", "sans-serif"],
        // The display voice. Use via the .af-display class, which also sets
        // the width axis and tracking -- `font-display` alone gives you
        // Archivo at its default width, which is not the point of using it.
        display: ["Archivo", "Archivo Black", "ui-sans-serif", "system-ui", "sans-serif"],
      },
      colors: {
        obsidian: "#000000",
        panel: "#0A0B0F",
        raised: "#12141C",
      },
    },
  },
  plugins: [],
};
