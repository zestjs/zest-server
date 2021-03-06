/*
 * ZestJS Server
 * http://zestjs.org
 * 
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 * http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 *
 */

/*
 * Best method to start is to use the 'zest' executable provided
 * by a global install.
 *
 * It will still run a local zest server install if set at a specific
 * version
 *
 * Usage:
 *
 * zest
 *   Will look for config file at zest.json, in current folder
 * 
 * zest configName.json
 *   Will look for config file at given name, relative to current folder
 *
 */

/*
 * For use within NodeJS:
 *
 * zest.createServer(configFilePath || config, [completeFn]);
 *
 * Will handle everything.
 */
  
/*
 * Alternative usage for within connect / express other frameworks
 *
 * var server = connect();
 * zest.init(configPath | config, function() {
 *   server.use(zest.server);
 *   server.listen(8080);
 * });
 *
 */
var fs = require('fs'),
  nodeStatic = require('node-static'),
  requirejs = require('requirejs'),
  path = require('path'),
  http = require('http');
  
var zest = exports;


var getJSONConfigFile = function(file) {
  return eval('var c,require=function(o){return typeof o=="object"?c=o:c;},requirejs=require.config=require;(' +
    fs.readFileSync(file, 'utf-8') + ');');
}
var getCSONConfigFile = function(file) {
  return require('coffee-script').eval(fs.readFileSync(file, 'utf-8'));
}
var defaultConfig = getJSONConfigFile(path.resolve(__dirname, 'default-config.json'));

defaultConfig.require.server.map['*']['$render-service'] = 'require-coffee/cs!' + __dirname + '/render-service';
defaultConfig.require.server.map['*']['$html'] = 'require-coffee/cs!' + __dirname + '/html';
defaultConfig.require.server.map['*']['$trace'] = __dirname + '/trace.js';

var reqErr = function(err) {
  console.dir(JSON.stringify(zest.config));
  console.log('Error setting config when loading modules: ' + JSON.stringify(err.requireModules));
  throw err;
}

//gets hooked in once config has been loaded
var zoe, router, Page;

//trace css dependencies for modules to allow critical css inclusions
var cssDependencies = {};

