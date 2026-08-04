const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: "*" }
});

const { MongoClient } = require('mongodb');
// Берем ссылку на БД из переменных окружения (или используем локальную для тестов)
const MONGO_URI = process.env.MONGO_URI || "mongodb://127.0.0.1:27017/rulimony";
let db;

// Подключение к MongoDB
MongoClient.connect(MONGO_URI)
  .then(client => {
    db = client.db('rulimony');
    console.log('Подключено к MongoDB');
  })
  .catch(err => console.error('Ошибка подключения к БД:', err));

// Указываем серверу раздавать файлы из папки, где лежит игра
app.use(express.static(path.join(__dirname, './')));


// --- WORLD STATE ---
let worldState = {
  timeCycle: 'day', // 'day', 'sunset', 'night', 'sunrise'
  timeTicks: 0,
  crystals: {
    crystal_1: { owner: null, beingCapturedBy: null, captureProgress: 0, x: 200, y: 500, radius: 40, room: 'square' },
    crystal_2: { owner: null, beingCapturedBy: null, captureProgress: 0, x: 800, y: 150, radius: 40, room: 'park' },
    crystal_3: { owner: null, beingCapturedBy: null, captureProgress: 0, x: 520, y: 450, radius: 40, room: 'beach' }
  },
  dominator: null
};

// 60 minutes = 3600 seconds
// Let's tick every 1 second
// Day: 35m (2100s)
// Sunset: 10m (600s)
// Night: 15m (900s)
// Sunrise: (Let's make Sunset/Sunrise 5m each to equal 60m total, or 10m sunset + 15m night = 60m. 35+10+15 = 60. Wait, sunrise? Let's do Day 30m, Sunset 10m, Night 10m, Sunrise 10m = 60m. Prompt: "35m Day, 10m Sunset/Sunrise, 15m Night" -> maybe Sunset 5m, Sunrise 5m? Let's say Sunset=5m, Sunrise=5m)

setInterval(() => {
  worldState.timeTicks = (worldState.timeTicks + 1) % 3600;

  const oldCycle = worldState.timeCycle;
  if (worldState.timeTicks < 2100) worldState.timeCycle = 'day';
  else if (worldState.timeTicks < 2400) worldState.timeCycle = 'sunset';
  else if (worldState.timeTicks < 3300) worldState.timeCycle = 'night';
  else worldState.timeCycle = 'sunrise';

  if (oldCycle !== worldState.timeCycle) {
    io.emit('timeUpdate', { cycle: worldState.timeCycle });
  }

  // Crystal capture logic
  let needsCrystalUpdate = false;
  for (let key in worldState.crystals) {
    let c = worldState.crystals[key];

    // Find player in radius
    let playersInRadius = Object.values(onlinePlayers).filter(p => {
      if (p.room !== c.room) return false;
      let dx = p.x - c.x; let dy = p.y - c.y;
      return Math.sqrt(dx*dx + dy*dy) < c.radius;
    });

    if (playersInRadius.length === 1) {
      let p = playersInRadius[0];
      if (c.beingCapturedBy !== p.name) {
         c.beingCapturedBy = p.name;
         c.captureProgress = 0;
         needsCrystalUpdate = true;
      } else {
         c.captureProgress += 1; // 1 second
         if (c.captureProgress >= 3 && c.owner !== p.color) {
            c.owner = p.color; // Capturing assigns color
            c.ownerName = p.name;
            c.beingCapturedBy = null;
            needsCrystalUpdate = true;
         }
      }
    } else {
      if (c.captureProgress > 0 || c.beingCapturedBy) {
        c.captureProgress = 0;
        c.beingCapturedBy = null;
        needsCrystalUpdate = true;
      }
    }
  }

  if (needsCrystalUpdate) {
    // Check domination
    let owners = new Set();
    let hasNull = false;
    for (let key in worldState.crystals) {
      if (!worldState.crystals[key].ownerName) hasNull = true;
      else owners.add(worldState.crystals[key].ownerName);
    }

    let oldDominator = worldState.dominator;
    if (!hasNull && owners.size === 1) {
      worldState.dominator = Array.from(owners)[0];
    } else {
      worldState.dominator = null;
    }

    io.emit('crystalUpdate', { crystals: worldState.crystals, dominator: worldState.dominator });

    if (worldState.dominator && worldState.dominator !== oldDominator) {
      io.emit('dominationEvent', worldState.dominator);
    }
  }
}, 1000);

