const https = require('https');
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const io = require('socket.io-client');
const mpv = require('node-mpv');
const getSize = require('get-folder-size');

const mpvPlayer = new mpv({
  audio_only: true,
  debug: true,
  verbose: true
}, ['--loop=inf', '--no-config', '--load-scripts=no']);

const pharmacy = require('/boot/pharmacy.json');

// const socket = io('http://192.168.2.104:9012', { path: '/piradio' });
const socket = io('https://servicos.maisfarmacia.org', { path: '/piradio' });

let connected = false;
let playing = false;
let interval = null;
const amixerArray = ['-c', '0', '--', 'sset', 'PCM', 'playback'];

// helper function that gets the songs from the url
function httpGet(url) {
  return new Promise((resolve, reject) => {
    https.get(url, (res) => {
      switch(res.statusCode) {
      case 200:
        resolve(res);
        break;
      case 302: // redirect
        resolve(httpGet(res.headers.location));
        break;
      default:
        reject(`Failed to fetch song at ${url}`);
      }
    });
  });
}

// this function recursively lists files in a directory
const listFiles = (dir, done) => {
  let results = [];

  fs.readdir(dir, (err, list) => {
    if (err) return done(err);

    let pending = list.length;
    if (!pending) return done (null, results);

    list.forEach((file) => {
      file = path.resolve(dir, file);
      fs.stat(file, (err, stat) => {
        if (stat && stat.isDirectory()) {
          listFiles(file, (err, res) => {
            results = results.concat(res);
            if (!--pending) done(null, results);
          });
        } else {
          results.push(file);
          if (!--pending) done(null, results);
        }
      });
    });
  });
};

// determine whether to delete whole cache or not based on cache size
let deleteAll = false;
fs.stat('../cache', (err) => {
  if (!err) {
    getSize('../cache', (err, size) => {
      if (err) {
        console.error(err);
        process.exit();
      } else if (size > 4000000000) {
        deleteAll = true;
      }
    });
  }
});

// since the process is restarted everyday by a system cronjob
// remove the songs that have been cached over a month on restart
// or if the cache size exceeds 4GB
fs.stat('../cache', (err) => {
  if (!err) {
    listFiles('../cache', (err, files) => {
      files.forEach((file) => {
        fs.stat(file, (err, stat) => {
          if (err) {
            console.error(err);
          } else {
            const { birthtime } = stat;
            const now = new Date();

            if (deleteAll || now.getMonth() - birthtime.getMonth() > 0) {
              try {
                fs.unlinkSync(file);
              } catch (error) {
                console.error(error);
              }
            }
          }
        });
      });
    });
  }
});

// event: started
mpvPlayer.on('started', async () => {
  playing = true;
  const songName = await mpvPlayer.getProperty('media-title');
  const songPath = await mpvPlayer.getProperty('path');
  console.log(`${pharmacy.ANF}: playing ${songName}`);

  // emit info to server so that pharmacy radio data is updated
  socket.emit('playing', pharmacy.ANF, { src: songPath });

  // if about to play a commercial, raise the volume, otherwise lower it
  if (songName.indexOf('Spot') !== -1) {
    spawn('amixer', [...amixerArray, '-1dB']);
  } else {
    spawn('amixer', [...amixerArray, '-3dB']);
  }

  // If the song is not cached and there are less than 4GB of cached songs, cache it
  if (songPath.indexOf('http') !== -1) {
    fs.stat('../cache', (err) => {
      if (err) {
        fs.mkdirSync('../cache');
      }

      getSize('../cache', async (err, size) => {
        if (err) {
          console.error(err);
        } else  if (size < 4000000000) {
          const playlistDir = `../cache/${songPath.split('/')[4]}`;
          if (!fs.existsSync(playlistDir)) fs.mkdirSync(playlistDir);

          const songFile = fs.createWriteStream(`${playlistDir}/${await mpvPlayer.getProperty('filename')}`);
          httpGet(songPath)
            .then(response => response.pipe(songFile))
            .catch((err) => {
              fs.unlinkSync(`${playlistDir}/${songName}`);
              console.error(err);
              if (err.message.indexOf('Failed') === -1) {
                process.exit();
              }
            });
        }
      });
    });
  }
});

// when playback events occurs, inform server so that database info is updated
mpvPlayer.on('paused', () => socket.emit('paused', pharmacy.ANF));
mpvPlayer.on('stopped', () => socket.emit('stopped', pharmacy.ANF));
mpvPlayer.on('resumed', () => socket.emit('resumed', pharmacy.ANF));

// event: on connect
socket.on('connect', () => {
  console.log(`${pharmacy.ANF}: Connected to main server`);
  connected = true;

  if (interval !== null) {
    clearInterval(interval);
  }

  // inform the server, so that it may assign it to its particular room
  socket.emit('joinRoom', pharmacy.ANF);
});

