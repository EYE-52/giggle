/* Support and automatic preference are different on touch laptops.
 * Screen size never selects an input mode; keyboard is always available. */
export function readInputCapabilities({navigator:nav=globalThis.navigator,matchMedia=globalThis.matchMedia?.bind(globalThis)}={}) {
  const query=text=>{try{return matchMedia?.(text)?.matches===true;}catch{return false;}};
  const fine=query('(pointer: fine)'),coarse=query('(pointer: coarse)'),hover=query('(hover: hover)');
  const touch=(Number(nav?.maxTouchPoints)||0)>0||coarse||query('(any-pointer: coarse)');
  const preferTouch=coarse&&!hover;
  return {supported:{touch,keyboard:true},preferred:{touch:preferTouch,keyboard:!preferTouch},primary:{fine,coarse,hover}};
}
export function touchControlsFor(preference,capabilities) {
  return preference==='touch'||(preference!=='keyboard'&&capabilities.preferred.touch);
}
