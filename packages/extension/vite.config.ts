import { defineConfig, Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import { resolve } from 'path';
import { copyFileSync, mkdirSync, existsSync, readdirSync } from 'fs';

// Plugin to copy static files
function copyFiles(): Plugin {
  return {
    name: 'copy-files',
    closeBundle() {
      const distDir = 'dist';
      const srcDir = resolve(__dirname, 'src');
      const outDir = resolve(__dirname, distDir);

      // Copy manifest.json
      copyFileSync(
        resolve(srcDir, 'manifest.json'),
        resolve(outDir, 'manifest.json')
      );

      // Copy icons directory
      const iconsOutDir = resolve(outDir, 'icons');
      if (!existsSync(iconsOutDir)) {
        mkdirSync(iconsOutDir, { recursive: true });
      }

      const iconsSrcDir = resolve(srcDir, 'icons');
      if (existsSync(iconsSrcDir)) {
        const files = readdirSync(iconsSrcDir);
        for (const file of files) {
          copyFileSync(
            resolve(iconsSrcDir, file),
            resolve(iconsOutDir, file)
          );
        }
      }

      console.log('✓ Copied manifest.json and icons to dist');
    },
  };
}

export default defineConfig(({ mode }) => ({
  plugins: [react(), copyFiles()],
  build: {
    outDir: mode === 'firefox' ? 'dist-firefox' : 'dist',
    emptyOutDir: true,
    rollupOptions: {
      input: {
        popup: resolve(__dirname, 'src/popup/index.html'),
        background: resolve(__dirname, 'src/background/index.ts'),
        content: resolve(__dirname, 'src/content/index.ts'),
      },
      output: {
        entryFileNames: '[name].js',
        chunkFileNames: 'chunks/[name].[hash].js',
        assetFileNames: 'assets/[name].[ext]',
      },
    },
    sourcemap: mode === 'development',
    minify: mode !== 'development',
  },
  resolve: {
    alias: {
      '@': resolve(__dirname, 'src'),
    },
  },
}));
