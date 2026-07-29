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

  // 4. Обработка движения: когда игрок кликает по экрану
  socket.on('playerMovement', (movementData) => {
    if (onlinePlayers[socket.id]) {
      onlinePlayers[socket.id].targetX = movementData.targetX;
      onlinePlayers[socket.id].targetY = movementData.targetY;
      onlinePlayers[socket.id].currentLocation = movementData.currentLocation;
      
      socket.broadcast.emit('playerMoved', onlinePlayers[socket.id]);
    }
  });

  // 5. Обработка телепортации
  socket.on('locationTeleport', (teleportData) => {
    if (onlinePlayers[socket.id]) {
      onlinePlayers[socket.id].x = teleportData.x;
      onlinePlayers[socket.id].y = teleportData.y;
      onlinePlayers[socket.id].targetX = teleportData.targetX;
      onlinePlayers[socket.id].targetY = teleportData.targetY;
      onlinePlayers[socket.id].currentLocation = teleportData.currentLocation;
      
      socket.broadcast.emit('playerTeleported', onlinePlayers[socket.id]);
    }
  });

  // 6. Обработка изменения внешности (цвет + одежда) - Этап 1
  socket.on('playerAppearance', (data) => {
    if (onlinePlayers[socket.id]) {
      onlinePlayers[socket.id].color = data.color;
      onlinePlayers[socket.id].equipped = data.equipped;

      socket.broadcast.emit('playerAppearanceChanged', {
        id: socket.id,
        color: data.color,
        equipped: data.equipped
      });
    }
  });

  // 7. Синхронизация текста в чате
  socket.on('chatMessage', (chatData) => {
    if (onlinePlayers[socket.id]) {
      onlinePlayers[socket.id].speechBubble = chatData;
      socket.broadcast.emit('playerSpoke', {
        id: socket.id,
        speechBubble: chatData
      });
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
