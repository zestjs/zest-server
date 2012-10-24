define ['zest', 'require'], ($z, require) ->
  (config) ->
    routes:
      # @ = canonical alias
      '/component/{moduleId*}': (o, render) ->
        require [o.moduleId], (com) ->
          render
            component: com
            options: o._queryParams || {}
        , (err) ->
          render [err.toString()]
    
    handler: (req, res, next) ->
      # req.htmlOptions.main = 'test'
      # req.htmlOptions.layers = []
      next();