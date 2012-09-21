/*
 * Zest JS
 * Guy Bedford 2012
 * Verve Interactive
 * zestjs.org
 * openclient.org
 */
  
var path = require('path'),
  fs = require('fs'),
  crypto = require('crypto'),
  nodeStatic = require('node-static'),
  requirejs = require('requirejs'),
  http = require('http');
  
var $z = exports;
  
  
var fileServer = null;

var defaultConfig = {
  mode: 'dev',
  appDir: 'www',
  dynamicLibPrefix: 'dlib',
  serveFiles: true,
  explicitAttachment: false,
  devAttachment: false,
  devStaticCache: 0,
  staticLatency: 0,
  
  require: {
    baseUrl: 'lib',
    config: {
      'is/is': {
        client: true,
        render: true,
        node: false
      }
    }
  },
  
  server: {
    context: 'shared',
    nodeRequire: require,
    config: {
      'is/is': {
        client: false,
        render: true,
        node: true
      }
    },
    paths: {
      '@': '../..'
    }
  },
  client: {},
  production: {},
  build: {}
};

$z.serveApp = function(appId) {
  var app;
  if (typeof appId == 'string')
    $z.require([appId], function(_app) {
      app = _app;
    });
  else
    app = appId;
  
  return function(req, res, next) {
    if (!app) {
      $z.serveResources(req, res, next);
      return;
    }
  
    //create render options
    
    var pageOptions = {
      method: req.method,
      url: req.url,
      appId: appId
    };
    
    var routeData = app.getRoute(pageOptions);
    
    req.options = req.options || {};
    routeData.global = req.options;
    
    //create the http service for this cookie (session) and port
    req.options.httpService = {
      req: function(method, url, data, callback) {
        if (typeof data == 'function') {
          callback = data;
          data = {};
        }
        var _data = [];
        var str_data = JSON.stringify(data);
        var _req = http.request({
          hostname: 'localhost',
          path: url,
          port: parseInt(req.headers.host.split(':').pop()) || 80,
          method: method,
          headers: {
            'Content-Type': 'application/json',
            'Accept': 'application/json',
            'Content-Length': str_data.length,
            'Cookie': req.headers.cookie
          }
        }, function(_res) {
          _res.setEncoding('utf8');
          _res.on('data', function (chunk) {
            _data.push(chunk);
          });
          _res.on('end', function() {
            try {
              _data = JSON.parse(_data.join(''));
            }
            catch (e) {
              callback('Unable to parse JSON response.', true);
              return;
            }
            callback(_data);
          });
        });
        _req.on('error', function(e) {
          callback('Connection error', true);
        });
        _req.end(str_data);
      },
      get: function(url, data, callback) {
        this.req('GET', url, data, callback);
      },
      post: function(url, data, callback) {
        this.req('POST', url, data, callback);
      },
      put: function(url, data, callback) {
        this.req('PUT', url, data, callback);
      },
      delete: function(url, data, callback) {
        this.req('DELETE', url, data, callback);
      }
    };
    
    if (routeData)
      $z.render(routeData.route, app.htmlTemplate, routeData, res);
    
    else
      $z.serveResources(req, res, next);
  }
}


