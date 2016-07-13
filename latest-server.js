var express     = require('express');
var app         = express();
var bodyParser  = require('body-parser');
var morgan      = require('morgan');
var mongoose    = require('mongoose');
var passport	= require('passport');
var config      = require('./config'); // get db config file
var User        = require('./app/models/user'); // get the mongoose model
var Watch       = require('./app/models/watching'); // get the mongoose model
var WatchList   = require('./app/models/watchList'); // get the mongoose model
var port        = process.env.PORT || 9111;
var jwt         = require('jwt-simple');
var path        = require('path');
var webtorrent  = require('webtorrent');
var jwts    = require('jsonwebtoken'); // used to create, sign, and verify tokens
var omdb = require('omdb');
var ptn = require('parse-torrent-name');
var xtorrents = require('eztv.ag');
var forEachAsync = require('forEachAsync').forEachAsync;
 
app.set('superSecret', config.secret); // secret variable
// get our request parameters
app.use(bodyParser.urlencoded({ extended: false }));
app.use(bodyParser.json());
 
// log to console
app.use(morgan('dev'));
 
// Use the passport package in our application
app.use(passport.initialize());
 
// connect to database
mongoose.connect(config.database);
 
// pass passport for configuration
require('./passport')(passport);

var getLargestFile = function (torrent) {
    var file;
    for(i = 0; i < torrent.files.length; i++) {
        if (!file || file.length < torrent.files[i].length) {
            file = torrent.files[i];
        }
    }
    return file;
};

var client = new webtorrent();

var torrents=[];

var setClientAmount = function(torrent) {
	torrents.push({[torrent]:0});
	console.log(torrents);
};

var updateClientAmount = function(torrent) {
	torrents[0][torrent]=torrents[0][torrent]+1;
	console.log(torrents);
};

var removeClientAmount = function(torrent) {
	torrents[0][torrent]=torrents[0][torrent]-1;
	console.log(torrents);
};

var buildMagnetURI = function(infoHash) {
    return 'magnet:?xt=urn:btih:' + infoHash + '&tr=udp%3A%2F%2Ftracker.publicbt.com%3A80&tr=udp%3A%2F%2Ftracker.openbittorrent.com%3A80&tr=udp%3A%2F%2Ftracker.ccc.de%3A80&tr=udp%3A%2F%2Ftracker.istole.it%3A80&tr=udp%3A%2F%2Fopen.demonii.com%3A1337&tr=udp%3A%2F%2Ftracker.coppersurfer.tk%3A6969&tr=udp%3A%2F%2Fexodus.desync.com%3A6969';
};
 
// bundle our routes
var apiRoutes = express.Router();

// Allow Cross-Origin requests
app.use(function(req, res, next) {
    res.header('Access-Control-Allow-Origin', '*');
    res.header('Access-Control-Allow-Methods', 'OPTIONS, POST, GET, PUT, DELETE');
    res.header('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept');
    next();
});

app.use(express.static(path.join(__dirname, 'app')));
 
// demo Route (GET http://localhost:8080)
apiRoutes.get('/', passport.authenticate('jwt', { session: false }), function(req, res) {
  res.send('Hello! The API is at http://localhost:' + port + '/api');
});

// create a new user account (POST http://localhost:8080/api/signup)
apiRoutes.post('/myList', function(req, res) {
    var newItem = new WatchList({
	  user_id: req.body.user_id,
      movie_id: req.body.movie_id
    });
    // save the user
    newItem.save(function(err) {
      if (err) {
        return res.json({success: false, msg: 'Username already exists.'});
      }
      res.json({success: true, msg: 'Successful created new user.'});
    });
});

// create a new user account (POST http://localhost:8080/api/signup)
apiRoutes.post('/signup', function(req, res) {
  if (!req.body.name || !req.body.password) {
    res.json({success: false, msg: 'Please pass name and password.'});
  } else {
    var newUser = new User({
      name: req.body.name,
      password: req.body.password
    });
    // save the user
    newUser.save(function(err) {
      if (err) {
        return res.json({success: false, msg: 'Username already exists.'});
      }
      res.json({success: true, msg: 'Successful created new user.'});
    });
  }
});
 
 // route to authenticate a user (POST http://localhost:8080/api/authenticate)
