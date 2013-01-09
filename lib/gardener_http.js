var tako = require('tako')
  , async = require('async')
  , request = require('request')
  , url = require('url')
  , path = require('path')
  , natUpnp = require('nat-upnp')
  , dns = require('dns')
  , app = tako()
  , logger = require('./logger')
  , version = require('../package.json')
  , couch_root_url
  , port
  , host 
  , use_upnp
  , upnp_client;


exports.start = function(settings, callback) {
	couch_root_url = settings.couch_root_url;
	host = settings.host;
	port = settings.port || 25984;
	use_upnp = use_upnp || false;

	async.auto({
		externalIp : function(cb) {  externalIp(host, port, use_upnp, cb)  },
		router: function(cb) {  router(couch_root_url, port, cb)  },
		add_config: ['externalIp', 'router', function(cb, data){    
			data.couch_root_url = couch_root_url;
			add_config(data, cb);
		}]
	}, function(err, data) {
		callback(err, data);
	})
};


exports.add_app = function(route, port) {
	var dest_url = "http://localhost:" + port;
	logger.info('adding route ' + route);
	app.route(route + '/*', function(req, resp) {
		var headers = req.headers;
		headers['x-requested-url'] =  dest_url+req.url;
		request({uri: dest_url+req.url, headers: headers}).pipe(resp)
	})
	app.route(route, function (req, resp) {
		var headers = req.headers;
		headers['x-requested-url'] =  dest_url+req.url;				
		request({uri: dest_url+req.url, headers: headers}).pipe(resp)
	})	
}



function externalIp(host, port, use_upnp, callback) {
	// check for settings
	if (use_upnp) {
		upnp(port, port, function(err, details) {
			if (err) return callback(err);
			callback(null, details.ip);
		});
	} else {
		if (host) callback(null, host);
		require('dns').lookup(require('os').hostname(), function (err, add, fam) {
		  callback(null, add);
		})
	}
};



function upnp(internalport, externalport, callback) {
	upnp_client = natUpnp.createClient();
	logger.info('Using upnp to open firewall on port ' + externalport);
	upnp_client.portMapping({
	  public: externalport,
	  private: internalport,
	  ttl: '0'
	}, function(err) {
		if (err) return callback(err);
	  	upnp_client.externalIp(function(err, ip) {
	  		callback(null, {
	  			ip: ip,
	  			upnp_client : upnp_client
	  		});
		});
	});
}


function router(couch_route_url, port, callback) {
	
	// var session_url = url.resolve(couch_route_url, '_session');
	// example code for getting user information
	// app.route('/', function(req, resp) {
	//     request(session_url, {json:true, headers: req.headers}, function (e, r) {
	//       if (e) return resp.error(e)
	//       if (r.statusCode !== 200) return resp.error(r)
	//       resp.end('<html><head>cool</head><body>'+ JSON.stringify(r.body) +'</body></html>')
	//     })
	// })

	app.route('/').json(version);
	app.httpServer.listen(port);
	callback(null, port);
};


function add_config(data, callback) {
	var gardener_url = ['http://', data.externalIp, ':', data.router].join('');
	var value = '{couch_httpd_proxy, handle_proxy_req, <<"'+ gardener_url +'">>}',
		config_url = url.resolve(data.couch_root_url, '/_config/httpd_global_handlers/_gardener');


	request.get(config_url, function(err, body, val) {
		var current_val = JSON.parse(val);

		if (current_val && current_val.error == 'unauthorized') {
			logger.warn('unauthorized to change couchdb config');
			return callback('unauthorized');
		}

		if (current_val.error == 'not_found' || !is_config_match(current_val, value)) {

			logger.warn('Altering Couch config, adding httpd_global_handler', value);
		    request({uri: config_url, method: "PUT", body: JSON.stringify(value)}, function (err, resp, body) {
		        if (err) return callback('ahh!! ' + err);
		        restart_couch(data.couch_root_url, callback);	
		    })
		} else {
			callback()
		}
	}) 
};

function is_config_match(current, proposed) {
	// prob need a more robust equals, but works
	if (current == proposed) return true;
	return false;
}


function restart_couch(couch_root_url, callback) {
	var restart_url = url.resolve(couch_root_url, '/_restart'),
		empty = {};
	logger.warn('Restarting couchdb...');
    request({uri: restart_url, method: "POST", body: empty, json: true}, function (err, resp, body) {
        if (err) return callback('ahh!! ' + err);
        callback();
    })  	
}

