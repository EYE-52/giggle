import {runLaunchGates} from './helpers/kart-launch-gates.mjs';
await runLaunchGates({id:'skyport-split',players:[8,16,24,32],colliderBudget:92,drawBudget:65,triangleBudget:43000,cuts:['helix-0','helix-1','east-street-climb','east-roof-climb']});
