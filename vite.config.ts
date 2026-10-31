/// <reference types="vitest" />
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { fontSubset } from './tools/font-subset';

// Configuração recomendada pelo Tauri 2: porta fixa e sem limpar o terminal.
export default defineConfig({
  plugins: [react(), fontSubset(['src'])],
  clearScreen: false,
  // Não vigiar a pasta do Rust: os arquivos da compilação ficam travados no Windows e derrubam o Vite.
  server: { port: 1420, strictPort: true, watch: { ignored: ['**/src-tauri/**'] } },
  envPrefix: ['VITE_', 'TAURI_ENV_'],
  build: { target: 'es2021', sourcemap: false },
  test: { environment: 'node' }
});
