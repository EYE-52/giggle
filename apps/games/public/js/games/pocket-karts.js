/* Pocket Karts view: thin declarative config on the shared kart-arena
 * view factory (public/js/engines/kart-view.js). No simulation, scene,
 * or HUD source lives here — the factory owns all of it; this file only
 * declares Pocket Karts' title. */
import { createKartView } from '../engines/kart-view.js';
import {createElevatedKartView} from '../engines/kart-elevated-view.js';

// A profile change owns a complete scene lifecycle, so elevated terrain
// never leaks into the planar compatibility renderer on a rematch.
let current,profile;
const view={ownsTimer:true,
  get styles(){return current?.styles||[];},
  get ownsInputs(){return current?.ownsInputs===true;},
  mount(){view.dispose();},
  update(el,state,platform){
    const elevated=state.profile==='elevated-combat-v1';
    const next=elevated?`elevated:${state.instanceId}:${state.mapId}:${state.mapRevision}`:'legacy';
    if(!current||next!==profile){current?.dispose();el.replaceChildren();profile=next;current=elevated?createElevatedKartView():createKartView({title:'Pocket Karts'});current.mount(el,platform);}
    current.update(el,state,platform);
  },
  ready(){return current?.ready?.();},
  dispose(){current?.dispose();current=null;profile=null;},
};
export default view;
