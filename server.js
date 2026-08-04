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
