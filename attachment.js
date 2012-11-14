/*
 * $z.attach
 * Used for attaching components as if they were generated client-side after a server render.
 * It is the client helper for the $z.render function on the server.
 *
 * Usage:
 * $z.attach(componentLoadFunction, {..options..});
 *
 * componentLoadFunction is a function that allows a callback to act on the loaded component (a wrapper for a require function).
 *
 * The assumption is made that the $$ for the component can be calculated from stepping back
 * from the script it is executed in until it finds the first non-attached 'component' attribute.
 *
 * The component 'attach' method is then called with $$ and options as parameters.
 *
 * 
 */
define(['css', 'less', 'zest', 'require-css/normalize'], function (css, less, $z, normalize) {
  var baseUrl = require.toUrl('.');
  baseUrl = baseUrl.substr(0, baseUrl.length - 1);
  
  var ajaxSync = function(url) {
    var ajax = window.XMLHttpRequest ? new XMLHttpRequest() : new ActiveXObject('Microsoft.XMLHTTP');
    if (!ajax)
      return false;
    
    ajax.open('get', url, false);
    ajax.send(null);
    return ajax.responseText;
  }
  
  
  /*
   * $z.style(componentId, [cssIds], 'instance style')
   *
   * Critical style injector. Run within script tags during the load to load styles only when absolutely necessary.
   * For a build, layers detected and critically requested as well.
   *
   */
  
  //used by url normalizations
  var pathname = window.location.pathname.split('/');
  pathname.pop();
  pathname = pathname.join('/') + '/';
  
  $z.style = function(id, cssIds, instanceCSS, attach) {
    var scriptNode = Array.prototype.pop.call(document.getElementsByTagName('script'));
    
    if (!(cssIds instanceof Array)) {
      attach = instanceCSS;
      instanceCSS = cssIds;
      cssIds = [];
    }
    if (typeof instanceCSS == 'boolean') {
      attach = instanceCSS;
      instanceCSS = '';
    }
    
    if (id.substr(0, 1) == 'z')
      if (parseInt(id.substr(1)) > $z._nextComponentId)
        $z._nextComponentId = id.substr(1);
    
    //run through all the css moduleIds to see if they have a layer they can be downloaded from
    //add the layer downloads to the current document blocking load (with document.write)
    //otherwise run a sync ajax request to download and inject the css blocking the page
    cssIds = cssIds || [];
    for (var i = 0; i < cssIds.length; i++) {
      var lessId = false;
      
      if (cssIds[i].substr(0, 5) == 'less!')
        lessId = true;
      else if (cssIds[i].substr(0, 4) != 'css!')
        cssIds[i] = 'css!' + cssIds[i];
      
      
      //dont bother if its already defined
      if (require.defined(cssIds[i]))
        continue;
      
      var filePath = lessId ? cssIds[i].substr(5) : cssIds[i].substr(4);
      
      var layerUrl = require.toUrl((!lessId ? 'require-css/css!' : 'require-less/less!') + filePath);
      
      var lt = '<';
      var gt = '>';
      
      //if the css mapped to a layer, download that layer blocking the page here
      if (layerUrl.substr(0, baseUrl.length + (!lessId ? 16 : 18)) != baseUrl + (!lessId ? 'require-css/css!' : 'require-less/less!'))
        document.write(lt + 'script type="text/javascript" src="' + layerUrl + '"' + gt + lt + '/script' + gt);
      
      //otherwise, sync download and inject the css right now, then define it
      else {
        
        if (lessId) {
          //first ensure we have the less parser
          if (!less.parse) {
            //load less parser dynamically in development (yes eval is evil but this doesnt happen in production)
            var lessc = eval('(function() {var defined; var define = function(a){defined = a();}; define.amd = 1;' + ajaxSync(require.toUrl('require-less/lessc.js')) + '; return defined; })()');
            var parser = new lessc.Parser();
            less.parse = function(less) {
              var css;
              parser.parse(less, function(err, tree) {
                if (err)
                  throw new Error(err.message, lessId, err.line);
                css = tree.toCSS();
              });
              //instant callback luckily
              return css;
            }
          }
          var sourceUrl = require.toUrl(filePath + (filePath.substr(cssIds[i].length - 5, 5) != '.less' ? '.less' : ''));
          css.inject(normalize(less.parse(ajaxSync(sourceUrl)), sourceUrl, pathname));
        }
        
        else {
          var sourceUrl = require.toUrl(filePath + (filePath.substr(cssIds[i].length - 4, 4) != '.css' ? '.css' : ''));
          css.inject(normalize(ajaxSync(sourceUrl), sourceUrl, pathname));
        }
          
        //define the css in requires
        define((!lessId ? 'require-css/css!' : 'require-less/less!') + filePath, function() {
          return css;
        });
        //and require to ensure defined from now on
        //callback necessary as for some reason not sync otherwise
        require([(!lessId ? 'require-css/css!' : 'require-less/less!') + filePath], function() {});
      }
    }
    
    //add instance css if provided
    if (instanceCSS)
      $z.css.set(id, instanceCSS, true);
    
    //store attachment info for removal on attachment
    if (attach)
      $z._components[id] = {
        styleNode: scriptNode
      };
    else
      scriptNode.parentNode.removeChild(scriptNode);
  }
  
  /*
   * attachment by id
   *
   * $z.attach('id', [], def, options)
   * $z.attach('id', '', options)
   *
   * 
   * 
   */
  $z.attach = function(id, deps, def, options) {
    //basic attachment variation
    if (typeof deps === 'string') {
      deps = [deps];
      options = def;
      def = function(c) { return c; }
    }
    
    options = options || {};
    
    var scriptNode = Array.prototype.pop.call(document.getElementsByTagName('script'));
    var prevNode = scriptNode;
    
    var styleNode = $z._components[id].styleNode;
    delete $z._components[id].styleNode;
    
    var $$ = [];
    while (prevNode = prevNode.previousSibling) {
      if (prevNode == styleNode)
        break;
      $$.unshift(prevNode);
    }
    scriptNode.parentNode.removeChild(scriptNode);
    styleNode.parentNode.removeChild(styleNode);
    
    options.$$ = $$;
    options.id = id;
    if (options.global) 
      for (var o in options.global)
        $z._global[o] = options.global[o];
    options.global = $z._global;
    
    delete $z._components[id].firstElement;
    $z._components[id].$$ = $$;
    $z._components[id].options = options;
    
    requirejs(deps, function() {
      var com = def.apply(null, arguments);
      $z._components[id].controller = com;
      $z.attach.doAttach(id);
    });
  }
  $z._global = $z._global || {};
  $z._components = $z._components || {};
  
  $z.attach.doAttach = function(id) {
    var item = $z._components[id];
    item.controller = item.component.attach.call(item.component, item.$$, item.options);
    if ($z._nextComponentId == id.substr(1))
      $z._nextComponentId++;
    delete item.options;
  }
  
  return $z;
});