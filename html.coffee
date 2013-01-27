###
  zest HTML template,
  based on the HTML5 boilerplate
###

define ['zest', 'zest-server'], ($z, zest) ->

  title: ''
  scripts: []
  requireConfig: {}
  requireUrl: ''
  requireMain: ''
  lang: ''

  _extend:
    load: $z.extend.makeChain('ASYNC')
    options: 'APPEND'
    render: 'REPLACE'
    titleRegion: 'DEFINE'

    title: 'REPLACE'
    scripts: 'ARR_APPEND'
    requireConfig: 'DAPPEND'
    requireUrl: 'REPLACE'
    requireMain: 'REPLACE'
    lang: 'REPLACE'
    meta: 'APPEND'
    footer: 'APPEND'

  load: (o) ->
    o.title = @title
    @langAttr = if @lang
      """
       lang="#{$z.esc o.lang, 'attr'}"
      """ 
    else ""
  
  render: (o) -> 
    """
    <!DOCTYPE html>
    <!--[if lt IE 7]>      <html class="lt-ie9 lt-ie8 lt-ie7"#{@langAttr}> <![endif]-->
    <!--[if IE 7]>         <html class="lt-ie9 lt-ie8"#{@langAttr}> <![endif]-->
    <!--[if IE 8]>         <html class="lt-ie9"#{@langAttr}> <![endif]-->
    <!--[if gt IE 8]><!--> <html#{@langAttr}> <!--<![endif]-->
    <head>
      <meta charset="utf-8">
      <meta http-equiv="X-UA-Compatible" content="IE=edge,chrome=1">
      {`titleRegion`}
      {`meta`}
      <script type='text/javascript'>var require = #{JSON.stringify(@requireConfig)};</script>
      <script type='text/javascript' src='#{@requireUrl}' data-main='#{@requireMain}'></script>
      
      #{ "<script type='text/javascript' src='#{@requireConfig.baseUrl}/" + $z.esc(script, 'url') + "'></script>" for script in @scripts }
    </head>
    <body>{`body`}</body>
    {`footer`}
    </html>
    """
  
  ###
    Deferred Title Support
    - If this.title != null, the title is directly rendered into the template as text.
    - If this.title == null, then a global option o.global.setTitle is created
    - The title region will block page rendering until o.global.setTitle is called.
    - In the mean time, body rendering will be made into a buffer,
      allowing for any sub-component to set the page title.
    - If this.global.setTitle is never called and title == null, the app will hang.
  ###
  titleRegion: (o) ->
    options:
      title: o.title
    load: (o, done) ->
      if o.title != null
        return done()
      o.global.setTitle = (title) ->
        o.title = title
        done()
    render: (o) -> "<title>#{$z.esc(o.title, 'htmlText')}</title>"
