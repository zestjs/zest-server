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
  requirejs = require('requirejs');
  
var $z = exports;
  
  
var fileServer = null;

var defaultConfig = {
  mode: 'dev',
  appDir: 'www',
  dynamicLibPrefix: 'dlib',
  
  require: {
    baseUrl: 'lib',
    config: {
      is: {
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
      is: {
        client: false,
        render: true,
        node: true
      }
    }
  },
  client: {},
  production: {},
  build: {}
};
  
  
$z.setConfig = function(config, complete) {
    
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
  
  //set server baseUrl if not already
  config.server.baseUrl = config.appDir + '/' + config.server.baseUrl;
  
  $z.require = requirejs.config(config.server);
  
  $z.require(['zest', 'css', 'zest/attach'], function(z, css, attach) {
  
    $z.css = css;
    $z.attach = attach;
    
    z.underwrite($z, z, {
      'constructor': z.extend.REPLACE,
      'render': z.underwrite,
      'Region': z.extend.IGNORE
    });
    
    ResourceStream = $z.create([$z.constructor, $z.InstanceChains], ResourceStream);
    
    $z.overwrite(z, $z);
    
    $z.Component._definition.construct = function(options) {
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
    $z.overwrite($z.config, config);
    
    $z.Page = $z.creator($z.Page);
    $z.Page._definition._extend = {
      body: $z.extend
    };
    
    //prepare file server
    fileServer = new nodeStatic.Server($z.config.appDir, {
      cache: $z.config.mode == 'production' ? 3600 : 0
    });

    complete();
    
  });
};
  
$z.build = function(complete) {
  requirejs.optimize($z.config.build, function(buildResponse) {
    $z.log(buildResponse);
    complete();
  });
  //NB include css build here
}

/*
 * $z.render server differences
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
$z.render = function(moduleId, options, res) {
  var write = function(chunk) {
    res.write(chunk);
  }
  
  var streams = $z.render.createResourceStreams(moduleId, options, options.includeModules || []);
  options.cssStream = streams.css.url;
  options.jsStream = streams.js.url;
  
  var complete = function() {
    res.end();
    if (streams.css.end)
      streams.css.end();
    if (streams.js.end)
      streams.js.end();
  }
  
  $z.require([moduleId], function(structure) {
    $z.render.renderItem(structure, options, write, complete);
  });
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
    
    return;
  }
  
  fileServer.serve(req, res).addListener('error', function (err) {
    $z.log("Error serving " + req.url + " - " + err.message);
  });
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
    
    else {
      cssStream = new ResourceStream(cssUrl);
      
      $z.on($z.css, 'add', cssStream.write);
      cssStream.end.on(function() {
        $z.remove($z.css, 'add', cssStream.write);
      });
      
    }
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
  //implement: [$z.constructor, $z.InstanceChains],
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
        this.streams.write(chunk);
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

var attachBuffer;
$z.loadAttachScript = function() {
  return '' + 
  '$z=typeof $z!="undefined"?$z:function(){return $z.main.apply(this, arguments)};$z.attach=function(a,b,c){if(typeof a==="string")' +
  '{a=[a];c=b;b=function(a){return a}}c=c||{};' +
  'var d=Array.prototype.pop.call(document.getElementsByTagName("script"));var e=d;var f=[];while(e=e.previousSibling){f.unshift(e);' +
  'if(e.nodeType==1&&e.getAttribute("component")&&!e.$z)break}d.parentNode.removeChild(d);$z.attach.attachments.push({$$:f,options:f,' +
  'component:null});var g=$z.attach.attachments.length-1;require(a,function(){var a=b.apply(null,arguments);$z.attach.attachments[g].component=a;' +
  '$z.attach.doAttach()})};$z.attach.attachments=[];$z.attach.curAttach=0;$z.attach.doAttach=function(){while(this.attachments[this.curAttach]&&' +
  'this.attachments[this.curAttach].component){var a=this.attachments[this.curAttach];a.component.attach.call(a.component,a.$$,a.options);' +
  'this.curAttach++}}';
  
  if (attachBuffer)
    return attachBuffer;
  
  var path;
  if ($z.config.isBuild)
    path = $z.config.build.dir;
  else
    path = $z.config.appDir;
    
  path += '/' + $z.config.client.baseUrl;
  path += '/' + $z.config.client.map['*'].zest || 'zest';
  path = path.substr(0, path.length - 4);
  path += 'attachment.js';
  
  attachBuffer = fs.readFileSync(path, 'utf-8');
  
  return attachBuffer;
}


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
    
    //separate attahment module
    if (typeof component.attach == 'string') {
      
      var attachId = $z.req.toUrl($z.attach.toAbsModuleId(component.attach, moduleId));
      
      write("\n<script>\n" +
        "$z.attach('" + attachId + "', " + JSON.stringify(options) + ");\n" +
        "</script>\n");
      
      complete();
    }
    
    //lazy attachment (mixed)
    else if (typeof component.attach == 'function') {
      $z.attach.createAttachment(moduleId, function(attachDef) {
        write("\n<script>\n" +
          "$z.attach(" + JSON.stringify(attachDef.requires) + ", " + "function(" + attachDef.dependencies.join(', ') + ") {\n" +
            "return " + attachDef.definition + ";\n" +
          "}" + ", " + JSON.stringify(options) + ");\n" + 
        "</script>\n");
        
        complete();
        
      });
    }
    
    else
      complete();
  });
}

/*
 * $z.HTMLPage
 * A static structure to use for full page output.
 */
//this gets created as an 'implementor' after creation
$z.Page = {
  template: function(o) {
    return '<!doctype html> \n' +
      '<html> \n' + 
      '<head> \n' +
      '  <script type="text/javascript" data-main="' + (o.main || '') + '" src="/' + ($z.config.mode == 'production' ? $z.config.production.baseUrl : $z.config.client.baseUrl) + '/require.js"></script> \n' +
      '  <script type="text/javascript"> \n' +
      '    require.config(' + JSON.stringify($z.config.mode == 'production' ? $z.config.production : $z.config.client) + '); \n' +
      '    ' + $z.loadAttachScript() + ' \n' + 
      '  </script> \n' +
      '  <link rel="stylesheet" type="text/css" href="' + o.cssStream + '"></link>' +
      '                 ' +
      '</head> \n' +
      '<body>{`body`}</body> \n' +
      '</html>';
  }
};