$z.setConfig = function(config, requires, complete) {
    
  if (arguments.length == 2) {
    complete = requires;
    requires = [];
  }
    
  //load configuration
  if (typeof config == 'string')
    return $z.loadConfig(eval(fs.readFileSync(config, 'utf-8')), complete);
  
  //load requirejs configurations from files if necessary
  var loadConfig = function(prop) {
    if (typeof config[prop] == 'string')
      config[prop] = eval('var c,require=function(o){return typeof o=="object"?c=o:c;}var requirejs=require.config=require;' +
        fs.readFileSync(config[prop], 'utf-8'));
  }
  
  loadConfig('require');
  
  loadConfig('client');
  loadConfig('build');
  loadConfig('server');
  loadConfig('production');
  
  
  function deepUnderwrite(a, b) {
    for (var p in b) {
      if (typeof b[p] == 'object') {
        a[p] = a[p] || {};
        deepUnderwrite(a[p], b[p]);
      }
      else if (a[p] === undefined)
        a[p] = b[p];
    }
  }
  
  //provide default configuration
  deepUnderwrite(config, defaultConfig);
  
  //derive client, build, server and production configs
  deepUnderwrite(config.client, config.require);
  deepUnderwrite(config.server, config.require);
  deepUnderwrite(config.build, config.require);
  deepUnderwrite(config.production, config.require);
  
  //hack
  config.client.baseUrl = '/' + config.client.baseUrl;
  
  //set server baseUrl if not already
  config.server.baseUrl = config.appDir + '/' + config.server.baseUrl;
  
  $z.require = requirejs.config(config.server);
  
  $z.require(['zest', 'css', 'zest/attach'], function(z, css, attach) {
  
    $z.css = css;
    $z.attach = attach;
    
    z.extend($z, z, {
      '*': 'FILL',
      'constructor': 'REPLACE',
      'render': 'PREPEND',
      'Region': 'IGNORE'
    });
    
    ResourceStream = $z.create([$z.Constructor], ResourceStream);
    
    $z.extend(z, $z, 'REPLACE');
    
    $z.Component.construct = function(options) {
      throw 'Components are not designed to be constructed on the server! Use $z.render instead.';
    }
    
    //make the static render function asynchronous
    /* $z.render.renderStaticComponent = (function makeAsync(f) {
      return function() {
        var self = this;
        var args = arguments;
        process.nextTick(function() {
          return f.apply(self, args);
        })
      }
    })($z.render.renderStaticComponent); */
    
    //store full config
    $z.config = $z.config || {};
    $z.extend($z.config, config, 'REPLACE');
    
    //prepare file server
    if ($z.config.serveFiles)
      fileServer = new nodeStatic.Server($z.config.appDir, {
        cache: $z.config.mode == 'production' ? 3600 : $z.config.devStaticCache
      });

    $z.require(requires, complete);
    
  });
};
  
$z.build = function(complete) {
  requirejs.optimize($z.config.build, function(buildResponse) {
    //$z.log(buildResponse);
    complete();
  });
  //NB include css build here
}

/*
 * $z.render server differences
 *
 * $z.render(Component, PageTemplate, options, response)
 *
 * If no PageTemplate provided, $z.HTML used by default
 *
 * options.appData is the 'global'
 *
 *
 * String is returned instead of an array of DOM elements.
 *
 * $z.render.renderHTML(html, children);
 *
 * children = {'<replacement>', 'value'}
 * 
 * Component Rendering is identical, except that we additionally calculate the component attachment script
 *
 * The component is searched for in the defined modules to match it to a requirejs moduleId.
 * If one is found, the moduleId is used for the component attachment.
 *
 * If no moduleId is found, the component is assumed anonymous, and serialized.
 *
 *
 * Shared functions:
 * $z.render.renderItem
 * $z.render.renderStaticComponent
 *
 * Entirely asynchronous render function!
 *
 * NB need to add a tabDepth
 *
 * ---
 *
 * Render creates the dynamic resource streams based on the following:
 *
 * given
 *   options.includeModules, Array, optional
 * generate
 *   options.cssStream, url
 *   options.jsStream, url
 *
 * This covers ALL the absolutely necessary meta for a managed dynamic script and CSS render.
 *
 */
