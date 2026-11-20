const { platformSelect } = require('nativewind/theme');
// Green terminal palette. Use these as bg-term-*, text-term-* and border-term-*.
// JS code that needs a raw color (placeholders, inline styles) imports the same file.
const term = require('./src/terminal-colors.json');

module.exports = {
  content: ['./app/**/*.{ts,tsx}', './src/**/*.{ts,tsx}'],
  presets: [require('nativewind/preset')],
  theme: {
    extend: {
      colors: { term },
      // Each platform's built-in monospace font. No font files to bundle.
      fontFamily: { mono: platformSelect({ ios: 'Menlo', android: 'monospace', default: 'monospace' }) },
    },
  },
};
