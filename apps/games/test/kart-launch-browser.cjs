'use strict';
process.env.KART32_MAP??='Skyport Split';
process.env.KART32_PORT??='8356';
process.env.KART32_BROWSER??='/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
process.env.KART32_ANGLE??='metal';
process.env.KART32_WIDTH??='1280';process.env.KART32_HEIGHT??='720';process.env.KART32_SCALE??='1';process.env.KART32_CPU??='4';
process.env.KART32_OUT??=require('node:path').resolve(__dirname,'../../../artifacts/kart-arenas/skyport-32');
require('node:fs').mkdirSync(process.env.KART32_OUT,{recursive:true});
require('./kart-32-browser.cjs');