$z.render = function(structure, htmlTemplate, options, res) {
  if (arguments.length != 4) {
    res = options;
    options = htmlTemplate;
    htmlTemplate = 'cs!zest/html';
  }
  htmlTemplate = htmlTemplate || 'cs!zest/html';
  
  res.statusCode = 200;
  res.setHeader('Content-Type', 'text/html');
  
  if (typeof htmlTemplate == 'string') {
    $z.require([htmlTemplate], function(htmlTemplate) {
      $z.render(structure, htmlTemplate, options, res);
    });
    return;
  }
  
  var streams;
  if (typeof structure == 'string')
    streams = $z.render.createResourceStreams(structure, options, options.includeModules || []);
  else
    streams = $z.render.createResourceStreams('inline', structure, options.includeModules || []);
  
  var write = function(chunk) {
    res.write(chunk);
  }
  
  var complete = function() {
    res.end();
    if (streams.css.end)
      streams.css.end();
    if (streams.js.end)
      streams.js.end();
  }
  
  var render = function(structure) {
    options.component = structure;
    var htmlOptions = {
      // NB generalise 'cssStream' into something that can be used as an app.css global!
      cssStream: streams.css.url,
      jsStream: streams.js.url,
      
      body: options,
      title: structure.title,
      deferTitle: structure.deferTitle,
      
      requireConfig: $z.config.mode == 'production' ? $z.config.production : $z.config.client,
      
      appId: options.appId,
      global: options.global
    };
    $z.render.renderItem(htmlTemplate, htmlOptions, write, complete);
  }
  
  if (typeof structure == 'string')
    $z.require([structure], render);
  else
    render(structure);
}

/*
 * $z.serveResources
 * Serves the main javascript library folder, as well as the dynamic resource generation folder
 * Also handles the caching of dynamic resources
 *
 * Can be used as middleware or a callback
 * 
 */
$z.serveResources = function(req, res, next) {
  
  if (!$z.config)
    throw 'You must first use $z.loadConfig to set configuration before serving resources.';
  
  //serve dynamically generated resources
  if (req.url.substr(0, 1 + $z.config.dynamicLibPrefix.length) == '/' + $z.config.dynamicLibPrefix) {

    var rName = req.url;
  
    var headers = {};
    if (rName.substr(rName.length - 2) == 'js')
      headers['Content-Type'] = 'text/javascript';
    else if (rName.substr(rName.length - 3) == 'css')
      headers['Content-Type'] = 'text/css';
    
    //if the resource is in the generation queue, then provide it on generation completion
    if (resourceStreams[rName]) {
      res.writeHead(200, headers);
      resourceStreams[rName].attach(res);
    }
    
    //if the resource is in the dynamic cache, then provide it
    else if (resourceCache[rName]) {
      res.writeHead(200, headers);
      res.end(resourceCache[rName]);
    }
    
    else {
      res.writeHead(404, headers);
      res.end('Dynamic resource not available.');
    }
  }
  else
    $z.serveFiles(req, res, next);
}

$z.serveFiles = function(req, res, next) {
  if ($z.config.serveFiles) {
    setTimeout(function() {
      fileServer.serve(req, res).addListener('error', function (err) {
        $z.log("Error serving " + req.url + " - " + err.message);
        next();
      });
    }, $z.config.staticLatency);
  }
  else
    next();
}

$z.serveAPI = function(services) {
  if (typeof services == 'string') {
    var server;
    $z.require([services], function(services) {
      server = $z.serveAPI(services);
    });
    return function(req, res, next) {
      if (server)
        return server(req, res, next);
      else
        next();
    };
  }
  return function(req, res, next) {
    var detectUrl = req.url;
    var contentType = req.headers['content-type'] || '';
    var accept = req.headers['accept'] || '';
    
    if (req.url.substr(0, 5) == '/json')
      detectUrl = req.url.substr(5);
    
    else if (contentType.indexOf('application/json') == -1 && accept.indexOf('application/json') == -1) {
      next();
      return;
    }
    
    //NB corresponding post version of '/json' shortcut
    var method_services = services[req.method];
    for (var s in method_services)
      if (s == detectUrl) {
        res.setHeader('Content-Type', 'application/json');
        res.statusCode = 200;
        method_services[s](req, res);
        return;
      }
    next();
  }
}

