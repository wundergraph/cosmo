module.exports = {
  content: ["./src/**/*.{html,js,ts,jsx,tsx,ftl,scss,properties}"],
  theme: {
    extend: {
      colors: {
        gray: {
          50: "#F9F9FB",
          100: "#F3F3F6",
          200: "#E5E5EB",
          300: "#D2D1DB",
          400: "#9D9CB0",
          500: "#6B6B80",
          600: "#4B4B63",
          700: "#393852",
          800: "#201F38",
          850: "#1A1A38",
          900: "#171632",
          950: "#101023",
        },
      },
    },
  },
  variants: {},
  plugins: [require("@tailwindcss/forms")],
};
