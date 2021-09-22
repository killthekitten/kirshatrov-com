module.exports = {
  purge: [
    './**/*.html',
    './**/*.md',
  ],
  darkMode: false, // or 'media' or 'class'
  theme: {
    fontFamily: {
      sans: ['Lato', 'sans-serif'],
      serif: ['Cardo', 'serif'],
    },
    extend: {
      colors: {
        'palette-a': '#80aeb5',
        'palette-b': '#ff5645',
        'palette-c': '#19503d',
        'palette-d': '#174f3c',
        'palette-e': '#ffca9c',
        'palette-f': '#e58df0',
        'default-link': '#003d73',
        'palette-g': '#ff7693',
        'map-a': '#17263c',
        'map-b': '#515c6d',
      },
      width: {
        '56': '56rem',
      },
    },
  },
  variants: {
    extend: {},
  },
  plugins: [],
}
