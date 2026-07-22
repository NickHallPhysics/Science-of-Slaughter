import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  base: "https://nickhallphysics.github.io/Science-of-Slaughter/",
  test: {
    globals: false,
    environment: 'node',
  },
});
