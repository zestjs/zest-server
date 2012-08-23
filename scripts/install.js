var fs = require('fs'),
  volo = require('volo');

//load package.json
var p = eval('(' + fs.readFileSync('package.json', 'utf-8') + ')');

//check amd.baseUrl, if not set to www/lib
p.amd = p.amd || {};
p.amd.baseUrl = p.amd.baseUrl || 'www/lib';

//add require and zest to volo.dependencies
p.volo = p.volo || {};
p.volo.dependencies = p.volo.dependencies || {};
p.volo.dependencies.require = 'github:jrburke/requirejs/2.0.6';
p.volo.dependencies.zest = 'github:zestjs/zest/master';

//save package.json
fs.writeFileSync('package.json', JSON.stringify(p), 'utf-8');

//run volo add
volo(['add']);
