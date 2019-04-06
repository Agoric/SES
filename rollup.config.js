import resolve from 'rollup-plugin-node-resolve';

export default [
  {
    input: 'src/index.js',
    output: [
      {
        file: 'dist/ses.esm.js',
        format: 'esm',
      },
      {
        file: 'dist/ses.cjs.js',
        format: 'cjs',
      },
    ],
    external: ['@agoric/make-hardener', 'realms-shim'],
  },
  {
    input: 'src/index.js',
    output: {
      file: 'dist/ses.umd.js',
      format: 'umd',
      name: 'SES',
      globals: {
        'realms-shim': 'Realm',
      },
    },
    plugins: [
      resolve({
        only: ['@agoric/make-hardener'],
      }),
    ],
    external: ['realms-shim'],
  },
];