/*
 * $z.createResourceStreams
 *
 * Returns urls for the css and js resource streams of the renderable located
 * at structureId.
 *
 * The urls work immediately. CSS is streamed as it is written on the server,
 * while JS is held back until optimization completion (for build)
 * 
 * These paths are served dynamically with the $z.serveResources middleware
 * 
 */
$z.render.createResourceStreams = function(structureId, options, includedModules) {
  
  //the resource name is taken as the structureId followed by the md5 hash of the options
  //this allows for resource caching both client and server side
  var hash = crypto.createHash('md5');
  hash.update(JSON.stringify(options), 'utf-8');
  hash = hash.digest('hex');
  
  var cssUrl = '/' + $z.config.dynamicLibPrefix + '/' + structureId + '/' + hash + '.css';
  var jsUrl = '/' + $z.config.dynamicLibPrefix + '/' + structureId + '/' + hash + '.js';
  
  var cssStream, jsStream;
  
  if (resourceCache[cssUrl] === undefined) {
    if (resourceStreams[cssUrl])
      cssStream = resourceStreams[cssUrl];
    
    else
      cssStream = new ResourceStream(cssUrl);
  }
  else
    cssStream = { url: cssUrl };
  
  if (resourceCache[jsUrl] === undefined)
    jsStream = new ResourceStream(jsUrl);
  else
    jsStream = { url: jsUrl };
  
  //do generation
  if ($z.config.mode == 'production') {
    //run a build for script and css
    
    var renderConfig = $z.copy($z.config.build);
    delete renderConfig.modules;
    renderConfig.name = structureId;
    //renderConfig.exclude = includedModules;
    //renderConfig.include = ['css!>>!'];
    
    renderConfig.out = function(css) {
      //console.log(css);
      //cssStream.end(css);
    }
    delete renderConfig.appDir;
    delete renderConfig.dir;
    renderConfig.baseUrl = 'www/' + renderConfig.baseUrl;
    renderConfig.config.is = $z.copy(renderConfig.config.is);
    renderConfig.config.is.node = false;
    renderConfig.isExclude = (renderConfig.isExclude || []).concat(['node']);
    //requirejs.optimize(renderConfig);
    
    //script build
    /* renderConfig.out = function(script) {
      dynamicResources.cache[jsName] = script;
      dynamicResources.generating[jsName](script);
      delete dynamicResources.generating[jsName];
    }
    requirejs.optimize(renderConfig); */
    
  }
  
  return {
    css: cssStream,
    js: jsStream
  };
}

var resourceStreams = {};
var resourceCache = {};

/*
 * ResourceStream class
 *
 * Creates a resource stream buffer for dynamic resource generation.
 * While the generation is happening, connections are accepted, and
 * then the resources are streamed along those connections while
 * generation is still in progress.
 *
 * On generation completion, the stream is closed, and the buffer
 * is copied into the resourceCache.
 * 
 */
var ResourceStream = {
  //implement: [$z.Constructor],
  construct: function(url) {
    this.buffer = '';
    this.url = url;
    resourceStreams[url] = this;
    this.streams = [];
  },
  prototype: {
    endStreams: function(chunk) {
      if (typeof chunk == 'string')
        for (var i = 0; i < this.streams.length; i++)
          this.streams[i].end(chunk);
      delete this.streams;
    },
    writeStreams: function(chunk) {
      for (var i = 0; i < this.streams.length; i++)
        this.streams[i].write(chunk);
    },
    __attach: function(res) {
      this.streams.push(res);
      this.writeStreams(this.buffer);
      if (this.closed)
        this.endStreams();
    },
    __write: function(chunk) {
      this.writeStreams(chunk);
      this.buffer += chunk;
    },
    __end: function(chunk) {
      
      var buffer = $z.css.buffer;
      for (var c in buffer)
        this.buffer += buffer[c];
      
      if (typeof chunk == 'string') {
        this.endStreams(chunk);
        this.buffer += chunk;
      }
      else
        this.endStreams();
        
      this.closed = true;
      
      delete resourceStreams[this.url];
      resourceCache[this.url] = this.buffer;
    }
  }
};

