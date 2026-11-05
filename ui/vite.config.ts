import { defineConfig } from 'vite';

export default defineConfig({
  envPrefix: ['VITE_', 'REACT_APP_'],
  server: { port: 5173, strictPort: true },
  preview: { port: 4173, strictPort: true },
  build: {
    outDir: 'dist',
    rolldownOptions: {
      onwarn(warning, defaultHandler) {
        // This is a client-rendered SPA; dependency "use client" directives need no server boundary.
        if (warning.code === 'MODULE_LEVEL_DIRECTIVE' && warning.id?.includes('node_modules')) return;
        defaultHandler(warning);
      }
    }
  }
});