apiRoutes.post('/authenticate', function(req, res) {
  User.findOne({
    name: req.body.name
  }, function(err, user) {
    if (err) throw err;
 
    if (!user) {
      res.send({success: false, msg: 'Authentication failed. User not found.'});
    } else {
      // check if password matches
      user.comparePassword(req.body.password, function (err, isMatch) {
        if (isMatch && !err) {
			var token = jwt.encode(user, config.secret);
			
			Watch.find({ user_id: req.body.name }, function(err, watching) {
				if(watching){
					WatchList.find({ user_id: req.body.name }, function(err, list) {
						if(list){
							res.json({success: true, token: token, watch: watching, watchList: list});
						}else{
							json({success: true, token: token, watch: watching});
						}
						if(err){
							console.log("error loading MyList data");
						}
					})
				}
				else{
					WatchList.find({ user_id: req.body.name }, function(err, list) {
						if(list){
							res.json({success: true, token: token, watchList: list});
						}else{
							json({success: true, token: token});
						}
						if(err){
							console.log("error loading MyList data");
						}
					})
				}
				if(err){
					console.log("error loading watching data");
					res.json({success: true, token: token});
				}
				
			  });
        } else {
          res.send({success: false, msg: 'Authentication failed. Wrong password.'});
        }
      });
    }
  });
});

apiRoutes.use(function(req, res, next) {

  // check header or url parameters or post parameters for token
  var token = req.body.token || req.query.token || req.headers['x-access-token'];

  // decode token
  if (token) {

    // verifies secret and checks exp
    jwts.verify(token, app.get('superSecret'), function(err, decoded) {      
      if (err) {
        return res.json({ success: false, message: 'Failed to authenticate token.' });    
      } else {
        // if everything is good, save to request for use in other routes
        req.decoded = decoded;    
        next();
      }
    });

  } else {

    // if there is no token
    // return an error
    return res.status(403).send({ 
        success: false, 
        message: 'No token provided.' 
    });
    
  }
});

apiRoutes.get('/add/:infoHash', function(req, res) {
    if(typeof req.params.infoHash == 'undefined' || req.params.infoHash == '') {
        //res.json(500).send('Missing infoHash parameter!'); return;
		return res.json({success: false, msg: 'Missing infoHash parameter!'});
    }
    var torrent = buildMagnetURI(req.params.infoHash);
	if(client.get(torrent)){
		updateClientAmount(req.params.infoHash);
		//res.status(200).send('Added torrent!');
		res.json({success: true, msg: 'Torrent Added!'});
	}
	else{
		try {
			setClientAmount(req.params.infoHash);
			client.add(torrent, function (torrent) {
				var file = getLargestFile(torrent);
				torrent.on('upload', function() {
					if(torrent.length == torrent.downloaded) {
						torrent.destroy();
						torrent.discovery.stop();
					}
				});
				//res.status(200).send('Added torrent!');
				res.json({success: true, msg: 'Torrent added!'});
			});
		} catch (err) {
			//res.status(500).send('Error: ' + err.toString());
			res.json({success: false, msg: + err.toString()});
		}
	}
});

apiRoutes.get('/get-shows', function(req, res, next) {
	var tv_series=[];
	function getDetails(item,cb){
		console.log('getDetails');
		if(item){
			omdb.get({ title: item.title }, true, function(err, movie) {
				if(err) {
					console.error(err);
					cb();
				}
			 
				if(!movie) {
					console.log('Movie not found!');
					cb();
				}
				if(movie && !err){
					console.log('%s (%d) %d/10', movie.title, movie.year, movie.imdb.rating);
					tv_series.push(movie);
					cb();
				}
			});
		}
	}
	xtorrents.series().then(function(series) {
		series.length=10;
		forEachAsync(series, function (next, element, index, array) {
			getDetails(element,next);
		}).then(function () {
			res.json({success: true, shows: tv_series});
		});
	});
});
apiRoutes.get('/tv-shows/:show/:season', function(req, res, next) {
	console.log('getting ' + req.params.show);
	var episodes = {};
	var obj = {};

	function getDetails(item,cb){
		if(item){
			console.log(item.title);
			var torn = ptn(item.title);
			if(!obj[torn.season]){
				obj[torn.season] = [];
			}
			omdb.get({ title: torn.title, season: torn.season, episode: torn.episode }, true, function(err, movie) {
				if(err) {
					console.error(err);
					cb();
				}
			 
				if(!movie) {
					console.log('Movie not found!');
					cb();
				}
				if(movie && !err){
					movie.link = item.link;
					movie.magnet = item.magnet;
					movie.hash = item.hash;
					movie.size = item.size;
					obj[movie.season].push(movie);
					cb();
				}
			});
		}else{
			res.json({status: true, episodes: obj});
		}
	}
	var episodeList = [];
	xtorrents.search(req.params.show)
		.then(function(torrent){
			forEachAsync(torrent, function (next, element, index, array) {
				var getItem = ptn(element.title)
				episodeList.forEach(function(value){
					if(getItem.episode===value){
						consoole.log(value);
					}else{
						episodeList.push(getItem.episode);
						console.log(getItem);
						getDetails(element, next, index);
					}
				})
		}).then(function () {
			res.json({status: true, episodes: obj});
		});
	});
});

