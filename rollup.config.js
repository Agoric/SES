import resolve from 'rollup-plugin-node-resolve';
import pkg from './package.json';

const defaultConfig = {
  input: 'src/index.js',
  plugins: [resolve()],
};

const iife = {
  ...defaultConfig,
  output: {
    file: 'dist/ses-shim.js',
    exports: 'named',
    format: 'iife',
    name: 'SES',
    sourcemap: true,
  },
};

const modules = {
  ...defaultConfig,
  output: [
    {
      file: './dist/cjs.js',
      format: 'cjs',
      sourcemap: true,
    },
    {
      file: './dist/esm.js',
      format: 'es',
      sourcemap: true,
    },
  ],
  // Do not bundle up external depenencies for module builds
  external: Object.keys(pkg.dependencies),
  plugins: [
    // Only resolve and bundle local files, not external dependencies
    resolve({
      only: [/^\.{0,2}\//],
    }),
  ],
};

const umd = {
  ...defaultConfig,
  output: {
    file: 'dist/umd.js',
    name: 'SES',
    format: 'umd',
    sourcemap: true,
    amd: {
      id: 'SES',
    },
  },
};

export default [iife, modules, umd];