// event: on disconnect
socket.on('disconnect', () => {
  console.log(`${pharmacy.ANF}: Disconnected from server. Trying to reconnect...`);
 
  connected = false;

  // try to reconnect to the server
  socket.open();
  
  // until the device has reconnected, try to connect every 5 seconds
  interval = setInterval(() => {
    if (!connected) socket.open();
  }, 5000);
});

// event: on play
socket.on('play', (msg) => {
  if (playing) {
    console.log(`${pharmacy.ANF}: received request to play from server. Restarting playlist or playing new one from the beginning`); 
  } else {
    console.log(`${pharmacy.ANF}: received request to play from server`);
  }

  // build a playlist where the URL of a song is a file if it is cached or an URL otherwise
  playlist = msg.playlist;
  const finalPlaylist = [];
  msg.playlistLocal.forEach((url, index) => {
    try {
      if (fs.statSync(url).size === 0) { // if the file does not exist or is empty
        finalPlaylist.push(msg.playlist[index]);
      } else {
        finalPlaylist.push(url);
      }
    } catch (err) { // don't know why try catch. Find out and leave comment with reason why
      finalPlaylist.push(msg.playlist[index]);
    }
  });

  // mpv must be fed a file as playlist so it is necessary to generate a file with a URL per line
  for (let i = 0; i < finalPlaylist.length; i +=1) {
    try {
      fs.appendFileSync('./tmpPlaylist.txt', `${finalPlaylist[i]}\n`);
    } catch (e) {
      console.error(e.toString());
      process.exit();
    }
  }

  playing = false;
  mpvPlayer.loadPlaylist('./tmpPlaylist.txt');
  mpvPlayer.play();

  // if after receiving an order to play, playback has not started, try it again, every 15 seconds
  const intervalId = setInterval(() => {
    if (playing) {
      try {
        fs.unlinkSync('./tmpPlaylist.txt');
      } catch (e) {
        console.error(e.toString());
      }     

      clearInterval(intervalId);
      return;
    }

    mpvPlayer.loadPlaylist('./tmpPlaylist.txt');
    mpvPlayer.play();
  }, 15000);
});

// event: on stop
socket.on('stop', () => {
  if (!playing) {
    console.log(`${pharmacy.ANF}: received request to stop from server, but was already stopped`);
  } else {
    console.log(`${pharmacy.ANF}: received request to stop from server`);
  }

  playing = false;
  if (interval !== null) clearInterval(interval);
  mpvPlayer.stop();
  mpvPlayer.clearPlaylist();
});

// event: on pause
socket.on('pause', () => {
  console.log(`${pharmacy.ANF}: received request to pause from server`);

  try {
    mpvPlayer.pause();
    if (interval !== null) clearInterval(interval);
  } catch (error) {
    console.error(error.toString());
    process.exit();
  }
});

// event: on resume
socket.on('resume', () => {
  console.log(`${pharmacy.ANF}: received request to resume from server`);

  paused = false;

  try {
    mpvPlayer.resume();
  } catch (error) {
    console.error(error.toString());
    process.exit();
  }
});

// event: on next
socket.on('next', () => {
  console.log(`${pharmacy.ANF}: received request to skip from server`);

  mpvPlayer.next();
  mpvPlayer.play();
});


// comments that applied to "socket.on('play')" are applied here
socket.on('shuffle', (msg) => {
  if (playing) {
    console.log(`${pharmacy.ANF}: received request to play from server. Restarting playlist or playing new one from the beginning`); 
  } else {
    console.log(`${pharmacy.ANF}: received request to play from server`);
  }

  playlist = msg.playlist;
  const finalPlaylist = [];

  msg.playlistLocal.forEach((url, index) => {
    try {
      if (fs.statSync(url).size === 0) {// if the file does not exist or is empty
        finalPlaylist.push(msg.playlist[index]);
      } else {
        finalPlaylist.push(url);
      }
    } catch (err) {
      finalPlaylist.push(msg.playlist[index]);
    }
  });

  for (let i = 0; i < finalPlaylist.length; i +=1) {
    try {
      fs.appendFileSync('./tmpPlaylist.txt', `${finalPlaylist[i]}\n`);
    } catch (e) {
      console.error(e.toString());
      process.exit();
    }
  }

  playing = false;
  mpvPlayer.loadPlaylist('./tmpPlaylist.txt');
  mpvPlayer.play();

  const intervalId = setInterval(() => {
    if (playing) {
      try {
        fs.unlinkSync('./tmpPlaylist.txt');
      } catch (e) {
        console.error(e.toString());
      }     

      clearInterval(intervalId);
      return;
    }

    mpvPlayer.loadPlaylist('./tmpPlaylist.txt');
    mpvPlayer.play();
  }, 15000);
});

