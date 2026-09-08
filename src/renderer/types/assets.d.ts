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

/**
 * `import.meta.glob`, from `vite/client`. Same reason as above: `types` is
 * pinned in tsconfig, so the one shape used is declared rather than widening
 * it. Only the eager, raw form the handbook needs.
 */
interface ImportMeta {
  glob: (
    pattern: string,
    options: { query: string; import: string; eager: true },
  ) => Record<string, string>
}
