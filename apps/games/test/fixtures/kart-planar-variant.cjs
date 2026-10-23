'use strict';
// Explicit no-motion variant for retained planar factory/rule unit fixtures.
// Pocket's initialized Rapier product is covered separately; these tests
// deliberately author x/z/speed to isolate generic sweep and economy rules.
module.exports=require('../../games/engines/kart-engine').createKartGame({
  id:'pocket-karts',name:'Pocket Karts',layout:'immersive',seats:8,
  players:{min:2,max:24},modes:['starrush','battle'],
  maps:['ring','blocks','garden','frost','neon'],garage:true,
  defaults:{roundSeconds:180,targetStars:15,targetHits:10,mode:'battle',map:'garden',palette:'Daybreak',winRule:'Time limit',lightCycle:'Live sunset',garage:false},
});
