import type { Config } from 'tailwindcss';

export default {
  content: ['./src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        ink: '#0b0e14',
        panel: '#11151f',
        edge: '#1e2533',
        muted: '#8b96a8',
      },
    },
  },
  plugins: [],
} satisfies Config;