$z.render.renderArray = function(structure, options, write, complete) {
  
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
      self.renderItem(structure[i], options, function(chunk) {
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

$z.render.renderComponentTemplate = function(component, options, write, complete) {

  // Render the template
  var html = typeof component.template == 'function' ? component.template(options) : component.template;
  
  //if its a page template, don't bother with labelling
  //if (!$z.inherits(component, $z.Page))
  html = this.labelComponent(html, options);
    
  //break up the regions into a render array
  var regions = html.match(/\{\`\w+\`\}/g);
  var renderArray = [html];
  
  if (regions)
    for (var i = 0; i < regions.length; i++)
      for (var j = 0; j < renderArray.length; j++) {
        if (typeof renderArray[j] == 'string' && renderArray[j].indexOf(regions[i]) != -1) {
          var split = renderArray[j].split(regions[i]);
          renderArray[j] = split[0];
          var regionName = regions[i].substr(2, regions[i].length - 4);
          renderArray.splice(j + 1, 0, split[1]);
          
          var regionStructure = component[regionName] || options[regionName];
          
          delete options.id;
          delete options.type;
          
          if (typeof regionStructure == 'function' && !regionStructure.template)
            regionStructure = regionStructure.call(component, options);
          
          renderArray.splice(j + 1, 0, regionStructure);
        }
      }
  
  //render
  this.renderArray(renderArray, options, write, complete);
  
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
$z.render.renderDynamicComponent = function(component, options, write, complete) {
  this.renderStaticComponent(component, options, write, function() {
    var moduleId = $z.getModuleId(component, true);
    
    var global = options.global;
    var _options = options;
    global._piped = global._piped || {};
    
    // Run piping
    options = component.pipe ? component.pipe(options) || {} : {};
    
    //only pipe global if a global pipe has been specially specified
    //piping the entire options global is lazy and ignored
    if (options.global == _options.global)
      delete options.global;
    else {
      //check if we've already piped a global, and if so, don't repipe
      for (var p in options.global)
        if (global._piped[p])
          delete options.global[p];
        else
          global._piped[p] = true;
    }
    
    //separate attahment module
    if (typeof component.attach == 'string') {
      
      var attachId = $z.req.toUrl($z.attach.toAbsModuleId(component.attach, moduleId));
      
      write("\n<script>\n" +
        "$z.attach('zest/attach!" + attachId + "', " + JSON.stringify(options) + ");\n" +
        "</script>\n");
      
      complete();
    }
    
    //lazy attachment (mixed)
    else if (typeof component.attach == 'function') {
      if (moduleId) {
        // hidden attachment - better (i think)
        if (!$z.config.explicitAttachment || !$z.config.devAttachment) {
          write("\n<script>\n" +
            "$z.attach('" + ($z.config.devAttachment ? "zest/attach!" : "") + moduleId + "', " + JSON.stringify(options) + ");\n" +
          "</script>\n");
          complete();
        }
        else {
          // explicitly show attachment for debugging
          $z.attach.createAttachment(moduleId, function(attachDef) {
            write("\n<script>\n" +
              "$z.attach(" + JSON.stringify(attachDef.requires) + ", " + "function(" + attachDef.dependencies.join(', ') + ") {\n" +
                "return " + attachDef.definition + ";\n" +
              "}" + ", " + JSON.stringify(options) + ");\n" + 
            "</script>\n");
            
            complete();
            
          });
        }
      }
      else {
        write("\n<script>\n" +
          "$z.attach(['zest'], function($z) {\n" +
            "return " + $z.attach.serializeComponent(component) + ";\n" +
          "}" + ", " + JSON.stringify(options) + ");\n" +
          "</script>\n");
        
        complete();
      }
    }
    
    else
      complete();
  });
}
