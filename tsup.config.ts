import { defineConfig } from 'tsup';
import { readFileSync } from 'node:fs';

interface PkgJson {
  readonly version: string;
}

const pkg = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8')) as PkgJson;

export default defineConfig({
  entry: ['src/index.ts'],
  format: ['esm', 'cjs'],
  dts: true,
  sourcemap: true,
  clean: true,
  minify: false,
  splitting: false,
  treeshake: true,
  target: 'node20',
  outDir: 'dist',
  outExtension({ format }) {
    return {
      js: format === 'cjs' ? '.cjs' : '.js',
    };
  },
  tsconfig: 'tsconfig.build.json',
  define: {
    'globalThis.__FLUTE_SDK_VERSION__': JSON.stringify(pkg.version),
  },
});
