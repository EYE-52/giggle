import {activeKartPower} from './kart-weapon-contract.mjs';
// Never grants inventory or damage. Predicts only contact feedback and box hiding.
export function createKartPickupPrediction({now=()=>performance.now(),onPredict=()=>{},onReject=()=>{}}={}){
 let claim=null,scope='',blocked=null;
 return {
  sync(instance,life){const key=instance+':'+life;if(key!==scope){scope=key;claim=null;blocked=null;}},
  update(kart,position,crates,enabled=true){
   if(!enabled||!kart||kart.alive===false||kart.respawn>0){if(claim)onReject();claim=null;return;}
   if(claim){let c;for(const box of crates||[])if(box.id===claim.id){c=box;break;}const expired=now()-claim.at>=850;
    if(kart.weapon||!c||c.available===false){claim=null;return;}
    if(expired){blocked=claim.id;claim=null;onReject();}return;
   }
   if(kart.weapon||kart.firing||activeKartPower(kart)||!position)return;
   let near=null;for(const c of crates||[]){const p=c.position||c;if(c.available===false)continue;
    const dx=position.x-p.x,dz=position.z-p.z,dy=position.y==null?0:position.y-(c.position?.y??c.groundY??position.y);
    if(dx*dx+dz*dz<2.4*2.4&&Math.abs(dy)<2.4){near=c;break;}}
   if(!near){blocked=null;return;}if(near.id===blocked)return;
   claim={id:near.id,at:now()};onPredict(near);
  },
  accept(id){if(claim&&(!id||id===claim.id)){claim=null;return true;}return false;},
  hidden(id){return claim?.id===id;},
  reset(){claim=null;blocked=null;},
 };
}
