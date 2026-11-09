'use strict';
// Keep auto-selected test listeners within this task's assigned spare range.
// Production networking is unchanged. Child processes inherit NODE_OPTIONS.
const net=require('node:net'),listen=net.Server.prototype.listen;let next=8358;
net.Server.prototype.listen=function(...args){
 if(args[0]===0)args[0]=next++;
 else if(args[0]&&typeof args[0]==='object'&&args[0].port===0)args[0]={...args[0],port:next++};
 if(next>8370)next=8358;
 return listen.apply(this,args);
};
