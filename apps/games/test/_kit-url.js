'use strict';
/* Test loaders import game views as data: URLs. Views import the game kit
 * ('../kit.js'), which imports './util.js'; this builds the kit's data URL
 * against the loader's own util data URL. */
const fs = require('fs');
const path = require('path');
module.exports = function kitUrl(utilUrl) {
  const src = fs.readFileSync(path.join(__dirname, '../public/js/kit.js'), 'utf8').replace("'./util.js'", JSON.stringify(utilUrl));
  return 'data:text/javascript;base64,' + Buffer.from(src).toString('base64');
};
