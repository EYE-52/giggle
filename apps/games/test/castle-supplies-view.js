'use strict';
// Supply/unlock HUD was intentionally replaced by the finite block/weapon hand.
require('./block-siege-view').run().catch(e=>{console.error(e);process.exitCode=1;});
