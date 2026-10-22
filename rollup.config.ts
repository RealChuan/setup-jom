// See: https://rollupjs.org/introduction/

import commonjs from '@rollup/plugin-commonjs'
import nodeResolve from '@rollup/plugin-node-resolve'
import typescript from '@rollup/plugin-typescript'

// The `@actions/*` packages ship ES modules that still reference a top level
// `this` and import each other cyclically. Both are harmless at runtime, so
// those warnings are dropped while everything else is still reported.
const bundledPackageWarnings = ['THIS_IS_UNDEFINED', 'CIRCULAR_DEPENDENCY']

const config = {
  input: 'src/index.ts',
  output: {
    esModule: true,
    file: 'dist/index.js',
    format: 'es',
    sourcemap: true
  },
  plugins: [typescript(), nodeResolve({ preferBuiltins: true }), commonjs()],
  onwarn(warning, warn) {
    const ids = warning.ids ?? (warning.id ? [warning.id] : [])
    const fromDependency =
      ids.length > 0 && ids.every((id) => id.includes('node_modules'))

    if (bundledPackageWarnings.includes(warning.code) && fromDependency) return

    warn(warning)
  }
}

export default config
