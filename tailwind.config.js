const c = (name) => `rgb(var(--${name}) / <alpha-value>)`;

/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './*.{ts,tsx}', './components/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        bg: c('bg'),
        panel: c('panel'),
        raised: c('raised'),
        hover: c('hover'),
        line: c('line'),
        ink: c('text'),
        muted: c('muted'),
        faint: c('faint'),
        accent: c('accent'),
        danger: c('danger'),
        ok: c('ok'),
      },
      fontFamily: {
        sans: ['"Geist Variable"', 'system-ui', 'Segoe UI', 'sans-serif'],
        mono: ['"Geist Mono Variable"', 'ui-monospace', 'Consolas', 'monospace'],
      },
      fontSize: {
        '2xs': ['10.5px', '14px'],
        xs: ['11.5px', '16px'],
        sm: ['12.5px', '18px'],
      },
      borderRadius: { DEFAULT: '5px', md: '6px', lg: '8px' },
      keyframes: {
        rise: { from: { opacity: 0, transform: 'translateY(6px)' }, to: { opacity: 1, transform: 'none' } },
      },
      animation: { rise: 'rise 160ms ease-out' },
    },
  },
  plugins: [],
};
