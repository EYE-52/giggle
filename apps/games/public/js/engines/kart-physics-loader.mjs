// One init promise per document, shared by lobby/classic/elevated views.
// wasm-bindgen's own singleton guards completed init, not concurrent calls.
let loading;
export function loadKartPhysics(){
  if(!loading)loading=import('/vendor/rapier/rapier.mjs').then(async module=>{
    const R=module.default;await R.init();
    if(R.version()!=='0.21.0')throw Error('Unexpected kart physics runtime');
    return R;
  }).catch(error=>{loading=null;throw error;});
  return loading;
}
