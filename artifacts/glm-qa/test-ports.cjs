// Full-suite port aliases. Both sides of legacy connections use the same port.
const net=require('node:net');
const listen=net.Server.prototype.listen,connect=net.Socket.prototype.connect;
let next=8330;
const alias=p=>{const n=Number(p);return n>1024&&(n<8320||n>8340)?8321+n%9:p;};
net.Server.prototype.listen=function(...args){
 if(typeof args[0]==='number')args[0]=args[0]===0?next++:alias(args[0]);
 else if(args[0]&&typeof args[0]==='object'&&'port'in args[0])args[0]={...args[0],port:Number(args[0].port)===0?next++:alias(args[0].port)};
 if(next>8340)next=8330;
 return listen.apply(this,args);
};
net.Socket.prototype.connect=function(...args){
 if(Array.isArray(args[0])&&args[0][0]?.port)args[0][0].port=alias(args[0][0].port);
 else if(args[0]&&typeof args[0]==='object'&&'port'in args[0])args[0].port=alias(args[0].port);
 else if(typeof args[0]==='number')args[0]=alias(args[0]);
 return connect.apply(this,args);
};
