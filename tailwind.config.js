export default {
  content: ['./index.html', './src/**/*.{js,jsx}'],
  theme: {
    extend: {
      fontFamily: {
        sans: ['Inter', 'ui-sans-serif', 'system-ui', 'sans-serif']
      },
      colors: {
        tournament: '#facc15',
        night: '#0f172a'
      },
      boxShadow: {
        glow: '0 0 32px rgba(250, 204, 21, 0.18)'
      }
    }
  },
  plugins: []
}
