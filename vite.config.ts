import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { resolve } from 'path';
import fs from 'fs';

export default defineConfig(({ mode }) => {
const target = mode === 'firefox' ? 'firefox' : 'chrome';

return {
		plugins: [
		react(),
		{
			name: 'manifest-copy',
			closeBundle() {
			// Read template manifest
			const manifest = JSON.parse(fs.readFileSync('public/manifest.json', 'utf-8'));

			// Inject background field depending on target
			if (target === 'firefox') {
				manifest.background = {
					scripts: ['background/background.js'],
					type: 'module'
				};
			} else {
				manifest.background = {
					service_worker: 'background/background.js',
					type: 'module'
				};
			}

			// Ensure dist exists
			if (!fs.existsSync('dist')) fs.mkdirSync('dist');

			// Write final manifest
			fs.writeFileSync('dist/manifest.json', JSON.stringify(manifest, null, 2));
			console.log(`✅ Manifest written for ${target}`);
			}
		}
		],
		publicDir: 'public',
		build: {
		outDir: 'dist',
		emptyOutDir: true,
		rollupOptions: {
			input: {
			popup: resolve(__dirname, 'src/popup/popup.html'),
			settings: resolve(__dirname, 'src/settings/settings.html'),
			background: resolve(__dirname, 'src/background/background.ts'),
			content: resolve(__dirname, 'src/content/content.ts')
			},
			output: {
			entryFileNames: (assetInfo) => {
				if (assetInfo.name === 'background') return 'background/[name].js';
				if (assetInfo.name === 'content') return 'content/[name].js';
				if (assetInfo.name === 'popup') return 'popup/[name].js';
				if (assetInfo.name === 'settings') return 'settings/[name].js';
				return 'assets/[name]-[hash].js';
			},
			chunkFileNames: 'assets/[name]-[hash].js',
			assetFileNames: 'assets/[name]-[hash][extname]'
			}
		}
		}
	};
});
