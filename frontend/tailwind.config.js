/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  darkMode: 'class',
  theme: {
    extend: {
      colors: {
        ops: {
          bg: '#090d16',
          panel: '#0f172a',
          card: '#131e36',
          border: '#1e293b',
          borderLight: '#334155',
          accent: '#06b6d4',
          accentGlow: '#0891b2',
          success: '#10b981',
          warning: '#f59e0b',
          danger: '#ef4444',
          muted: '#64748b'
        },
        // WeEvolveIT-inspired "cyber-editorial" system — carbon/near-black
        // surfaces with a hot-magenta accent used sparingly (glows, pips,
        // active states). Backed by CSS custom properties in src/styles/theme.css.
        carbon: {
          bg: 'var(--carbon-bg)',
          card: 'var(--carbon-card-bg)',
          glass: 'var(--carbon-surface-glass)',
          border: 'var(--carbon-border-subtle)',
          accent: 'var(--carbon-accent)',
          accentGlow: 'var(--carbon-accent-glow)',
          text: 'var(--carbon-text-primary)',
          muted: 'var(--carbon-text-muted)'
        }
      },
      fontFamily: {
        mono: ['JetBrains Mono', 'Menlo', 'Consolas', 'monospace'],
        sans: ['Inter', 'system-ui', 'sans-serif'],
        display: ['Syne', 'Inter', 'system-ui', 'sans-serif']
      }
    },
  },
  plugins: [],
}
