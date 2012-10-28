#!/usr/bin/env node

/*
 * Zest Server
 *
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

var defaultConfig = {
  environment: 'dev',
  
  //environment-specific configs, extend base config
  environments: {
    production: {
      
    },
    dev: {
      fileExpires: 0,
      
      debugInfo: true,
      logRender: true,
      renderDelay: 100,
      staticLatency: 100,
      
      /* Application Server */
      modules: {
        //'cs!$zest-server/core-module': {}
      }
    }
  },
  
  zestLayer: 'zest/build-layer',
  
  buildLayers: {
    'zest/build-layer': {
      name: '$zest-server/attachment',
      include: ['zest/zest', 'selector']
    }
  },
  
  /* Layer Building */
  rebuildZestLayer: true,
  
  /* Attachment */
  explicitAttachment: false, //show attachment object in html
  dynamicAttachment: false, //when outside a build, generate the attach! variant client-side
  
  /* File Server */
  serveFiles: true,
  fileExpires: 500,
  
  /* https and spdy support */
  https: {
    enable: false,
    key: ''
  },
  spdy: false,
  
  /* Page Load Testing */
  renderDelay: 0,
  staticLatency: 0,
  debugInfo: false,
  
  /* Page Rendering - default options */
  page: {
    //structure to render the html page with (html template effectively)
    pageStructure: 'cs!$zest-server/html',
    
    //page options, structure and options are body structure, as set by route
    id: null,
    title: '',
    layers: [], //by default starts with zestLayer
    main: '',
    //requireConfig: zest.config.client,
    options: {},
    global: {} //default global options
  },
  
  /* Application Server */
  modules: {
    //'cs!$zest-server/core-module': {}
  },
  
  /* Require Config */
  appDir: process.cwd(),
  publicDir: 'www',
  libDir: 'lib',
  libBuildDir: 'blib',
  
  require: {
    config: {
      'require-is/is': {
        render: true
      }
    },
    paths: {
    },
    map: {
      '*': {
        is: 'require-is/is',
        css: 'require-css/css',
        less: 'require-less/less',
        rest: 'rest/rest'
      }
    },
  
    //server require config
    server: {
      // base url is publicDir/libDir
      context: 'shared',
      nodeRequire: require,
      paths: {
        '$zest-server': __dirname,
        '$': process.cwd()
      },
      map: {
        '*': {
          selector: 'empty',
          jquery: 'empty'
        }
      },
      config: {
        'require-is/is': {
          client: false,
          render: true,
          node: true
        }
      }
    },
  
    //client require config
    client: {
      // base url is libDir
    },
  
    //build require config
    //when we do a build, zest core is dropped into the zest/core file
    build: {
      // baseUrl is ., appDir is publicDir/libDir/, dir is publicDir/libBuildDir/
      modules: [
        {
          name: 'test',
          include: 'test',
          exclude: ['zest/core']
        }
      ]
    }
  }
};


var reqErr = function(err) {
  console.dir(JSON.stringify(zest.config));
  console.log('Error setting config when loading modules: ' + JSON.stringify(err.requireModules));
  throw err;
}

//get hooked in once config has been loaded
var $z, css, attach, normalize;

//trace css dependencies for modules to allow critical css inclusions
var cssDependencies = {};

