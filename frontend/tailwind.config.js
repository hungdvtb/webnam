/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      colors: {
          "primary": "#1B365D", // Cobalt Blue
          "background-light": "#F9F5F0", // Rice Paper
          "background-dark": "#111821",
          "gold": "#C5A065", // Antique Gold
          "brick": "#C15949", // Brick Red
          "stone": "#8C8681", // Stone Grey
          "umber": "#2C2420", // Dark Umber
      },
      fontFamily: {
          "display": ["Playfair Display", "serif"],
          "body": ["EB Garamond", "serif"],
          "ui": ["Lora", "serif"],
          "sans": ["Noto Sans", "sans-serif"], // Fallback
      },
      borderRadius: {
          "DEFAULT": "0.125rem", // 2px - Sharp/Stone-like
          "lg": "0.25rem",
          "xl": "0.5rem",
          "full": "0.75rem"
      },
    },
  },
  plugins: [],
}
