define ['require', 'zest'], (require, zest) ->
  routes:    
    '/component/{moduleId*}':
      load: (o, done) ->
        require [o.moduleId], (com) ->
          o.com = com
          done()
        , (err) ->
          o.com = err.toString()
          done()
      body: (o) ->
        render: o.com
        options: o._query

  # handle post requests to /component/moduleId, with JSON POST options
  globalHandler: (req, res, next) ->
    if req.method != 'POST' && req.method != 'GET'
      return next();

    if !(routeMatch = req.url.match /^\/component\/(.*)/)
      return next();

    moduleId = routeMatch[1]

    postData = []
    req.on 'data', (chunk) ->
      postData.push(chunk)
      if postData.length > 1e4
        res.writeHead(413, {'Content-Type': 'text/html'});
        req.connection.destroy()

    req.on 'end', () ->
      require [moduleId], (com) ->
        zest.render com, JSON.parse(postData.join('')), res
      , (err) ->
        res.writeHead(404, {
          'Content-Type': 'text/html'
        });
        res.end('Component not found.');

