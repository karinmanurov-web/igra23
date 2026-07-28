const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: "*" }
});

// Указываем серверу раздавать файлы из папки, где лежит игра
app.use(express.static(path.join(__dirname, './')));

// Хранилище для активных игроков на сервере
let onlinePlayers = {};

io.on('connection', (socket) => {
  console.log(`Игрок подключился: ${socket.id}`);

  // 1. Создаем начальное состояние для нового подключившегося игрока
  onlinePlayers[socket.id] = {
    id: socket.id,
    x: 520,
    y: 400,
    targetX: 520,
    targetY: 400,
    currentLocation: 'square',
    name: 'Игрок_' + socket.id.substring(0, 4),
    color: '#3b82f6',
    speechBubble: { text: '', timer: 0 }
  };

  // 2. Отправляем новому игроку список всех, кто уже в сети
  socket.emit('currentPlayers', onlinePlayers);

  // 3. Сообщаем остальным игрокам, что зашел новый пользователь
  socket.broadcast.emit('newPlayer', onlinePlayers[socket.id]);

  // 4. Обработка движения: когда игрок кликает по экрану
  socket.on('playerMovement', (movementData) => {
    if (onlinePlayers[socket.id]) {
      onlinePlayers[socket.id].targetX = movementData.targetX;
      onlinePlayers[socket.id].targetY = movementData.targetY;
      onlinePlayers[socket.id].currentLocation = movementData.currentLocation;
      
      // Рассылаем новые координаты всем остальным, чтобы персонаж шел плавно
      socket.broadcast.emit('playerMoved', onlinePlayers[socket.id]);
    }
  });

  // 5. Обработка мгновенной смены локации (телепорт через карту или двери)
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

  // 6. Синхронизация текста в чате и эмодзи
  socket.on('chatMessage', (chatData) => {
    if (onlinePlayers[socket.id]) {
      onlinePlayers[socket.id].speechBubble = chatData;
      socket.broadcast.emit('playerSpoke', {
        id: socket.id,
        speechBubble: chatData
      });
    }
  });

  // 7. Игрок закрыл вкладку или отключился
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