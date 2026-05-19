import type { Config } from 'tailwindcss';

const config: Config = {
  content: [
    './src/**/*.{js,ts,jsx,tsx,mdx}',
  ],
  theme: {
    extend: {
      colors: {
        bg:        { DEFAULT: '#F4EFE3', 2: '#EDE6D5' },
        paper:     { DEFAULT: '#FBF7EC', 2: '#FFFFFF', tint: '#F8F2E2' },
        ink:       { DEFAULT: '#0E2A24', 2: '#1A3B33', 3: '#4A5A53', 4: '#7A857F', 5: '#A8B0AB' },
        line:      { DEFAULT: '#DDD3BD', 2: '#C9BE9F', 3: '#E8DFC9' },
        accent:    { DEFAULT: '#0E2A24', hover: '#163B33' },
        amber:     { DEFAULT: '#B8801C', bg: '#F2E2BD' },
        wine:      { DEFAULT: '#8A2A2A', bg: '#EDD0CC' },
        olive:     { DEFAULT: '#5A6A2E', bg: '#DCE2C5' },
        indigo:    { DEFAULT: '#2B3A6B', bg: '#D4D9E5' },
      },
      fontFamily: {
        serif: ['var(--font-serif)', 'Georgia', 'serif'],
        sans:  ['var(--font-sans)', 'system-ui', 'sans-serif'],
        mono:  ['var(--font-mono)', 'ui-monospace', 'monospace'],
      },
      borderRadius: {
        '1': '3px', '2': '5px', '3': '8px', '4': '10px',
      },
    },
  },
  plugins: [],
};

export default config;
