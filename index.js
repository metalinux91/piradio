const io = require('socket.io-client');
const Player = require('player');
const pharmacy = require('/boot/pharmacy.json');

// const socket = io('http://192.168.2.104:9012', { path: '/piradio' });
const socket = io('https://servicos.maisfarmacia.org', { path: '/piradio' });

let player;
let playlist;
let connected = false;
let playing = false;
let paused = false;
let busy = false;
let interval = null;
let fetchingSong = false;

function playerLogs () {
  // event: on playend
  player.on('playend', function(item) {
    console.log(pharmacy.ANF + ': play done, switching to next one...');
  });

  // event: on playing
  player.on('playing', function(item) {
    fetchingSong = false;
    console.log(pharmacy.ANF + ': playing ' + item._name);
    socket.emit('playing', pharmacy.ANF, item);
  });

  // event: on error
  player.on('error', function(err) {
    // when error occurs
    if (err.toString() === 'No next song was found') {
      console.log('Reached end of playlist. Restarting...');
      socket.emit('playlistEnd', pharmacy.ANF, playlist);
    } else {
      console.log({ pharmacy: pharmacy.ANF, message: err });
    }
  });
}

// event: on connect
socket.on('connect', () => {
  console.log(pharmacy.ANF + ': Connected to main server');
  connected = true;

  if (interval !== null) {
    clearInterval(interval);
  }

  // inform the server, so that the server may assign it to its particular room
  socket.emit('joinRoom', pharmacy.ANF);
});

// event: on disconnect
socket.on('disconnect', () => {
  console.log(pharmacy.ANF + ': Disconnected from server. Trying to reconnect...');

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
    console.log(pharmacy.ANF + ': is still fetching song to play...');
    return;
  }

  if (playing) {
    console.log(pharmacy.ANF + ': received request to play from server. Restarting playlist or playing new one from the beginning'); 
  } else {
    console.log(pharmacy.ANF + ': received request to play from server');
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

  busy = true;
  setTimeout(() => {
    busy = false; 
  }, 3000);

  // log activity
  playerLogs();

  /*
  if (msg.skip > 0) {
    for (var i = 0; i < msg.skip; i++) {
      setTimeout(function() {
        player.next();
      }, 2000 * i);
    }
  }
  */
});

// event: on stop
socket.on('stop', (msg) => {
  if (!playing) {
    console.log(pharmacy.ANF + ': received request to stop from server, but was already stopped');
  } else {
    console.log(pharmacy.ANF + ': received request to stop from server');

    playing = false;
    player.stop();

    busy = true;
    setTimeout(function() {
      busy = false; 
    }, 3000);
  }
});

// event: on pause
socket.on('pause', (msg) => {
  if (paused) {
    console.log(pharmacy.ANF + ': received request to pause from server, but was already paused');

    paused = true;
  } else {
    console.log(pharmacy.ANF + ': received request to pause from server');

    paused = true;
    player.pause();

    busy = true;
    setTimeout(function() {
      busy = false; 
    }, 3000);
  }
});

// event: on resume
socket.on('resume', (msg) => {
  if (!paused) {
    console.log(pharmacy.ANF + ': received request to resume from server, but was already playing');
  } else {
    console.log(pharmacy.ANF + ': received request to resume from server');

    paused = false;
    player.pause();

    busy = true;
    setTimeout(function() {
      busy = false; 
    }, 3000);
  }

  // playerLogs(player);
});

// event: on next
socket.on('next', (msg) => {
  if (fetchingSong) {
    console.log(pharmacy.ANF + ': is still fetching song to play...');
    return;
  }

  console.log(pharmacy.ANF + ': received request to skip from server');

   // resume the player when switching to the next song
   if (paused) paused = false;

   fetchingSong = true;
   player.next();

   busy = true;
   setTimeout(function() {
     busy = false; 
   }, 3000);
});

// event: on shuffle
// socket.on('shuffle', (msg) => {
//   console.log(pharmacy.ANF + ': received request to shuffle from server');
// 
//   if (player !== undefined) {
//     player.stop();
//   }
//   
//   player = new Player(playlist);
// 
//   playing = true;
//   player.play();
// });

socket.on('shuffle', (msg) => {
  if (fetchingSong) {
    console.log(pharmacy.ANF + ': is still fetching song to play...');
    return;
  }

  if (playing) {
    console.log(pharmacy.ANF + ': received request to play from server. Restarting playlist or playing new one from the beginning'); 
  } else {
    console.log(pharmacy.ANF + ': received request to play from server');
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

  busy = true;
  setTimeout(() => {
    busy = false; 
  }, 3000);

  // log activity
  playerLogs();

  /*
  if (msg.skip > 0) {
    for (var i = 0; i < msg.skip; i++) {
      setTimeout(function() {
        player.next();
      }, 2000 * i);
    }
  }
  */
});

