/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  theme: {
    extend: {
      colors: {
        bg: {
          primary: '#0A0A12',
          card: '#13131F',
          card2: '#1C1C2E',
        },
        accent: {
          DEFAULT: '#6C63FF',
          green: '#00C896',
          red: '#FF5C7A',
          yellow: '#FFB800',
        },
        text: {
          primary: '#F0F0FF',
          secondary: '#8080A8',
          muted: '#3A3A58',
        },
        border: '#1E1E30',
      },
      fontFamily: {
        display: ['Inter', 'sans-serif'],
        body: ['Inter', 'sans-serif'],
        mono: ['Inter', 'monospace'],
      },
      borderRadius: {
        '2xl': '1rem',
        '3xl': '1.5rem',
        '4xl': '2rem',
      },
    },
  },
  plugins: [],
}
