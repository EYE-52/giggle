'use strict';
// Keep auto-selected test listeners within this task's assigned spare range.
// Production networking is unchanged. Child processes inherit NODE_OPTIONS.
const net=require('node:net'),listen=net.Server.prototype.listen,base=Number(process.env.KART_TEST_PORT_BASE)||8358;if(base<8358||base>8370)throw new RangeError('Arena test port base must stay in 8358–8370');let next=base;
net.Server.prototype.listen=function(...args){
 if(args[0]===0)args[0]=next++;
 else if(args[0]&&typeof args[0]==='object'&&args[0].port===0)args[0]={...args[0],port:next++};
 if(next>8370)next=base;
 return listen.apply(this,args);
};
