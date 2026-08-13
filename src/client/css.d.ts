/** CSS files are imported as raw text by esbuild (`loader: { '.css': 'text' }`). */
declare module '*.css' {
  const css: string
  export default css
}
