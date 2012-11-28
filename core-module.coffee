define ['require', 'zest'], (require, zest) ->
  routes:    
    '/component/{moduleId*}':
      structure:
        load: (o, render) ->
          require [o.moduleId], (com) ->
            o.com = com
            render()
          , (err) ->
            o.com = err.toString()
            render()
        render: (o) ->
          render: o.com
          options: o._query || {}

  # handle post requests to /component/moduleId, with JSON POST options
  handler: (req, res, next) ->
    if req.method != 'POST'
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
        zest.renderPage JSON.parse(postData.join('')), res
      , (err) ->
        zest.renderPage 
          structure: err.toString()
        , res

