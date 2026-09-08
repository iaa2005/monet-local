/**
 * Asset imports. `vite/client` declares these, but this project pins
 * `types` in tsconfig for the test globals, which switches off the automatic
 * inclusion of every @types package — so the one shape actually used is
 * declared here rather than widening `types` and pulling in the rest.
 */
declare module '*.png' {
  const src: string
  export default src
}