// Хранилище для активных игроков на сервере

let onlinePlayers = {};

io.on('connection', (socket) => {
  console.log(`Игрок подключился: ${socket.id}`);

  // Обработка регистрации
  socket.on('register', async (data) => {
    if (!db) return socket.emit('registerError', 'База данных пока недоступна');
    const users = db.collection('users');
    
    const existing = await users.findOne({ username: data.username });
    if (existing) return socket.emit('registerError', 'Это имя уже занято!');

    const newUser = {
        username: data.username,
        password: data.password, // Для прототипа храним как есть
        coins: 100, level: 1, xp: 0, color: '#3b82f6',
        inventory: ['cap_red', 'scarf', 'glasses_cool', 'crown'],
        equipped: { hat: null, accessory: null },
        furnitureInventory: [],
        equippedFurniture: { bed: null, floor: null, wall: null, table: null, tv: null, sofa: null, decor: null, lamp: null },
        homeColors: { wall: '#cbd5e1', floor: '#d97706' },
        furniturePos: {
          bed: { x: 120, y: 220, z: 0 },
          wardrobe: { x: 700, y: 150, z: 0 },
          bookcase: { x: 280, y: 80, z: 0 },
          nightstand: { x: 60, y: 200, z: 0 },
          plant: { x: 860, y: 140, z: 0 },
          rug: { x: 520, y: 420, z: -10 },
          table: { x: 450, y: 340, z: 0 },
          tv: { x: 350, y: 50, z: -5 },
          sofa: { x: 460, y: 200, z: 0 },
          decor: { x: 200, y: 350, z: 0 },
          lamp: { x: 820, y: 260, z: 0 }
        },
        friends: [],
        foodInventory: []
    };
    await users.insertOne(newUser);
    socket.emit('registerSuccess');
  });

  // Обработка входа
  socket.on('login', async (data) => {
    if (!db) return socket.emit('loginError', 'База данных пока недоступна');
    const users = db.collection('users');
    
    const user = await users.findOne({ username: data.username, password: data.password });
    if (!user) return socket.emit('loginError', 'Неверный логин или пароль');

    // Добавляем игрока в онлайн сессию
    onlinePlayers[socket.id] = {
        id: socket.id,
        dbId: user._id.toString(),
        x: 520, y: 400, targetX: 520, targetY: 400, currentLocation: 'square',
        name: user.username,
        color: user.color,
        equipped: user.equipped,
        speechBubble: { text: '', timer: 0 },
        radius: 26, speed: 4.5
    };


    socket.emit('loginSuccess', { playerData: user });
    socket.emit('currentPlayers', onlinePlayers);
    socket.emit('worldState', { timeCycle: worldState.timeCycle, crystals: worldState.crystals, dominator: worldState.dominator });
    socket.emit('graffitiUpdate', graffitis);
    socket.emit('collectiblesUpdate', collectibles);
    socket.broadcast.emit('newPlayer', onlinePlayers[socket.id]);

  });

  // Сохранение прогресса в БД
  socket.on('syncData', async (playerData) => {
    if (!db || !onlinePlayers[socket.id]) return;
    const users = db.collection('users');
    
    const { coins, level, xp, color, inventory, equipped, furnitureInventory, equippedFurniture, homeColors, furniturePos, friends, foodInventory } = playerData;
    
    await users.updateOne(
        { username: onlinePlayers[socket.id].name },
        { $set: { coins, level, xp, color, inventory, equipped, furnitureInventory, equippedFurniture, homeColors, furniturePos, friends, foodInventory } }
    );
  });

// --- ОБНОВЛЕННАЯ СИСТЕМА КОМНАТ (ROOMS) ---

  // Обработка движения в пределах одной комнаты
  socket.on('playerMovement', (movementData) => {
    if (onlinePlayers[socket.id]) {
      onlinePlayers[socket.id].targetX = movementData.targetX;
      onlinePlayers[socket.id].targetY = movementData.targetY;
      const room = onlinePlayers[socket.id].room || 'square';
      // Отправляем движение только тем, кто в той же комнате
      socket.broadcast.to(room).emit('playerMoved', onlinePlayers[socket.id]);
    }
  });

  // Переход между локациями и поход в гости
  socket.on('locationTeleport', async (data) => {
    if (onlinePlayers[socket.id]) {
      const p = onlinePlayers[socket.id];
      const oldRoom = p.room || 'square';
      // Если идем домой, название комнаты = "home_ИмяВладельца", иначе = название локации
      const newRoom = data.currentLocation === 'home' ? 'home_' + data.homeOwner : data.currentLocation;

      // Выходим из старой комнаты
      socket.leave(oldRoom);
      socket.broadcast.to(oldRoom).emit('playerLeftRoom', socket.id);

      p.x = data.x; p.y = data.y;
      p.targetX = data.targetX; p.targetY = data.targetY;
      p.currentLocation = data.currentLocation;
      p.room = newRoom;

      // Заходим в новую комнату
      socket.join(newRoom);


      // Если это дом и это дом ДРУГОГО игрока, грузим мебель владельца из БД!
      if (data.currentLocation === 'home' && data.homeOwner && data.homeOwner !== p.name) {
        // Подключаемся к коллекции users
        const houseOwner = await db.collection('users').findOne({ username: data.homeOwner });
        if (houseOwner) {
          socket.emit('loadHouse', {
            username: houseOwner.username,
            equippedFurniture: houseOwner.equippedFurniture,
            homeColors: houseOwner.homeColors,
            furniturePos: houseOwner.furniturePos
          });
        }
      }


      // Показываем нас новым соседям по комнате
      socket.broadcast.to(newRoom).emit('newPlayer', p);

      // Отправляем нам список игроков, которые УЖЕ есть в новой комнате
      const playersInRoom = {};
      for (let id in onlinePlayers) {
        if (onlinePlayers[id].room === newRoom) {
          playersInRoom[id] = onlinePlayers[id];
        }
      }
      socket.emit('currentPlayers', playersInRoom);
    }
  });

  // Чат и внешность (рассылаем только по своей комнате)
  socket.on('chatMessage', (chatData) => {
    if (onlinePlayers[socket.id]) {
      const room = onlinePlayers[socket.id].room || 'square';
      socket.broadcast.to(room).emit('playerSpoke', { id: socket.id, speechBubble: chatData });
    }
  });
  socket.on('playerAppearance', (appData) => {
    if (onlinePlayers[socket.id]) {
      const room = onlinePlayers[socket.id].room || 'square';
      onlinePlayers[socket.id].color = appData.color;
      onlinePlayers[socket.id].equipped = appData.equipped;
      socket.broadcast.to(room).emit('playerAppearanceChanged', { id: socket.id, ...appData });
    }
  });


  // --- CAFE REST & 1v1 ---
  socket.on('startResting', () => {
    if (onlinePlayers[socket.id]) {
      onlinePlayers[socket.id].isResting = true;
      let room = onlinePlayers[socket.id].room;
      if (room === 'cafe') {
         // Check if another player is resting here
         let restingPlayers = Object.values(onlinePlayers).filter(p => p.room === 'cafe' && p.isResting && p.id !== socket.id);
         if (restingPlayers.length > 0) {
            let target = restingPlayers[0];
            io.to(target.id).emit('pvpRequest', onlinePlayers[socket.id].name);
         }
      }
    }
  });

  socket.on('stopResting', () => {
    if (onlinePlayers[socket.id]) {
      onlinePlayers[socket.id].isResting = false;
    }
  });

  socket.on('acceptPvp', (requesterName) => {
    let p = onlinePlayers[socket.id];
    let req = Object.values(onlinePlayers).find(pl => pl.name === requesterName);
    if (p && req) {
       io.to(p.id).emit('pvpStart');
       io.to(req.id).emit('pvpStart');
    }
  });

  // --- СИСТЕМА ДРУЗЕЙ ---
  socket.on('sendFriendRequest', (targetUsername) => {
    const target = Object.values(onlinePlayers).find(p => p.name === targetUsername);
    if (target) {
      io.to(target.id).emit('friendRequest', onlinePlayers[socket.id].name); // Отправляем запрос
    }
  });

  socket.on('acceptFriend', async (requesterUsername) => {
    const p = onlinePlayers[socket.id];
    if(!p) return;
    
    // Добавляем в БД обоим игрокам (убедитесь, что переменная db у вас объявлена)
    await db.collection('users').updateOne({username: p.name}, {$addToSet: {friends: requesterUsername}});
    await db.collection('users').updateOne({username: requesterUsername}, {$addToSet: {friends: p.name}});

    // Уведомляем обоих
    socket.emit('friendAdded', requesterUsername);
    const reqPlayer = Object.values(onlinePlayers).find(pl => pl.name === requesterUsername);
    if (reqPlayer) {
      io.to(reqPlayer.id).emit('friendAdded', p.name);
    }
  });

  // 8. Игрок отключился

  // --- GOMOKU (ARCHIVE) ---
  let gomokuBoard = Array(10).fill().map(() => Array(10).fill(0));
  let gomokuTurn = 1; // 1 or 2
  let gomokuPlayers = [];

  socket.on('gomokuMove', (data) => {
    let p = onlinePlayers[socket.id];
    if (!p || p.room !== 'archive') return;

    let pIndex = gomokuPlayers.indexOf(p.name);
    if (pIndex === -1) {
       if (gomokuPlayers.length < 2) {
          gomokuPlayers.push(p.name);
          pIndex = gomokuPlayers.length - 1;
       } else {
          return; // game full
       }
    }

    if (pIndex + 1 !== gomokuTurn) return; // not your turn

    if (gomokuBoard[data.row] && gomokuBoard[data.row][data.col] === 0) {
       gomokuBoard[data.row][data.col] = gomokuTurn;

       // check win
       let win = false;
       let dr = [0, 1, 1, 1], dc = [1, 0, 1, -1];
       for(let i=0; i<10; i++){
          for(let j=0; j<10; j++){
             if(gomokuBoard[i][j] === gomokuTurn){
                for(let d=0; d<4; d++){
                   let count = 1;
                   for(let step=1; step<5; step++){
                      let nr = i + dr[d]*step; let nc = j + dc[d]*step;
                      if(nr>=0 && nr<10 && nc>=0 && nc<10 && gomokuBoard[nr][nc] === gomokuTurn) count++;
                      else break;
                   }
                   if(count >= 5) win = true;
                }
             }
          }
       }

       if (win) {
          io.to('archive').emit('gomokuUpdate', gomokuBoard);
          io.to('archive').emit('gomokuWin', p.name);
          gomokuBoard = Array(10).fill().map(() => Array(10).fill(0));
          gomokuPlayers = [];
          gomokuTurn = 1;
       } else {
          gomokuTurn = gomokuTurn === 1 ? 2 : 1;
          io.to('archive').emit('gomokuUpdate', gomokuBoard);
       }
    }
  });

  // 8. Игрок отключился

  // --- GRAFFITI WALL ---
  let graffitis = [];
  let graffitiCooldown = {};

  socket.on('placeGraffiti', (data) => {
    let p = onlinePlayers[socket.id];
    if (!p) return;

    let now = Date.now();
    if (graffitiCooldown[p.name] && now - graffitiCooldown[p.name] < 5 * 60 * 1000) {
       socket.emit('graffitiError', 'Жди 5 минут перед следующим тэгом!');
       return;
    }

    graffitiCooldown[p.name] = now;

    // Remove old graffiti from this player
    graffitis = graffitis.filter(g => g.owner !== p.name);

    graffitis.push({
       owner: p.name,
       dataUrl: data.dataUrl,
       w: data.w,
       h: data.h,
       x: data.x,
       y: data.y,
       color: p.color,
       room: p.room
    });

    io.emit('graffitiUpdate', graffitis);
  });

  // 8. Игрок отключился

  // --- SCAVENGER HUNT ---
  let collectibles = [
    { id: 1, x: 800, y: 100, room: 'square' },
    { id: 2, x: 200, y: 200, room: 'park' },
    { id: 3, x: 900, y: 500, room: 'beach' },
    { id: 4, x: 100, y: 400, room: 'cafe' },
    { id: 5, x: 800, y: 200, room: 'archive' }
  ];

  socket.on('collectItem', (itemId) => {
    let p = onlinePlayers[socket.id];
    if (!p) return;

    if (!p.collectedItems) p.collectedItems = [];
    if (!p.collectedItems.includes(itemId)) {
       p.collectedItems.push(itemId);

       let count = p.collectedItems.length;
       socket.emit('collectedInfo', { count: count });

       // Note: in a real game we should update DB XP here. We'll update memory state.
       // The client will sync it.
       socket.emit('loginSuccess', { playerData: { coins: count*10 } }); // hack to just show something or we rely on client sync

       if (count === 5) {
          p.hasAura = true;
          io.emit('playerAura', { id: socket.id, hasAura: true });
       }
    }
  });

  // 8. Игрок отключился
  socket.on('disconnect', () => {
    console.log(`Игрок отключился: ${socket.id}`);
    delete onlinePlayers[socket.id];
    io.emit('playerDisconnected', socket.id);
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`Сервер игры запущен на порту ${PORT}`);
});