zest.init = function(config, complete) {
  
  console.log('Loading Configuration');
  if (zest.config != config)
    zest.config = loadConfig(config);
  
  console.log('Initializing RequireJS');
  zest.require = requirejs.config(zest.config.require.server);
  
  //set up css dependency tracking
  requirejs.onResourceLoad = function(context, map, depArray) {
    //coffee script -> dependency is name dependency
    var moduleId = map.prefix == 'cs' ? map.name : map.id;
    //check each dependency for css! calls or dependencies which have css! dependencies themselves
    for (var i = 0; i < depArray.length; i++) {
      var depId = depArray[i].prefix == 'cs' ? depArray[i].name : depArray[i].id;
      
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
  
  //requirejs
  console.log('Loading RequireJS dependencies');
  zest.require(['require', 'zest', 'css', '$zest-server/attach', 'require-css/normalize'], function(req, _$z, _css, _attach, _normalize) {
    zest.req = req;
    zest.baseUrl = zest.require.toUrl('.');
    $z = _$z;
    css = _css;
    attach = _attach;
    normalize = _normalize;
    
    $z.extend($z.render, zest.render, 'REPLACE');
    
    //the step function for creating the server. executed immediately after creating.
    var makeServer = $z.fn($z.fn.ASYNC);
  
    //create server handler
    makeServer.on(function(next) {
      zest.server = $z.fn($z.fn.ASYNC);
      zest.handlers = $z.fn($z.fn.ASYNC);
      zest.routes = {};
      
      next();
    });
    
    //load module config
    var moduleConfig = [];
    var modules = [];
    makeServer.on(function(next) {
      console.log('Loading Modules');
      var moduleConfigRequires = [];
      
      for (var module in zest.config.modules) {
        modules.push(module);
        if (typeof zest.config.modules[module] == 'string') {
          moduleConfigRequires.push(module);
          moduleConfig.push(undefined);
        }
        else {
          moduleConfigRequires.push('');
          moduleConfig.push(zest.config.modules[module]);
        }
      }
      zest.require(moduleConfigRequires, function() {
        for (var i = 0; i < arguments.length; i++)
          moduleConfig[i] = moduleConfig[i] || arguments[i];
          
        next();
      });
    });
    
    //load modules
    makeServer.on(function(next) {
      //default module is zest core module
      if (modules.length == 0)
        modules.push('cs!$zest-server/core-module');
      //store the modules for direct access
      zest.modules = {};
      zest.require(modules, function() {
        for (var i = 0; i < arguments.length; i++) {
          var module = arguments[i];
          //instantiate with config
          if (typeof module == 'function')
            module = module(moduleConfig[i]);
          if (module.routes)
            $z.router.addRoutes(module.routes);
          if (module.handler)
            zest.handlers.on(function() {
              module.handler.apply(module, arguments);
            });
          zest.modules[modules[i]] = module;
        }
        next();
      });
    });
    
    //include module-defined zest configs
    makeServer.on(function(next) {
      for (var module in zest.modules) {
        if (!zest.modules[module].zestConfig)
          continue;
        
        var moduleConfig = zest.modules[module].zestConfig;
        
        //compute environment config as outModuleConfig
        var outModuleConfig = moduleConfig;
        if (moduleConfig.environments) {
          outModuleConfig = moduleConfig.environments[zest.config.environment] || {};
          delete moduleConfig.environments;
          $z.extend(outModuleConfig, moduleConfig, 'DPREPEND');
        }
        
        //save environment config back for reference
        zest.modules[module].zestConfig = outModuleConfig;
        
        //add module config to main zest config
        $z.extend(zest.config, outModuleConfig, {'*': 'DAPPEND', 'require': 'IGNORE'});
        
        //compute require config with defaults, then add into main zest config
        if (outModuleConfig.require) {
          var _extendRules = {'*': 'DPREPEND', 'client': 'IGNORE', 'server': 'IGNORE', 'build': 'IGNORE'};
          
          $z.extend(zest.config.require.client, outModuleConfig.require, _extendRules);
          $z.extend(zest.config.require.server, outModuleConfig.require, _extendRules);
          $z.extend(zest.config.require.build, outModuleConfig.require, _extendRules);
          
          $z.extend(zest.config.require.client, outModuleConfig.require.client || {}, 'DPREPEND');
          $z.extend(zest.config.require.server, outModuleConfig.require.server || {}, 'DPREPEND');
          $z.extend(zest.config.require.build, outModuleConfig.require.build || {}, 'DPREPEND');
          
          //update server require
          zest.require = requirejs.config(zest.config.require.server);
        }
      }
      next();
    });
    
    //build the core if necessary
    makeServer.on(function(next) {
      if (!zest.config.rebuildZestLayer && fs.existsSync(path.resolve(zest.config.appDir, zest.config.publicDir, zest.config.libDir, zest.config.zestLayer + '.js')))
        return next();
      
      console.log('Building core files');
      var build = {
        baseUrl: path.resolve(zest.config.appDir, zest.config.publicDir, zest.config.libDir),
        out: path.resolve(zest.config.appDir, zest.config.publicDir, zest.config.libDir, zest.config.zestLayer + '.js'),
        paths: {
          '$zest-server': __dirname
        },
        //optimize: 'none', //quicker
        //ensure synchronous requires
        wrap: {
          start: 'for (var c in require.s.contexts) { require.s.contexts[c].nextTick = function(fn){ fn(); } }',
          end: "require(['$zest-server/attachment']);"
        }
      };
      $z.extend(build, zest.config.buildLayers[zest.config.zestLayer], 'FILL');
      $z.extend(build, zest.config.require.build, {
        '*': 'FILL',
        'appDir': 'IGNORE',
        'dir': 'IGNORE',
        'baseUrl': 'IGNORE',
        'modules': 'IGNORE',
        'paths': 'FILL'
      });
      
      var _onResourceLoad = requirejs.onResourceLoad;
      requirejs.optimize(build, function(buildResponse) {
        console.log(buildResponse);
        requirejs.onResourceLoad = _onResourceLoad;
        
        //clean up after build, by restarting entire init
        zest.config.rebuildZestLayer = false;
        delete requirejs.s.contexts[zest.config.require.server.context || '_'];
        zest.init(zest.config, complete);
      });
    });
    
    //create server
    makeServer.on(function(next) {
      console.log('Creating server');
      
      //initial handler
      zest.server.on(function(req, res, next) {
        
        //check the 'accept' header if given, to ensure we are rendering html
        //if not, skip routing check
        if (req.headers.accept)
          if (!req.headers.accept.match(/text\/html/))
            return next();
        
        /*
         * check the url for any routes -> populates route data onto req:
         *
         * route.redirect (if doing a redirect)
         * route.route (the route object)
         * route.options (the route component options)
         * 
         */
        var r = $z.router.route(req.url);
        //null route -> skip
        if (r.route === null)
          return next();
        
        //redirect
        if (r.redirect) {
          req.redirect = r.redirect;
          return next();
        }
        
        //create a fresh page object
        req.page = {};
        
        //route object
        if (typeof r.route == 'object') {
          //clone the route defaults onto the page
          $z.extend(req.page, r.route, {
            '*': 'DFILL',
            'layers': 'ARR_PREPEND'
          });
        }
        else {
          req.page.structure = r.route;
          req.page.options = $z.extend({}, r.options, 'FILL');
        }
        
        //then fill in the page defaults from the config
        $z.extend(req.page, zest.config.page, {
          '*': 'DFILL',
          'layers': 'ARR_PREPEND'
        });

        //deep clone the require config, allowing page-specific variation
        req.page.requireConfig = $z.extend(req.page.requireConfig || {}, zest.config.require.client, 'DREPLACE');
        
        //lookup the module name responsible for the page route
        for (var module in zest.modules)
          if (zest.modules[module].routes[req.page.options._route]) {
            req.page.module = zest.modules[module];
            break;
          }
        
        next();
      });
      
      //run the handlers - can alter the routing
      zest.server.on(zest.handlers);
      
      //finally, follow the routing
      zest.server.on(function(req, res, next) {
        if (req.redirect) {
          res.writeHead(301, {
            'Location': req.redirect
          });
          res.end();
          return;
        }
        
        if (!req.page || !req.page.structure)
          return next();
        
        //single-argument shorthand for a page render
        zest.renderPage(req.page, res);
      });
      
      //fall through is the file server (if enabled)
      zest.server.on(serveFiles);
      
      //final fall through is the zest 404, this should never be reached really
      zest.server.on(function(req, res) {
        res.writeHead(404, {
          'Content-Type': 'text/html'
        });
        res.end('Not a valid Url');
      });
      
      next();
    });
    
    makeServer(complete);
  }, reqErr);
}

zest.startServer = function(port) {
  if (!setConfig)
    throw 'Configuration hasn\'t been set to start server';
  http.createServer(zest.server).listen(port || zest.config.port || 8080);
  console.log('Listing on port 8080...');
}

/* zest.clearRequires = function() {
  delete requirejs.s.contexts[zest.config.server.context];
  cssDependencies = {};
  
  zest.require = requirejs.config(zest.config.server);
} */

var setConfig = false;
//load requirejs configurations from files if necessary
var getJSONConfigFile = function(file) {
  return eval('var c,require=function(o){return typeof o=="object"?c=o:c;},requirejs=require.config=require;(' +
    fs.readFileSync(file, 'utf-8') + ');');
}
//config is simply taken for the dirname where zest.json can be found
var loadConfig = function(config) {
  //load configuration
  if (typeof config == 'string') {
    var isDir = config.substr(config.length - 1, 1) == '/';
    //config file path is taken to be app directory
    defaultConfig.appDir = isDir ? path.resolve(config) : path.dirname(path.resolve(config));
    defaultConfig.require.server.paths['$'] = defaultConfig.appDir;
    //load config as a json file
    return loadConfig(getJSONConfigFile(isDir ? path.resolve(config, 'zest.json') : path.resolve(config)));
  }
  
  if (setConfig)
    throw 'Configuration has already been set. Start a new server instance for alternative configuration.';
  setConfig = true;
    
  function deepPrepend(a, b) {
    for (var p in b) {
      if (b[p] instanceof Array) {
        a[p] = a[p] || [];
        a[p] = a[p].concat(b[p]);
      }
      if (typeof b[p] == 'object' && b[p] !== null) {
        a[p] = a[p] || {};
        deepPrepend(a[p], b[p]);
      }
      else if (a[p] == undefined)
        a[p] = b[p];
    }
  }
  
  deepPrepend(config, defaultConfig);
  
  //provide default configurations, starting with the environment mode config
  var outConfig = config.environments[config.environment];
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
  outConfig.require.server.baseUrl = path.resolve(outConfig.appDir, outConfig.publicDir, outConfig.libDir);
  outConfig.require.client.baseUrl = '/' + (outConfig.mode == 'production' ? outConfig.libBuildDir : outConfig.libDir);
  outConfig.require.build.baseUrl = '.';
  outConfig.require.build.appDir = path.resolve(outConfig.appDir, outConfig.publicDir, outConfig.libDir);
  outConfig.require.build.dir = path.resolve(outConfig.appDir, outConfig.publicDir, outConfig.libBuildDir);
  
  return outConfig;
}

var fileServer = null;
var serveFiles = function(req, res, next) {
  if (zest.config.serveFiles) {
    fileServer = fileServer || new nodeStatic.Server(path.resolve(zest.config.appDir, zest.config.publicDir), {
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
  
  var outDir = zest.config.appDir.split('/');
  outDir.pop();
  outDir.push('www-built');
  outDir = outDir.join('/');
  
  zest.config.require.build.appDir = zest.config.appDir;
  zest.config.require.build.dir = outDir;
  
  requirejs.optimize(zest.config.require.build, function(buildResponse) {
    console.log(buildResponse);
    complete();
  });
}


/*
 * $z.render
 *
 * $z.render(structure, [pageOptions], options, write, complete)
 *
 * streams the response.
 *
 * If no page options are provided, the default page template is used.
 *
 * Render includes attachment script prefix and suffixes.
 *
 * This assumes that the template populates the 'head' region to allow for these scripts to be embedded.
 *
 * htmlOptions = {
 *   component: 'pageTemplateId',
 *   title: '',
 *   body: ''
 * }
 *
 * Can add any others for a custom template
 *
 * NB need to add a tabDepth
 *
 *
 */
zest.render = function(structure, options, res, complete) {
  options = options || {};
  options.global._nextComponentId = 1;
  delete $z._nextComponentId;

  res.writeHead(200, {
    'Content-Type': 'text/html'
  });
  
  $z.render.renderItem({
    structure: structure,
    options: options
  }, function(chunk) {
    res.write(chunk);
  }, function() {
    res.end();
    if (complete)
      complete();
  });
}

zest.renderPage = function(page, res, complete) {

  //add the defaults to the page
  $z.extend(page, zest.config.page, {
    '*': 'DFILL',
    'layers': 'ARR_PREPEND'
  })

  //wont be altering at this level, so no need to clone require config
  if (!page.requireConfig)
    page.requireConfig = zest.config.require.client;
  
  //add zest layer
  page.layers.unshift(zest.config.zestLayer + '.js');
  
  delete zest._nextComponentId;
  page.global._nextComponentId = 1;
    
  res.writeHead(200, {
    'Content-Type': 'text/html'
  });
  
  $z.render.renderItem({
    structure: page.pageStructure,
    options: page
  }, function(chunk) {
    res.write(chunk);
  }, function() {
    res.end();
    if (complete)
      complete();
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
      self.renderItem(structure[i], i == len - 1 ? options : $z.extend({}, options), function(chunk) {
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

zest.render.renderComponentTemplate = function(component, options, write, complete, noDelay) {
  if (zest.config.renderDelay && !noDelay) {
    var self = this;
    return setTimeout(function() {
      self.renderComponentTemplate(component, options, write, complete, true);
    }, zest.config.renderDelay);
  }
  
  var cssIds;
  var moduleId;
  
  if ((moduleId = $z.getModuleId(component)))
    //have a moduleId, see if we are dependent on any css
    cssIds = cssDependencies[moduleId.substr(0, 3) == 'cs!' ? moduleId.substr(3) : moduleId];
    
  cssIds = cssIds || [];
  
  var pageCSSIds = options.global.pageCSSIds = options.global.pageCSSIds || [];
  //filter the cssIds to unique
  for (var i = 0; i < cssIds.length; i++) {
    if (pageCSSIds.indexOf(cssIds[i]) != -1)
      cssIds.splice(i, 1);
    else
      pageCSSIds.push(cssIds[i]);
  }
  
  var css;
  if (component.css)
    css = typeof component.css == 'function' ? component.css(options) : component.css;
  
  // render the style attachment if necessary
  if (options.id || css || (cssIds && cssIds.length)) {
    //normalize css paths to the baseurl
    if (moduleId)
      css = normalize(css, requirejs.toUrl(moduleId), zest.baseUrl);
    write("\n<script>" +
      "$z.style('" + options.id + "'"
        + (cssIds.length ? ", " + JSON.stringify(cssIds) : '')
        + (css ? ", '" + escape(css || '') + "'" : "")
        + ");"
      + "</script>"
      //+ "<style>" + (css || '') + "</style>"      
      );
  }

  // Render the template
  var html = typeof component.template == 'function' ? component.template(options) : component.template;
  
  //if its a page template, don't bother with labelling
  //if (!$z.inherits(component, $z.Page))
  html = this.labelComponent(html, options);
    
  //break up the regions into a render array
  var regions = html.match(/\{\`\w+\`\}/g);
  var renderArray = [html];
  
  var regionOptions;
  
  if (regions) {
    regionOptions = $z.extend({}, options, { id: 'IGNORE', type: 'IGNORE' });
    for (var i = 0; i < regions.length; i++)
      for (var j = 0; j < renderArray.length; j++) {
        if (typeof renderArray[j] == 'string' && renderArray[j].indexOf(regions[i]) != -1) {
          var split = renderArray[j].split(regions[i]);
          renderArray[j] = split[0];
          var regionName = regions[i].substr(2, regions[i].length - 4);
          renderArray.splice(j + 1, 0, split[1]);
          
          var regionStructure = component[regionName] || options[regionName];
                    
          if (typeof regionStructure == 'function' && !regionStructure.template) {
            regionStructure = regionStructure.call(component, regionOptions);
          }
          
          renderArray.splice(j + 1, 0, regionStructure);
        }
      }
  }
  
  //render
  this.renderArray(renderArray, regionOptions || options, write, complete);
  
}

/*
 * $z.attach(['dep/1', 'dep/2'], function(dep1, dep2) {
 *   return com;
 * }, {..options..});
 *
 * OR
 *
 * $z.attach('def', {..options..});
 *
 */
var escape = function(content) {
  return content.replace(/(["'\\])/g, '\\$1')
    .replace(/[\f]/g, "\\f")
    .replace(/[\b]/g, "\\b")
    .replace(/[\n]/g, "\\n")
    .replace(/[\t]/g, "\\t")
    .replace(/[\r]/g, "\\r");
}
zest.render.renderAttach = function(component, options, write, complete) {
  // run attachment
  var _options = options;
  options.global._piped = options.global._piped || {};
  
  // Run piping
  options = component.pipe ? component.pipe(options) || {} : {};
  
  //only pipe global if a global pipe has been specially specified
  //piping the entire options global is lazy and ignored
  if (options.global == _options.global)
    delete options.global;
  else {
    //check if we've already piped a global, and if so, don't repipe
    for (var p in options.global)
      if (_options.global._piped[p])
        delete options.global[p];
      else
        _options.global._piped[p] = true;
  }
  
  var moduleId = $z.getModuleId(component);
  
  if (typeof component.attach === 'string') {
    //separate attahment module
    var attachId = zest.req.toUrl(attach.toAbsModuleId(component.attach, moduleId));
    
    //nb do we need attach! here?
    write("<script>" +
      "$z.attach('" + _options.id + "', 'zest/attach!" + attachId + "', " + JSON.stringify(options) + ");" +
      "</script>\n");
      
    complete();
  }
  //lazy attachment (mixed)
  else {
    if (moduleId) {
      // hidden attachment - better (i think)
      if (!zest.config.explicitAttachment) {
        write("<script>" +
          "$z.attach('" + _options.id + "', '" + (zest.config.dynamicAttachment ? "zest/attach!" : "") + moduleId + "', " + JSON.stringify(options) + ");" +
        "</script>\n");
        complete();
      }
      else {
        // explicitly show attachment for debugging
        attach.createAttachment(moduleId, function(attachDef) {
          write("<script>" +
            "$z.attach('" + _options.id + "', " + JSON.stringify(attachDef.requires) + ", " + "function(" + attachDef.dependencies.join(', ') + ") {\n" +
              "return " + attachDef.definition + ";" +
            "}" + ", " + JSON.stringify(options) + ");\n" + 
          "</script>\n");
          
          complete();
        });
      }
    }
    else {
      write("<script>" +
        "$z.attach('" + _options.id + "', ['zest'], function($z) {\n" +
          "return " + attach.serializeComponent(component) + ";\n" +
        "}" + ", " + JSON.stringify(options) + ");" +
        "</script>\n");
      
      complete();
    }
  }
}

/*
 * Automatically creates the http server from config only
 *
 */
zest.createServer = function(appDir, complete) {
  zest.init(appDir || process.cwd(), function() {
    zest.startServer();
    if (complete)
      complete();
  });
}
