define ['require', 'zest'], (require, zest) ->
  # handle post requests to /component/moduleId, with JSON POST options
  globalHandler: (req, res, next) ->
    if req.method != 'POST'
      return next();

    if !(routeMatch = req.url.match /^\/render:(.*)/)
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
        res.writeHead(500, {
          'Content-Type': 'text/html'
        });
        res.end(err.toString());

