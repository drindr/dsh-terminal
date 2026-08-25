/** CSS files are imported as raw text (tsdown `dsh-css-text` virtual module). */
declare module '*.css' {
  const css: string
  export default css
}
