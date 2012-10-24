define(['http', 'url'], function(http, urlParser) {
  return {
    headers: {},
    setHeader: function(header, value) {
      this.headers[header] = value;
    },
    send: function(method, url, headers, data, callback, errback) {
      if (typeof data == 'function') {
        callback = data;
        data = undefined;
      }
      callback = callback || function(){}
      
      var str_data = JSON.stringify(data);
      var requestOptions = urlParser.parse(url);
      
      requestOptions.headers = headers;
      for (var header in this.headers)
        requestOptions.headers[header] = this.headers[header];
      requestOptions.headers['Content-Length'] = str_data != undefined ? str_data.length : 0
      
      requestOptions.method = method;
      
      var _data = [];
      var _req = http.request(requestOptions, function(_res) {
        _res.setEncoding('utf8');
        _res.on('data', function (chunk) {
          _data.push(chunk);
        });
        _res.on('end', function() {
          try {
            _data = JSON.parse(_data.join(''));
          }
          catch (e) {
            errback('Unable to parse JSON response.');
            return;
          }
          callback(_data);
        });
      });
      _req.on('error', errback);
      _req.end(str_data);
    },
    get: function(url, headers, callback, errback) {
      //headers argument optional
      if (typeof headers == 'function') {
        errback = callback;
        callback = headers;
        headers = {};
      }
      this.send('GET', url, headers, null, callback, errback);
    },
    post: function(url, headers, data, callback, errback) {
      //headers argument optional
      if (typeof headers == 'function') {
        errback = callback;
        callback = headers;
        headers = {};
      }
      this.send('POST', url, headers, data, callback, errback);
    }
  };
});


