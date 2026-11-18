/** The app version from package.json, set at build time. */
declare const __APP_VERSION__: string;

/** Text files bundled as strings: the in-app guide is docs/features.md. */
declare module '*.md?raw' {
  const text: string;
  export default text;
}