zest.init = function(config, environment, complete) {
  console.log('Loading Configuration');

  if (arguments.length == 2) {
    complete = environment;
    environment = config;
    config = null;
  }
  
  if (typeof zest.config != 'object' || config != zest.config)
    zest.config = loadConfig(config, environment);
  
  console.log('Initializing RequireJS');
  zest.config.require.server.nodeRequire = require;
  zest.require = requirejs.config(zest.config.require.server);
  
  //set up css dependency tracking
  requirejs.onResourceLoad = function(context, map, depArray) {
    //coffee script -> dependency is name dependency
    var moduleId = map.prefix == 'require-coffee/cs' ? map.name : map.id;
    //check each dependency for css! calls or dependencies which have css! dependencies themselves
    if (!depArray)
      return;
    for (var i = 0; i < depArray.length; i++) {
      var depId = depArray[i].prefix == 'require-coffee/cs' ? depArray[i].name : depArray[i].id;
      //dependency that might have sub-css dependencies
      if (cssDependencies[depId]) {
        cssDependencies[moduleId] = cssDependencies[moduleId] || [];
        if (cssDependencies[moduleId].indexOf(cssDependencies[depId]) == -1)
          cssDependencies[moduleId] = (cssDependencies[moduleId] || []).concat(cssDependencies[depId]);
      }
      //css dependency
      if (depArray[i].prefix == 'require-css/css') {
        cssDependencies[moduleId] = cssDependencies[moduleId] || [];
        if (cssDependencies[moduleId].indexOf('css!' + depArray[i].name) == -1)
          cssDependencies[moduleId].push('css!' + depArray[i].name);
      }
      else if (depArray[i].prefix == 'require-less/less') {
        cssDependencies[moduleId] = cssDependencies[moduleId] || [];
        if (cssDependencies[moduleId].indexOf('less!' + depArray[i].name) == -1)
          cssDependencies[moduleId].push('less!' + depArray[i].name);
      }
    }
  }

  // auto-define 'browserModules'
  if (zest.config.browserModules)
    for (var i = 0; i < zest.config.browserModules.length; i++)
      requirejs.define(zest.config.browserModules[i], function(){});

  
  //requirejs
  console.log('Loading RequireJS dependencies');
  zest.require(['zoe', 'zest/router', '$html', '$trace'], function(_zoe, _router, _html, trace) {
    zest.baseUrl = zest.require.toUrl('.');
    zoe = _zoe;
    router = _router;
    Page = _html;
    
    //the step function for creating the server. executed immediately after creating.
    var makeServer = zoe.fn(zoe.fn.ASYNC);
  
    //create server handler
    makeServer.on(function(next) {
      zest.server = zoe.fn(zoe.fn.ASYNC);
      zest.handlers = zoe.fn(zoe.fn.ASYNC);
      zest.routes = {};
      
      next();
    });
    
    //load modules
    zest.modules = [];
    makeServer.on(function(next) {
      if (zest.config.modules.length == 0)
        zest.config.modules.push('$render-service');
      
      loadModules(zest.config.modules, next);
    });
    
    //build the app if necessary -> restarts load again (includes core build again)
    makeServer.on(function(next) {
      if (!zest.config.build)
        return next();
        
      console.log('Building whole project');
      
      zest.config.require.build.appDir = path.resolve(zest.config.appDir, zest.config.publicDir);
      zest.config.require.build.dir = path.resolve(zest.config.appDir, zest.config.publicBuildDir);
      zest.config.require.build.baseUrl = zest.config.baseDir;
      
      //add core build layer as first module
      //delete it first if there is one
      var buildLayerPath = path.resolve(zest.config.appDir, zest.config.publicBuildDir, zest.config.baseDir, 'zest/layer.js');
      if (fs.existsSync(buildLayerPath))
        fs.unlinkSync(buildLayerPath);
        
      var zestExcludes = zest.config.require.build.zestExcludes;
      var zestLayer = zest.config.require.build.zestLayer;

      // add coffeescript excludes
      if (fs.existsSync(path.resolve(zest.config.appDir, zest.config.publicDir, zest.config.baseDir, 'coffee-script.js'))) {
        zestExcludes.include.push('coffee-script');
        zestExcludes.include.push('cs');
        zestLayer.exclude.push('coffee-script');
      }

      // add require-less excludes
      if (fs.existsSync(path.resolve(zest.config.appDir, zest.config.publicDir, zest.config.baseDir, 'require-less/less.js'))) {
        zestExcludes.include.push('require-less/less');
        zestExcludes.include.push('require-less/lessc');
        zestLayer.excludeShallow.push('require-less/lessc');
        zestLayer.excludeShallow.push('require-less/lessc-server');
      }

      zest.config.require.build.modules.unshift({
        name: 'zest/excludes',
        create: true,
        include: zestExcludes.include,
        exclude: zestExcludes.exclude,
        excludeShallow: zestExcludes.excludeShallow
      });
      zest.config.require.build.modules.unshift({
        name: 'zest/layer',
        create: true,
        include: zestLayer.include,
        exclude: zestLayer.exclude,
        excludeShallow: zestLayer.excludeShallow,
        separateCSS: zestLayer.separateCSS
      });
      
      var _onResourceLoad = requirejs.onResourceLoad;

      
      var modules = zest.config.require.build.modules;

      // attach resource ids are css and attachment modules
      // these are reported by zest/com-build.js during the trace
      var attachResourceIds = [];
      requirejs.onZestAttachResource = function(attachId) {
        attachResourceIds.push(attachId);
      }

      var attachBuildIds = [];
      
      // remove the '^!' builds from the current module
      var setAttachBuildIds = function(module) {
        for (var i = 0; i < module.include.length; i++) {
          var curInclude = module.include[i];
          if (curInclude.substr(0, 2) == '^!') {
            module.include[i] = curInclude.substr(2);
            attachBuildIds.push(curInclude.substr(2));
          }
        }
      }

      setAttachBuildIds(modules[0]);

      var buildClone = zoe.extend({}, zest.config.require.build, 'DREPLACE');

      trace(buildClone, function(_module, tree, index) {
        var module = modules[index];

        // update the module includes list to remove the attachBuildIds
        for (var i = 0; i < module.include.length; i++) {
          var curInclude = module.include[i];
          if (attachBuildIds.indexOf(curInclude) != -1) {
            module.include.splice(i--, 1);
            continue;
          }
        }

        // add the attachResourceIds to the include list
        module.include = module.include.concat(attachResourceIds);

        // prepare to track the next module
        if (modules[index + 1]) {
          attachResourceIds = [];
          attachBuildIds = [];
          setAttachBuildIds(modules[index + 1]);
        }

      }, function() {

        requirejs.optimize(zest.config.require.build, function(buildResponse) {

          console.log(buildResponse);
          requirejs.onResourceLoad = _onResourceLoad;
                    
          //clean up after build, by restarting entire init
          zest.config.build = false;
          delete requirejs.s.contexts[zest.config.require.server.context || '_'];
          zest.init(zest.config, environment, complete);

        }, function(err) {
          throw err;
        });

      });
    });

    // analyse build for layers and run
    makeServer.on(function(next) {
      
      if (!zest.config.production)
        return next();

      var modules = zest.config.require.build.modules;

      zest.builtLayers = {};
      
      var defineRegEx = /define\(("([^"\\]*(\\.[^"\\]*)*)"|\'([^\'\\]*(\\.[^\'\\]*)*)\'),/g;

      // store the layer map for layer loading
      for (var i = 0; i < modules.length; i++) {
        var moduleName = modules[i].name;
        var modulePath = path.resolve(zest.config.appDir, zest.config.publicBuildDir, zest.config.baseDir, modules[i].name + '.js');
        if (fs.existsSync(modulePath)) {
          //load the module file as text
          var matches = (fs.readFileSync(modulePath) + '').match(defineRegEx);
          for (var j = 0; j < matches.length; j++)
            matches[j] = matches[j].substr(8, matches[j].length - 10);

          // NB EXCLUDE plugins from layer maps, because currently not supported in requireJS!
          for (var j = 0; j < matches.length; j++)
            if (matches[j].indexOf('!') != -1)
              matches.splice(j--, 1);

          zest.builtLayers[moduleName] = matches;
        }
      }

      next();

    });
    
    // create server
    makeServer.on(function(next) {
      console.log('Creating server');
      
      //initial handler
      zest.server.on(function(req, res, next) {
        
        //check the 'accept' header if given, to ensure we are rendering html
        //if not, skip routing check
        if (req.headers.accept)
          if (!req.headers.accept.match(/(text\/html)|(\*\/\*)/))
            return next();

        // if not a GET request, also skip standard routing
        if (req.method != 'GET')
          return next();

        /*
         * check the url for any routes -> populates route data onto req:
         *
         * route.redirect (if doing a redirect)
         * route.route (the route object)
         * route.options (the route component options)
         * 
         */
        var r = router.route(req.url);

        //redirect
        if (r.redirect) {
          req.redirect = r.redirect;
          return next();
        }

        //null route -> skip
        if (r.route == null)
          return next();
        
        // set the page options
        req.pageOptions = r.options;

        //lookup the module responsible for the page route
        for (var i = 0; i < zest.modules.length; i++) {
          if (zest.modules[i].instance.routes[req.pageOptions._route]) {
            req.pageOptions.module = zest.modules[i].instance;
            break;
          }
        }
        
        // create a new page render component
        createPage(r.route, req.pageOptions.module.page, function(com) {
          req.pageComponent = com;
          next();
        });
      });
      
      //run the handlers - can alter the routing
      zest.server.on(zest.handlers);
      
      //finally, follow the routing
      zest.server.on(function(req, res, next) {
        if (res.sent)
          return;
        
        if (req.redirect) {
          res.writeHead(301, {
            'Location': req.redirect
          });
          res.end();
          return;
        }
        
        if (!req.pageOptions)
          return next();
        
        // render the page
        zest.render(req.pageComponent, req.pageOptions, res);
      });
      
      //fall through is the file server (if enabled)
      zest.server.on(serveFiles);
      
      //final fall through is the zest 404, this should never be reached really
      zest.server.on(function(req, res, next) {
        if (!zest.config['404'])
          return next();
        //for some reason, a session interferes with 404 headers
        if (req.session)
          delete req.session;

        res.writeHead(404, {
          'Content-Type': 'text/html'
        });

        createPage(zest.config['404'], function(structure) {
          zest.render.renderItem(structure, {
            _url: req.url,
            global: {
              _nextComponentId: 1,
              _ids: []
            }
          }, function(chunk) {
            res.write(chunk);
          }, function() {
            res.end();
          });
        });
      });
      
      next();
    });
    
    makeServer(complete);
  }, reqErr);
}

/*
 * createPage
 *
 * Given a partial page Render Component, populates the remaining
 * defaults for rendering.
 */
var createPage = function(pageComponent, pageBase, complete) {
  if (arguments.length == 2) {
    complete = pageBase;
    pageBase = undefined;
  }
  if (typeof pageComponent == 'string') {
    zest.require([pageComponent], function(pageComponent) {
      createPage(pageComponent, pageBase, complete);
    });
    return;
  }

  // create a fresh page structure, inheriting from the page base
  pageComponent = zoe.create([Page, {
    requireConfig: zest.config.require.client,
    requireUrl: '/' + zest.config.baseDir + (zest.builtLayers ? '/zest/layer.js' : '/require.js')
  }].concat(pageBase ? [pageBase, pageComponent] : [pageComponent]));
  
  //process page layers to include the paths config
  if (zest.builtLayers) {
    pageComponent.layers = pageComponent.layers || [];
    pageComponent.layers.unshift('zest/layer');
    for (var i = 0; i < pageComponent.layers.length; i++) {
      var layerName = pageComponent.layers[i];
      var layer = zest.builtLayers[layerName];
      if (!layer) {
        console.log(zest.builtLayers);
        console.log('Build layer ' + layerName + ' not found for page inclusion.');
        continue;
      }
      for (var j = 0; j < layer.length; j++)
        pageComponent.requireConfig.paths[layer[j]] = layerName;
    }

    // if separate CSS, include as link tag
    if (zest.config.require.build.zestLayer.separateCSS) {
      pageComponent.head = pageComponent.head || [];
      pageComponent.head.push('<link rel="stylesheet" href="/' + zest.config.baseDir + '/zest/layer.css"></link>');
    }
  }
  complete(pageComponent);
}

/*
 * loadModule
 *
 * Loads a zest server module.
 *
 * Module Spec::
 *
 * From configuration environment:
 * modules: {
 *   'moduleId (in requirejs)': {
 *     //...configuration object.. (can also be a string for a file to find it at, or 'true' for no config)
 *   }
 * }
 *
 * The module itself can have the following:
 *
 * 1) it can be a function of configuration (optionally)
 *
 * 2) routes. object. defines routes for this module, as path -> route pairs.
 *    routes can be structure objects, structure reference strings, or path aliases for aliasing
 *
 * 3) handler function. function(req, res, next) as is normal in nodejs
 *
 * 4) zestConfig object. allows for adding configuration to the global config.
 *    also allows for adding sub-modules as dependencies.
 *
 *    modules: {
 *      'moduleId': true
 *      'moduleId': {}
 *      'moduleId': 'configId'
 *    }
 *
 * 5) Sub modules are added based on their config. So far as configurations are unique, modules
 *    are added multiple times.
 *    In this way, modules are seen as 'generators' over straightforwad routes
 *    Straightforward routing is still provided by the 'true' option.
 *
 */

var loadModule = function(moduleId, complete) {
  //loads a zest server module
  var doLoad = zoe.fn('ASYNC');
  
  //load module
  var module;
  doLoad.on(function(next) {
    console.log('Loading module: ' + moduleId);
    zest.require([moduleId], function(_module) {
      module = _module;
      next();
    });
  });
  
  //instantiate module
  var instance;
  doLoad.on(function(next) {
    //check if this config / module combination already exists
    for (var i = 0; i < zest.modules.length; i++) {
      if (zest.modules[i].moduleId != moduleId)
        continue;
      //same module - ignore inclusion
      return next();
    }
    
    //instantiate
    if (typeof module == 'function')
      instance = module(zest.config);
    else
      instance = module;
    
    //add routes and handlers
    if (instance.routes)
      router.addRoutes(instance.routes);

    if (instance.handler || instance.pageOptions)
      zest.handlers.on(function(req, res, next) {
        if (!req.pageOptions)
          return next();
        if (req.pageOptions.module != instance)
          return next();
        
        if (instance.handler)
          instance.handler.call(instance, req, res, next);

        if (instance.pageOptions) {
          $z.extend(req.pageOptions, instance.pageOptions, 'DAPPEND');
          next();
        }
      });

    if (instance.globalHandler)
      zest.handlers.on(function(req, res, next) {
        instance.globalHandler.apply(instance, arguments);
      });
    
    //store module instance info
    zest.modules.push({
      moduleId: moduleId,
      instance: instance
    });
    
    next();
  });
  
  //include module-defined zest config
  doLoad.on(function(next) {
    //if no module instance or config, ignore
    if (!instance || !instance.zestConfig)
      return next();
    
    var moduleConfig = instance.zestConfig;
    
    //compute environment config as outModuleConfig
    var outModuleConfig = moduleConfig;
    if (moduleConfig.environments) {
      outModuleConfig = moduleConfig.environments[zest.config.environment] || {};
      delete moduleConfig.environments;
      zoe.extend(outModuleConfig, moduleConfig, 'DPREPEND');
    }
    
    //save environment config back for reference
    instance.zestConfig = outModuleConfig;
    
    //add module config to main zest config
    zoe.extend(zest.config, outModuleConfig, {'*': 'DAPPEND', 'require': 'IGNORE'});
    
    //compute require config with defaults, then add into main zest config
    if (outModuleConfig.require) {
      var _extendRules = {'*': 'DPREPEND', 'client': 'IGNORE', 'server': 'IGNORE', 'build': 'IGNORE'};
      
      zoe.extend(zest.config.require.client, outModuleConfig.require, _extendRules);
      zoe.extend(zest.config.require.server, outModuleConfig.require, _extendRules);
      zoe.extend(zest.config.require.build, outModuleConfig.require, _extendRules);
      
      zoe.extend(zest.config.require.client, outModuleConfig.require.client || {}, 'DPREPEND');
      zoe.extend(zest.config.require.server, outModuleConfig.require.server || {}, 'DPREPEND');
      zoe.extend(zest.config.require.build, outModuleConfig.require.build || {}, 'DPREPEND');
      
      //update server require
      zest.require = requirejs.config(zest.config.require.server);
    }
    
    //check for any sub-modules and load them
    if (outModuleConfig.modules)
      loadModules(outModuleConfig.modules, next);
    else
      next();
  });
  
  doLoad(complete);
}

var loadModules = function(modules, complete) {
  var loadCnt = modules.length;
  
  for (var i = 0; i < modules.length; i++)
    loadModule(modules[i], function() {
      loadCnt--;
      if (loadCnt == 0)
        complete();
    });
}

zest.startServer = function(port) {
  if (!setConfig)
    throw 'Configuration hasn\'t been set to start server';

  var server = http.createServer(zest.server);
 
  port = port || zest.config.port || 8080;
  if (!zest.config.hostname)
    server.listen(port);
  else
    server.listen(port, zest.config.hostname);
  
  console.log('Listening on port ' + port + (zest.config.hostname ? ', hostname ' + zest.config.hostname : '')  + '...');
}

/* zest.clearRequires = function() {
  delete requirejs.s.contexts[zest.config.server.context];
  cssDependencies = {};
  
  zest.require = requirejs.config(zest.config.server);
} */

var windows = process.platform == 'win32';
var setConfig = false;
//config is simply taken for the dirname where zest.json can be found
var loadConfig = function(config, environment) {
  //load configuration
  if (config == null)
    config = process.cwd() + (windows ? '\\' : '/');
    
  if (typeof config == 'string') {
    var isDir = (!windows && config.substr(config.length - 1, 1) == '/') || (windows && config.substr(config.length - 1, 1) == '\\');
    //config file path is taken to be app directory
    defaultConfig.appDir = isDir ? path.resolve(config) : path.dirname(path.resolve(config));
    defaultConfig.require.server.paths['$'] = defaultConfig.appDir;
    
    //load cson if necessary
    if (isDir && fs.existsSync(path.resolve(config, 'zest.cson')) || config.substr(config.length - 4, 4) == 'cson')
      return loadConfig(getCSONConfigFile(isDir ? path.resolve(config, 'zest.cson') : path.resolve(config)), environment);
    //otherwise load config as a json file
    else
      return loadConfig(getJSONConfigFile(isDir ? path.resolve(config, 'zest.json') : path.resolve(config)), environment);
  }
  
  if (setConfig)
    throw 'Configuration has already been set. Start a new server instance for alternative configuration.';
  setConfig = true;
  
  
  function deepPrepend(a, b) {
    for (var p in b) {
      if (b[p] instanceof Array) {
        a[p] = a[p] || [];
        a[p] = b[p].concat(a[p]);
      }
      else if (typeof b[p] == 'object' && b[p] !== null && a[p] !== null) {
        a[p] = a[p] || {};
        deepPrepend(a[p], b[p]);
      }
      else if (a[p] === undefined)
        a[p] = b[p];
    }
  }
  
  deepPrepend(config, defaultConfig);
  
  //provide default configurations, starting with the environment mode config
  var outConfig = config.environments[environment || config.environment];
  
  if (typeof outConfig == 'undefined')
    throw 'No configuration provided for environment "' + environment + '".';
  
  delete config.environments;
  
  deepPrepend(outConfig, config);
  
  //derive client, build, server and production require configs
  var requireConfig = {
    server: outConfig.require.server,
    client: outConfig.require.client,
    build: outConfig.require.build
  };
  delete outConfig.require.server;
  delete outConfig.require.client;
  delete outConfig.require.build;
  
  deepPrepend(requireConfig.server, outConfig.require);
  deepPrepend(requireConfig.client, outConfig.require);
  deepPrepend(requireConfig.build, outConfig.require);
  
  outConfig.require = requireConfig;
  
  //set directories - cant override
  outConfig.require.server.baseUrl = path.resolve(outConfig.appDir, outConfig.publicDir, outConfig.baseDir);
  outConfig.require.client.baseUrl = '/' + outConfig.baseDir;

  // type attribute
  if (outConfig.typeAttribute && outConfig.typeAttribute != 'component') {
    var clientConfig = (outConfig.require.client.config = outConfig.require.client.config || {});
    clientConfig['zest/render'] = clientConfig['zest/render'] || {};
    clientConfig['zest/render'].typeAttribute = outConfig.typeAttribute;
  }
  
  return outConfig;
}

var fileServer = null;
var serveFiles = function(req, res, next) {
  if (zest.config.serveFiles) {
    fileServer = fileServer || new nodeStatic.Server(path.resolve(zest.config.appDir, (zest.config.build || zest.builtLayers) ? zest.config.publicBuildDir : zest.config.publicDir), {
      cache: zest.config.fileExpires
    });
    setTimeout(function() {
      fileServer.serve(req, res).addListener('error', function (err) {
        next();
      });
    }, zest.config.staticLatency);
  }
  else
    next();
}


zest.build = function(complete) {
  console.log('Running build');
  zest.config.require.build.modules = zest.config.require.build.modules || [];
  
  zest.config.require.build.appDir = path.resolve(zest.config.appDir, zest.config.publicDir);
  zest.config.require.build.dir = path.resolve(zest.config.appDir, zest.config.publicBuildDir);
  zest.config.require.build.baseUrl = zest.config.baseDir;
  
  requirejs.optimize(zest.config.require.build, function(buildResponse) {
    console.log(buildResponse);
    complete();
  });
}


/*
 * zest.render
 *
 * zest.render(structure, options, response, complete)
 *
 * streams the response.
 *
 * NB need to add a tabDepth
 *
 */
zest.render = function(structure, options, res, complete) {
  if (arguments.length == 2) {
    res = options;
    options = undefined;
  }
  if (arguments.length == 3 && typeof res == 'function') {
    complete = res;
    res = options;
    options = undefined;
  }

  res.writeHead(200, {
    'Content-Type': 'text/html'
  });

  zest.render.renderItem(structure, zoe.extend(options || {}, {
    global: {
      _nextComponentId: 1,
      _ids: []
    }
  }, 'DAPPEND'), function(chunk) {
    res.write(chunk);
  }, function() {
    res.end();
    if (complete)
      complete();
  });
}

/*
zest.renderHTML = function(structure, options, complete) {
  if (typeof options == 'function') {
    complete = options;
    options = undefined;
  }
  var html = [];
  var res = {
    writeHead: function(){},
    write: function(chunk) {
      html.push(chunk)
    },
    end: function(chunk){
      if (chunk)
        html.push(chunk);
    }
  }
  zest.render(structure, options, res, function() {
    complete(html.join(''));
  });
}
*/

zest.renderPage = function(structure, options, res, complete) {
  if (arguments.length == 2) {
    res = options;
    options = undefined;
  }
  if (arguments.length == 3 && typeof res == 'function') {
    complete = res;
    res = options;
    options = undefined;
  }
  createPage(structure, function(structure) {
    zest.render(structure, options, res, complete);
  });
}

zest.render.renderArray = function(structure, options, write, complete) {
  
  var curRender = 0;
  var completed = {};
  var buffer = {};
  
  var len = structure.length;
  
  if (len == 0)
    complete();
  
  var self = this;
  for (var i = 0; i < len; i++) (
    function initiate(i) {
      buffer[i] = '';
      self.renderItem(structure[i], { global: options.global }, function(chunk) {
        //write to live or buffer
        if (curRender == i)
          write(chunk)
        else
          buffer[i] += chunk;
          
      }, function() {
        completed[i] = true;
        if (curRender == i) {
          //write as much as we can
          while (completed[curRender] && curRender != len) {
            write(buffer[curRender] || '');
            curRender++;
          }
          //we either reach the end or the next bottleneck
          if (curRender == len) {
            complete();
          }
          //write the bottleneck. it is now writing to live so don't need buffer
          else {
            write(buffer[curRender] || '');
            delete buffer[curRender];            
          }
        }
      });
    }
  )(i);
}

// identical to client code (the only part!)
zest.render.renderItem = function(structure, options, write, complete) {
  if (complete === undefined) {
    complete = write;
    write = options;
    options = null;
  }
  complete = complete || function() {}
  
  if (typeof structure == 'undefined' || structure == null)
    return complete();
  
  options = options || {};
  options.global = options.global || {};
  
  var self = this;
  
  if (typeof structure == 'undefined' || structure === null)
    return complete();
  
  // string templates
  else if (typeof structure == 'string')
    if (structure.substr(0, 1) == '@')
      zest.require([structure.substr(1)], function(structure) {
        self.renderItem(structure, options, write, complete);
      });
    else
      self.renderTemplate(structure, null, options, write, complete);
  
  // dynamic template or structure function
  else if (typeof structure == 'function' && !structure.render) {
    // run structure function
    if (structure.length == 2)
      structure(options, function(structure) {
        self.renderItem(structure, { global: options.global }, write, complete);
      });
    else {
      structure = structure(options);
      
      // check if it is a template or not
      if (typeof structure == 'string')
        self.renderTemplate(structure, null, options, write, complete);
      else
      // otherwise just render
        self.renderItem(structure, { global: options.global }, write, complete);
    }
  }

  // structure array
  else if (structure instanceof Array)
    self.renderArray(structure, { global: options.global }, write, complete);
  
  // render component
  else if (structure.render)
    self.renderComponent(structure, options, write, complete);
  
  // empty render component
  else if ('render' in structure)
    return complete();
  
  else {
    console.log(structure);
    throw 'Unrecognised structure item for render.';
  }
}

var getCSSDependencies = function(component) {
  var cssIds = [];
  var moduleId;
  
  if ((moduleId = zest.getModuleId(component))) {
    if (moduleId.substr(0, 18) == 'require-coffee/cs!')
      moduleId = moduleId.substr(18);

    if (moduleId.substr(0, 3) == 'cs!')
      moduleId = moduleId.substr(3);

    //have a moduleId, see if we are dependent on any css
    cssIds = cssIds.concat(cssDependencies[moduleId] || []);
  }
    
  //also add in the css for any inheritors
  if (component._definition && component._definition._implement)
    for (var i = 0; i < component._definition._implement.length; i++)
      cssIds = cssIds.concat(getCSSDependencies(component._definition._implement[i]));
  
  return cssIds
}

var requireInlineUrl = function() {
  return '/' + zest.config.baseDir + (zest.builtLayers ? '/zest/layer.js' : '/require-inline.js');
}

var attachUrl = function() {
  return '/' + zest.config.baseDir + (zest.builtLayers ? '/zest/layer.js' : '/zest/attach.js');
}

/*
 * Dotted get property function.
 *
 * eg 'my.property' from { my: { property: 'hello' } } returns 'hello'
 */
var getProperty = function(name, obj) {
  var parts = name.split('.');
  if (parts.length > 1) {
    var curProperty = parts.shift();
    return obj[curProperty] ? getProperty(parts.join('.'), obj[curProperty]) : undefined;
  }
  else
    return obj[name];
}

zest.render.renderTemplate = function(template, component, options, write, complete, noDelay) {
  if (zest.config.renderDelay && !noDelay) {
    var self = this;
    return setTimeout(function() {
      self.renderTemplate(template, component, options, write, complete, true);
    }, zest.config.renderDelay);
  }

  template = template.trim();
  
  if (component && !zoe.inherits(component, Page)) {
    var cssIds = getCSSDependencies(component);

    var pageCSSIds = options.global.pageCSSIds = options.global.pageCSSIds || [];
    //filter the cssIds to unique
    for (var i = 0; i < cssIds.length; i++) {
      if (pageCSSIds.indexOf(cssIds[i]) != -1)
        cssIds.splice(i, 1);
      else
        pageCSSIds.push(cssIds[i]);
    }
    
    // ensure the styles are synchronously loaded
    if (cssIds && cssIds.length) {
      var cssList = '';
      for (var i = 0; i < cssIds.length; i++)
        cssList += cssIds[i].replace('"', '\\"') + ',';
      cssList = cssList.substr(0, cssList.length - 1);
        
      write("<script src='" + requireInlineUrl() + "' data-require='" + cssList + "'></script> \n");
    }
  }
    
  //break up the regions into a render array
  var regions = template.match(/\{\`[\w\.]+\`\}|\{\[[\w\.]+\]\}/g);
  
  if (regions) {
    // dont share type and id (already on render array)
    var renderArray = [template];
    for (var i = 0; i < regions.length; i++)
      for (var j = 0; j < renderArray.length; j++) {
        if (typeof renderArray[j] == 'string' && renderArray[j].indexOf(regions[i]) != -1) {
          var split = renderArray[j].split(regions[i]);
          renderArray[j] = split[0];
          var regionName = regions[i].substr(2, regions[i].length - 4);
          renderArray.splice(j + 1, 0, split[1]);
          
          // options won't have id because it is deleted 
          var regionStructure = (component && getProperty(regionName, component)) || getProperty(regionName, options)

          renderArray.splice(j + 1, 0, {
            render: regionStructure,
            options: (regionStructure && regionStructure.render) ? zoe.extend({}, options) : options
          });
        }
      }
    //render
    this.renderArray(renderArray, { global: options.global }, write, complete);
  }
  else {
    write(template);
    complete();
  }
}
  

var modules;  
zest.getModuleId = function(module, definitionMatching) {
  modules = modules || requirejs.s.contexts[zest.config.require.server.context].defined;

  var moduleId;
  if (module == null)
    return moduleId;
  for (var curId in modules) {
    if (curId.substr(0, 9) == 'zest/com!')
      continue;
    if (modules[curId] == module)
      moduleId = curId;
    else if (definitionMatching !== false && modules[curId] && module._definition == modules[curId])
      moduleId = curId;
  }
  return moduleId;
}
zest.render.renderComponent = function(component, options, write, complete) {
  
  // populate default options
  if (component.options)
    for (var option in component.options) {
      // id cannot be a default option (to set, populate html)
      if (option == 'id') continue;
      if (options[option] === undefined)
        options[option] = component.options[option];
    }
  
  var self = this;
  
  var render = function() {
    
    // attach vars:
    // piped options - calculated after labelling
    var _options;
    
    var _id = options.id;
    var _class = (component.className || '') + (options.className && component.className ? ' ' + options.className : options.className || '');

    if (!_id && (component.attach || component.style)) {
      _id = _id || ('z' + options.global._nextComponentId++);
      if (options.global._ids.indexOf(_id) != -1)
        throw 'Id: ' + _id + ' has already got an attachment.';
      
      options.global._ids.push(_id);
      options.id = _id;
    }

    if (component.style)
      write('<style data-zid="' + _id + '">\n' + (typeof component.style == 'function' ? component.style(options) : component.style) + '\n</style>')
    
    
    delete options.id;
    delete options.className;
    var labelComponent = !!(_id || _class);

    if (labelComponent);
      var _write = function(chunk) {
        if (labelComponent && chunk && chunk.match(/^\s*<(?!script)\w+/)) {
          labelComponent = false;

          var classMatch = chunk.match(/^[^>]*class=['"]?([^'"\s]+)/);
          // update existing class in component definition
          if (classMatch)
            chunk = chunk.substr(0, classMatch[0].length - classMatch[1].length) + (classMatch[1] || '') + (classMatch[1] && _class ? ' ' : '') + (_class || '') + chunk.substr(classMatch[0].length);
          
          //clear space at the beginning of the html to avoid unnecessary text nodes
          chunk = chunk.replace(/^\s*/, '');
          var firstTag = chunk.match(/<\w+/);
                  
          // add id and type attributes as necessary
          var attributes = '';
          if (_id)
            attributes += ' id="' + _id + '"';
          
          if (component.attach)
            attributes += ' component';

          if (!classMatch && _class)
            attributes += ' class="' + _class + '"';
          
          chunk = chunk.substr(0, firstTag[0].length) + attributes + chunk.substr(firstTag[0].length);
          
          // Run pipe immediately after labelling
          options.global._piped = options.global._piped || {};

          if (component.pipe === true)
            component.pipe = function(o) { return o }

          if (component.pipe instanceof Array) {
            var p = component.pipe;
            var _o = {};
            component.pipe = function(o) {
              for (var i = 0; i < p.length; i++)
                _o[p[i]] = o[p[i]];
            }
          }
          
          _options = component.pipe ? component.pipe(options) || {} : null;
          
          //only pipe global if a global pipe has been specially specified
          //piping the entire options global is lazy and ignored
          if (_options) {
            if (_options.global == options.global)
              delete _options.global;
            else {
              //check if we've already piped a global, and if so, don't repipe
              for (var p in _options.global)
                if (options.global._piped[p])
                  delete _options.global[p];
                else
                  options.global._piped[p] = true;
            }
          }
        }
        write(chunk);
      }
    
    var renderAttach = function() {
      if (labelComponent)
        throw 'No tags created for renderable. Need an HTML element for attachment to work!';
      
      if (!component.attach)
        return complete();
      
      zest.render.renderAttach(component, _options, _id, write, complete);
    }

    var renderFunctional = function(structure) {
      if (typeof structure == 'string' && structure.substr(0, 1) == '@') {
        zest.require([structure.substr(1)], renderFunctional);
        return;
      }
      // functional
      if (typeof structure == 'function' && !structure.render && structure.length == 1) {
        structure = structure.call(component, options);
        if (typeof structure == 'string')
          self.renderTemplate(structure, component, options, labelComponent ? _write : write, renderAttach);
        else if (component.attach) {
          // dynamic compound component -> simple template shorthand
          component.main = structure;
          self.renderTemplate('<div>{[main]}</div>', component, options, labelComponent ? _write : write, renderAttach);
        }
        else
          self.renderItem(structure, { global: options.global }, labelComponent ? _write : write, renderAttach);
      }
      else if (typeof structure == 'string')
        self.renderTemplate(structure, component, options, labelComponent ? _write : write, renderAttach);
      else if (component.attach) {
        // dynamic compound component -> simple template shorthand
        component.main = structure;
        self.renderTemplate('<div>{[main]}</div>', component, options, labelComponent ? _write : write, renderAttach);
      }
      else
        self.renderItem(structure, options, labelComponent ? _write : write, renderAttach);
    }
    
    renderFunctional(component.render);
  }
  
  if (component.load) {
    if (component.load.length == 1) {
      component.load(options);
      render();
    }
    else
      component.load(options, render);
  }
  else
    render();
}

zest.render.renderAttach = function(component, options, id, write, complete) {
  // run attachment
  var moduleId = zest.getModuleId(component);

  if (!moduleId)
    throw "Dynamic components need to be defined in individual component files. Component is: \n" + JSON.stringify(component);
  
  var optionsStr = options ? JSON.stringify(options) : '';
  
  if (typeof component.attach === 'string') {
    var context = requirejs.s.contexts[zest.config.require.server.context];
    // create the module map for the component
    var parentMap = context.makeModuleMap(moduleId, null, false, false);
    
    // normalize the attachment id
    var attachId = context.makeModuleMap(component.attach, parentMap, false, true).id;
    
    if (!component.progressive)
      write("<script src='" + requireInlineUrl() + "' data-require='zest," + attachId + "'></script> \n");
    write("<script src='" + attachUrl() + "' data-zid='" + id
          + "' data-controllerid='" + attachId + "'" + (optionsStr ? " data-options='" + optionsStr + "'" : "") + "></script> \n");
      
    complete();
  }
  // separate attachment
  else {
    if (!component.progressive)
      write("<script src='" + requireInlineUrl() + "' data-require='zest," + moduleId + "'></script> \n");
    
    write("<script src='" + attachUrl() + "' data-zid='" + id
          + "' data-controllerid='" + moduleId + "'" + (optionsStr ? " data-options='" + optionsStr + "'" : "") + "></script> \n");
    
    complete();
  }
}

/*
 * Automatically creates the http server from config only
 *
 */
zest.createServer = function(config, environment, complete) {
  zest.init(config, environment, function() {
    zest.startServer();
    if (complete)
      complete();
  });
}
