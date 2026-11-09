// Keep automatic test listeners inside the ports assigned to this task.
const net = require('node:net');
const {execFileSync} = require('node:child_process');
const listen = net.Server.prototype.listen;
const pending = new Set();
let next = 8404;
net.Server.prototype.listen = function (...args) {
  const options = args[0];
  if (options === 0 || (options && typeof options === 'object' && options.port === 0)) {
    let output = '';
    try { output = execFileSync('/usr/sbin/lsof', ['-nP', '-iTCP:8404-8410', '-sTCP:LISTEN', '-Fn'], {encoding:'utf8', stdio:['ignore','pipe','ignore']}); } catch (e) { if (e.status !== 1) throw e; }
    const busy = new Set([...output.matchAll(/:(\d+)(?:\n|$)/g)].map(m => Number(m[1])));
    const port = Array.from({length:7}, (_, i) => 8404+(next-8404+i)%7).find(p => !busy.has(p) && !pending.has(p));
    if (!port) throw new Error('All task test ports 8404-8410 are busy');
    // Rotate across restarts so HTTP clients cannot reuse a closing socket.
    next = 8404+(port-8404+1)%7;
    pending.add(port);
    const release = () => pending.delete(port);
    this.once('close', release); this.once('error', release);
    if (options === 0) args[0] = port; else args[0] = {...options, port};
  }
  return listen.apply(this, args);
};
