/*
 * requireJS trace
 *
 * Given a configuration object, as would be passed to the optimizer,
 * runs a raw build trace on the configuration, returning the traced
 * dependency trees.
 *
 * Loaded as a requirejs module on the server.
 *
 * eg:
 * 
 * var requirejs = require('requirejs');
 * requirejs.configure({ context: 'server', baseUrl: '__dirname' });
 * requirejs(['trace'], function(trace) {
 *   trace(buildConfig, function(trees) {
 *     // where trees is the array of dependency trees from each of the modules.
 *   });
 * });
 * 
 */

define(function() {

  // the array of module dependency trees
  var trees;

  var traceModules = function(build, config, moduleCallback, completeCallback, errback, index) {
    if (index === undefined) {
      index = 0;
      trees = [];
    }

    // the dependency tree for the current module
    var curTree = trees[index] = {};

    var resourceLoad = requirejs.onResourceLoad || function(){};
    requirejs.onResourceLoad = function(context, map, depArray) {
      resourceLoad(context, map, depArray);
      // build up proper normalized moduleID dependency tree
      var curId = map.unnormalized ? (map.prefix + '!' + map.name) : map.id;
      if (map.prefix != 'require-coffee/cs' && map.prefix != 'cs') {
        var deps = [];
        for (var i = 0; i < depArray.length; i++) {
          if (depArray[i].unnormalized)
            deps.push(depArray[i].prefix + '!' + depArray[i].name);
          else
            deps.push(depArray[i].id);
        }
        curTree[curId] = deps;
      }
      else
        curTree[curId] = [map.name];
    }

    build.traceDependencies(config.modules[index], config).then(function(layer) {
      config.modules[index].layer = layer;

      requirejs.onResourceLoad = resourceLoad;

      if (moduleCallback)
        moduleCallback(config.modules[index], trees[index], index);
      //requirejs._buildReset();

      if (config.modules[++index])
        traceModules(build, config, moduleCallback, completeCallback, errback, index);
      else
        completeCallback(trees);
    }, errback).end();
  }

  return function(config, moduleCallback, completeCallback, errback) {
    requirejs.tools.useLib(function(req) {
      req(['build', 'requirePatch'], function(build, requirePatch) {
        requirePatch();
        
        // prepare the configuration for the trace dependencies function
        config.dir = config.appDir;
        config = build.createConfig(config);

        // add the configuration
        requirejs(config);

        // prepare the modules for tracing dependencies
        var buildContext = require.s.contexts._;
        for (var i = 0; i < config.modules.length; i++) {
          var module = config.modules[i];
          if (!module.name)
            continue;
          module._sourcePath = buildContext.nameToUrl(module.name);
        }

        // run the trace
        traceModules(build, config, moduleCallback, completeCallback, errback);
      });
    });
  }

});