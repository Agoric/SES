import { terser } from 'rollup-plugin-terser';
import resolve from 'rollup-plugin-node-resolve';

export default [
  {
    input: 'src/index.js',
    output: [
      {
        file: 'dist/ses.cjs.js',
        format: 'cjs',
        sourcemap: true,
      },
      {
        file: 'dist/ses.esm.js',
        format: 'esm',
        sourcemap: true,
      },
    ],
    external: ['@agoric/make-hardener'],
  },
  {
    input: 'src/index.js',
    output: [
      {
        file: 'dist/ses.umd.js',
        format: 'umd',
        name: 'lockdown',
        sourcemap: true,
      },
    ],
    plugins: [
      resolve({
        only: ['@agoric/make-hardener'],
      }),
    ],
  },
  {
    input: 'src/index.js',
    output: [
      {
        file: 'dist/ses.esm.min.js',
        format: 'esm',
        sourcemap: true,
      },
    ],
    external: ['@agoric/make-hardener'],
    plugins: [terser()],
  },
  {
    input: 'src/index.js',
    output: [
      {
        file: 'dist/ses.umd.min.js',
        format: 'umd',
        name: 'lockdown',
        sourcemap: true,
      },
    ],
    plugins: [
      terser(),
      resolve({
        only: ['@agoric/make-hardener'],
      }),
    ],
  },
];
