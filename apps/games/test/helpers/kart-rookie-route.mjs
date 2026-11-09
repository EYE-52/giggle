// Rounded turns are part of the route, not automatic recovery waypoints.
export function rookieCircuit(players){
 const x=players===2?18:26,top=5.5,bottom=players===2?4.5:6,points=[{x:-x,y:0,z:20},{x:-x,y:6,z:-4}];
 const arc=(cx,cz,r,a,b,y,n=8)=>{for(let i=1;i<=n;i++){const theta=a+(b-a)*i/n;points.push({x:cx+r*Math.cos(theta),y,z:cz+r*Math.sin(theta)});}};
 arc(-x+top,-4,top,Math.PI,1.5*Math.PI,6);points.push({x:0,y:6,z:-4-top},{x:x-top,y:6,z:-4-top});arc(x-top,-4,top,1.5*Math.PI,2*Math.PI,6);
 points.push({x,y:0,z:20});arc(x-bottom,20,bottom,0,Math.PI,0,16);
 const inner=x-bottom*2;points.push({x:inner,y:0,z:8},{x:-inner,y:0,z:8},{x:-inner,y:0,z:20});arc(-x+bottom,20,bottom,0,Math.PI,0,16);const start=points.findIndex(p=>p.x===0&&p.y===6);return [...points.slice(start),...points.slice(0,start+1)];
}
