module.exports = {
  content: ['./src/**/*.{html,js,ts,jsx,tsx,ftl,scss,properties}'],
  theme: {
    extend: {
      colors: {
        gray: {
          50: 'hsl(258, 16%, 94%)',
          100: 'hsl(258, 14%, 91%)',
          200: 'hsl(258, 12%, 83%)',
          300: 'hsl(258, 10%, 71%)',
          400: 'hsl(258, 10%, 57%)',
          500: 'hsl(258, 10%, 45%)',
          600: 'hsl(258, 10%, 36%)',
          700: 'hsl(258, 12%, 29%)',
          800: 'hsl(258, 14%, 24%)',
          850: 'hsl(258, 14%, 17%)',
          900: 'hsl(258, 21%, 9%)',
          950: 'hsl(273, 52%, 4%)',
        },
        primary: {
          DEFAULT: 'hsl(258, 100%, 50%)',
          foreground: 'hsl(258, 100%, 100%)',
        },
        link: {
          DEFAULT: 'hsl(258, 12%, 83%)',
          hover: '#ffffff',
        },
      },
    },
  },
  variants: {},
  plugins: [require('@tailwindcss/forms')],
};