apiRoutes.get('/stream/:infoHash.mp4', function(req, res, next) {
    if(typeof req.params.infoHash == 'undefined' || req.params.infoHash == '') {
        //res.status(500).send('Missing infoHash parameter!'); return;
		return res.json({success: false, msg: 'Missing infoHash parameter!'});
    }
    var torrent = buildMagnetURI(req.params.infoHash);
    try {
        var torrent = client.get(torrent);
        var file = getLargestFile(torrent);
        var total = file.length;

        if(typeof req.headers.range != 'undefined') {
            var range = req.headers.range;
            var parts = range.replace(/bytes=/, "").split("-");
            var partialstart = parts[0];
            var partialend = parts[1];
            var start = parseInt(partialstart, 10);
            var end = partialend ? parseInt(partialend, 10) : total - 1;
            var chunksize = (end - start) + 1;
        } else {
            var start = 0; var end = total;
        }

        var stream = file.createReadStream({start: start, end: end});
        res.writeHead(206, { 'Content-Range': 'bytes ' + start + '-' + end + '/' + total, 'Accept-Ranges': 'bytes', 'Content-Length': chunksize, 'Content-Type': 'video/mp4' });
		stream.pipe(res);
    } catch (err) {
        //res.status(500).send('Error: ' + err.toString());
		res.json({success: false, msg: + err.toString()});
    }
});


apiRoutes.get('/delete/:infoHash/:user_id/:movie_id/:current/:status', function(req, res, next) {
    if(typeof req.params.infoHash == 'undefined' || req.params.infoHash == '') {
        //res.status(500).send('Missing infoHash parameter!'); return;
		return res.json({success: false, msg: 'Missing infoHash parameter!'});
    }
	console.log(req.params.user_id);
    var torrent = buildMagnetURI(req.params.infoHash);
	console.log(req.params.movie_id);
	// save the user
    Watch.findOneAndUpdate({user_id: req.params.user_id, movie_id: req.params.movie_id}, {$set:{current:req.params.current}}, {new: true}, function(err, doc){
		if(err){
			console.log('Error occured.');
		}else{
			if(doc===null){
				console.log('creating');
				var newWatch = new Watch({
				  user_id: req.params.user_id,
				  movie_id: req.params.movie_id,
				  current: req.params.current,
				  infoHash: req.params.infoHash,
				  status: req.params.status
				});
				newWatch.save(function(err) {
				  if (err) {
					console.log('Error creating item');
				  }else{
					console.log('Successfully created new item.');
				  }
				});
			}else{
				console.log('Successfully updated item.');
			}
		}
	});
	if(req.params.infoHash[0][req.params.infoHash]===0){
		try {
			var torrent = client.remove(torrent);
			//res.status(200).send('Removed torrent. ');
			res.json({success: true, msg: 'Torrent removed'});
		} catch (err) {
			//res.status(500).send('Error: ' + err.toString());
			res.json({success: false, msg: + err.toString()});
		}
	}
	else{
		removeClientAmount(req.params.infoHash);
		//res.status(200).send('Removed torrent. ');
		res.json({success: true, msg: 'Torrent removed'});
	}
});
// connect the api routes under /api/*
app.use('/api', apiRoutes);
 
// Start the server
app.listen(port);
console.log('There will be dragons: http://localhost:' + port);
