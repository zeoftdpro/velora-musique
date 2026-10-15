// hls.js ne publie pas de types dédiés pour son build « light » : même API que le build complet.
declare module 'hls.js/light' {
  export * from 'hls.js';
  export { default } from 'hls.js';
}
