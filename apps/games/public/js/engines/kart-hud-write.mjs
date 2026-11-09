// Snapshot and render clocks often repeat a value. Setting textContent still
// replaces text nodes, so compare before touching the live HUD.
export function setKartText(element, value) {
  const text=String(value);
  if(element.textContent!==text)element.textContent=text;
}
export function setKartAttribute(element, name, value) {
  const text=String(value);
  if(element.getAttribute(name)!==text)element.setAttribute(name,text);
}
export function setKartFlag(element, name, value) {
  const flag=Boolean(value);
  if(element[name]!==flag)element[name]=flag;
}
