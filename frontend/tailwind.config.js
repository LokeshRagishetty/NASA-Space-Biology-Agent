/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,jsx}'],
  darkMode: 'class',
  theme: {
    extend: {
      fontFamily: {
        sans: ['Inter', 'ui-sans-serif', 'system-ui', 'Segoe UI', 'sans-serif'],
      },
      colors: {
        void: '#05070f',
        orbit: '#0b1020',
        panel: 'rgba(12, 18, 34, 0.78)',
        comet: '#78e7ff',
        aurora: '#67f8c3',
        solar: '#ffb86b',
        nebula: '#a78bfa',
      },
      boxShadow: {
        glow: '0 0 40px rgba(120, 231, 255, 0.18)',
        panel: '0 24px 80px rgba(0, 0, 0, 0.35)',
      },
      backgroundImage: {
        'space-radial':
          'radial-gradient(circle at top left, rgba(120, 231, 255, 0.20), transparent 34%), radial-gradient(circle at 80% 20%, rgba(255, 184, 107, 0.12), transparent 28%), linear-gradient(135deg, #05070f 0%, #0b1020 48%, #111827 100%)',
      },
      keyframes: {
        pulseDot: {
          '0%, 100%': { opacity: '0.35', transform: 'translateY(0)' },
          '50%': { opacity: '1', transform: 'translateY(-3px)' },
        },
        drift: {
          '0%': { transform: 'translate3d(0, 0, 0)' },
          '100%': { transform: 'translate3d(-40px, -30px, 0)' },
        },
      },
      animation: {
        'pulse-dot': 'pulseDot 1.1s ease-in-out infinite',
        drift: 'drift 18s linear infinite alternate',
      },
    },
  },
  plugins: [],
}
