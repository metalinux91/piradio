const https = require('https');
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const io = require('socket.io-client');
const Player = require('player');
const getSize = require('get-folder-size');

const pharmacy = require('/boot/pharmacy.json');

// const socket = io('http://192.168.2.104:9012', { path: '/piradio' });
const socket = io('https://servicos.maisfarmacia.org', { path: '/piradio' });

let player;
let playlist;
let connected = false;
let playing = false;
let paused = false;
let interval = null;
let fetchingSong = false;
const amixerArray = ['-c', '0', '--', 'sset', 'PCM', 'playback'];

// helper function that gets the songs from the url
function httpGet(url) {
  return new Promise((resolve) => {
    https.get(url, (res) => {
      switch(res.statusCode) {
      case 200:
        resolve(res);
        break;
      case 302: // redirect
        resolve(httpGet(res.headers.location));
        break;
      default:
        resolve();
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

// since the process is restarted everyday by a system cronjob
// remove the songs that have been cached over a month on restart
fs.stat('../cache', (err, stat) => {
  if (!err) {
    listFiles('../cache', (err, files) => {
      files.forEach((file) => {
        fs.stat(file, (err, stat) => {
          if (err) {
            console.error(err);
          } else {
            const { birthtime } = stat;
            const now = new Date();
  
            if (now.getMonth() - birthtime.getMonth() > 0) {
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

function playerLogs () {
  // event: on playend
  player.on('playend', () => {
    console.log(`${pharmacy.ANF}: play done, switching to next one...`);
  });

  // event: on playing
  player.on('playing', (item) => {
    fetchingSong = false;
    console.log(`${pharmacy.ANF}: playing ${item._name}`);
    socket.emit('playing', pharmacy.ANF, item);

    // if about to play a commercial, raise the volume, otherwise lower it
    if (item._name.indexOf('Spot') !== -1) {
      spawn('amixer', [...amixerArray, '-1dB']);
    } else {
      spawn('amixer', [...amixerArray, '-3dB']);
    }

    // If the song is not cached and there are less than 5GB of cached songs, cache it
    if (item.src.indexOf('http') !== -1) {
      fs.stat('../cache', (err, stat) => {
        if (err) {
          fs.mkdirSync('../cache');
        }

        getSize('../cache', (err, size) => {
          if (err) {
            console.error(err);
          } else  if (size < 5000000000) {
            const playlistDir = `../cache/${item.src.split('/')[4]}`;
            if (!fs.existsSync(playlistDir)) fs.mkdirSync(playlistDir);
  
            const songFile = fs.createWriteStream(`${playlistDir}/${item._name}`);
            httpGet(item.src)
              .then(response => response.pipe(songFile))
              .catch((err) => {
                console.error(err);
                process.exit();
              });
          }
        });
      });
    }
  });

  // event: on error
  player.on('error', (err) => {
    // when error occurs
    if (err.toString() === 'No next song was found') {
      console.log('Reached end of playlist. Restarting...');
      socket.emit('playlistEnd', pharmacy.ANF, playlist);
    } else {
      console.log({ pharmacy: pharmacy.ANF, message: err });
      process.exit();
    }
  });
}

// event: on connect
socket.on('connect', () => {
  console.log(`${pharmacy.ANF}: Connected to main server`);
  connected = true;

  if (interval !== null) {
    clearInterval(interval);
  }

  // inform the server, so that the server may assign it to its particular room
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
    if (!connected) {
      socket.open();
    }
  }, 5000);
});

// event: on play
socket.on('play', (msg) => {
  if (fetchingSong) {
    console.log(`${pharmacy.ANF}: is still fetching song to play...`);
    return;
  }

  if (playing) {
    console.log(`${pharmacy.ANF}: received request to play from server. Restarting playlist or playing new one from the beginning`); 
  } else {
    console.log(`${pharmacy.ANF}: received request to play from server`);
  }

  playlist = msg.playlist;

  // if the device is already playing, stop
  if (player !== undefined) {
    player.stop();
  }

  const finalPlaylist = [];

  msg.playlistLocal.forEach((url, index) => {
    try {
      fs.statSync(url);
      finalPlaylist.push(url);
    } catch (err) {
      finalPlaylist.push(msg.playlist[index]);
    }
  });

  player = new Player(finalPlaylist);

  fetchingSong = true;
  playing = true;
  player.play();

  // log activity
  playerLogs();
});

// event: on stop
socket.on('stop', () => {
  if (!playing) {
    console.log(`${pharmacy.ANF}: received request to stop from server, but was already stopped`);
  } else {
    console.log(`${pharmacy.ANF}: received request to stop from server`);

    playing = false;
    player.stop();
  }
});

// event: on pause
socket.on('pause', () => {
  if (paused) {
    console.log(`${pharmacy.ANF}: received request to pause from server, but was already paused`);

    paused = true;
  } else {
    console.log(`${pharmacy.ANF}: received request to pause from server`);

    paused = true;
    player.pause();
  }
});

// event: on resume
socket.on('resume', () => {
  if (!paused) {
    console.log(`${pharmacy.ANF}: received request to resume from server, but was already playing`);
  } else {
    console.log(`${pharmacy.ANF}: received request to resume from server`);

    paused = false;
    player.pause();
  }
});

// event: on next
socket.on('next', () => {
  if (fetchingSong) {
    console.log(`${pharmacy.ANF}: is still fetching song to play...`);
    return;
  }

  console.log(`${pharmacy.ANF}: received request to skip from server`);

  // resume the player when switching to the next song
  if (paused) paused = false;

  fetchingSong = true;

  /**
   * since the player only stops the song that's currently being played
   * shortly after skipping to the next one (thus causing overlap)
   * pause it and set a timeout before skipping
   */
  player.pause();
  setTimeout(() => player.next(), 2000);
});


socket.on('shuffle', (msg) => {
  if (fetchingSong) {
    console.log(`${pharmacy.ANF}: is still fetching song to play...`);
    return;
  }

  if (playing) {
    console.log(`${pharmacy.ANF}: received request to play from server. Restarting playlist or playing new one from the beginning`); 
  } else {
    console.log(`${pharmacy.ANF}: received request to play from server`);
  }

  playlist = msg.playlist;

  // if the device is already playing, stop
  if (player !== undefined) {
    player.stop();
  }

  player = new Player(playlist);

  fetchingSong = true;
  playing = true;
  player.play();

  // log activity
  playerLogs();
});

