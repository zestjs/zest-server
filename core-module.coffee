define ['require'], (require) ->
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