var fs = require('fs'),
  volo = require('volo');

process.chdir('../../');
basePath = __dirname + '/../../../';

//load package.json
var p = fs.existsSync(basePath + 'package.json') ? eval('(' + fs.readFileSync(basePath + 'package.json', 'utf-8') + ')') : {};

//check amd.baseUrl, if not set to www/lib
p.amd = p.amd || {};
p.amd.baseUrl = p.amd.baseUrl || 'www/lib';

//add require and zest to volo.dependencies
p.volo = p.volo || {};
p.volo.dependencies = p.volo.dependencies || {};
p.volo.dependencies.require = 'github:jrburke/requirejs/2.0.6';
p.volo.dependencies.zest = 'github:zestjs/zest/master';

//save package.json
fs.writeFileSync(basePath + 'package.json', JSON.stringify(p, function(key, value) { return value; }, 2), 'utf-8');

//run volo add
volo(['add']);
