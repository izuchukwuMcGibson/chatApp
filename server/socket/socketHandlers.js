import Message from '../models/message.js';
import User from '../models/user.js';
import jwt from 'jsonwebtoken';

const registerSocketHandlers = (io) => {
  // Track online users
  const onlineUsers = new Map(); // userId -> socketId
  const roomUsers = new Map();   // roomId -> Set of {userId, username}
  const typingUsers = new Map(); // roomId -> Set of usernames
  
  // For debugging - log all socket.io events
  io.engine.on("connection_error", (err) => {
    console.log("Connection error:", err.message);
  });

  // Optional JWT verification middleware
  io.use(async (socket, next) => {
    console.log("Socket connection attempt:", socket.id);
    try {
      // Get token from handshake
      const token = socket.handshake.auth.token;
      
      if (token) {
        try {
          // Verify token and extract user info
          const decoded = jwt.verify(token, process.env.JWT_SECRET);
          
          // If we have user info in the token, use it
          if (decoded.username) {
            socket.user = {
              userId: decoded.id || decoded.userId || socket.id,
              username: decoded.username
            };
            console.log(`Authenticated user: ${socket.user.username}`);
          }
        } catch (error) {
          console.log('Token verification failed, continuing as anonymous');
          // Continue without authentication
        }
      }
      
      // Always allow connection even if token is invalid
      next();
    } catch (error) {
      console.error('Socket middleware error:', error);
      next();
    }
  });

  io.on("connection", (socket) => {
    console.log(`New connection: ${socket.id}`);
    
    // Handle user_connected event
    socket.on('user_connected', (data) => {
      // Use username from JWT token if available, otherwise from data
      const username = socket.user?.username || data.username;
      const userId = socket.user?.userId || data.userId || socket.id;
      
      console.log(`User connected: ${username} (${userId})`);
      
      // Store user in socket
      socket.userData = { userId, username };
      
      // Store user in online users map
      onlineUsers.set(userId, socket.id);
      
      // Broadcast user is online
      io.emit("user_status_changed", { userId, username, status: "online" });
    });
    
    // Get rooms
    socket.on('get_rooms', async () => {
      try {
        // Find all unique room IDs from message history
        const distinctRooms = await Message.distinct('room');
        
        // Create a set of active rooms (rooms with users)
        const activeRoomIds = new Set(roomUsers.keys());
        
        // Combine active rooms with rooms from message history
        const allRoomIds = new Set([...activeRoomIds, ...distinctRooms]);
        
        // Build room data for each room
        const rooms = Array.from(allRoomIds).map(roomId => {
          const userCount = roomUsers.has(roomId) ? roomUsers.get(roomId).size : 0;
          return {
            name: roomId,
            userCount: userCount,
            hasHistory: distinctRooms.includes(roomId)
          };
        });
        
        socket.emit('available_rooms', { rooms });
      } catch (error) {
        console.error('Error getting rooms:', error);
        socket.emit('available_rooms', { rooms: [] });
      }
    });
    
    // JOIN ROOM
    socket.on("join_room", async (data) => {
      const { roomId } = data;
      // Use username from socket data or from the event
      const { userId, username } = socket.userData || data;
      
      console.log(`User ${username} joining room ${roomId}`);
      
      socket.join(roomId);
      
      // Track user in this room
      if (!roomUsers.has(roomId)) {
        roomUsers.set(roomId, new Set());
      }
      roomUsers.get(roomId).add({ userId, username });
      
      // Initialize typing users for this room if needed
      if (!typingUsers.has(roomId)) {
        typingUsers.set(roomId, new Set());
      }
      
      // Notify everyone in the room
      io.to(roomId).emit("user_joined", { 
        username, 
        roomId, 
        timestamp: Date.now()
      });
      
      // Update room users list for everyone
      const usersArray = Array.from(roomUsers.get(roomId)).map(user => ({
        userId: user.userId,
        username: user.username
      }));
      
      io.to(roomId).emit("room_users_updated", {
        roomId,
        users: usersArray
      });
      
      // Send message history to user - IMPROVED to load more messages
      try {
        // Find messages for this room, sorted by creation time
        const messages = await Message.find({ room: roomId })
          .sort({ createdAt: 1 })
          .limit(100); // Increased limit to show more history
        
        console.log(`Found ${messages.length} messages for room ${roomId}`);
        
        // Send message history to the user who just joined
        socket.emit('room_history', { 
          roomId, 
          messages: messages.map(msg => ({
            sender: msg.sender,
            content: msg.content,
            room: msg.room,
            createdAt: msg.createdAt
          }))
        });
      } catch (error) {
        console.error('Error fetching room history:', error);
        // Send empty history on error
        socket.emit('room_history', { roomId, messages: [] });
      }
    });
    
    // SEND MESSAGE
    socket.on("send_message", async (messageData) => {
      const { roomId, content } = messageData;
      // Get username from socket data or from the message
      const { username } = socket.userData || messageData;
      
      console.log(`Message from ${username} in room ${roomId}: ${content.substring(0, 30)}...`);
      
      try {
        // Create new message document
        const newMessage = new Message({
          sender: username,
          content,
          room: roomId,
          createdAt: Date.now(),
        });
        
        // Save message to database
        await newMessage.save();
        
        console.log(`Message saved to database with ID: ${newMessage._id}`);
        console.log(`Broadcasting message to room ${roomId}`);
        
        // Broadcast to everyone in the room INCLUDING sender
        io.to(roomId).emit("new_message", {
          id: newMessage._id.toString(),
          sender: username,
          content,
          room: roomId,
          createdAt: newMessage.createdAt,
        });
      } catch (error) {
        console.error("Error saving message:", error);
        socket.emit("error", { message: "Failed to send message." });
      }
    });
    
    // LOAD MORE MESSAGES (for scrollback)
    socket.on("load_more_messages", async (data) => {
      const { roomId, before } = data;
      
      try {
        // Find messages before a certain timestamp/ID
        const query = { room: roomId };
        if (before) {
          query.createdAt = { $lt: new Date(before) };
        }
        
        const messages = await Message.find(query)
          .sort({ createdAt: -1 }) // Descending order
          .limit(50)               // Get 50 older messages
          .sort({ createdAt: 1 }); // Then sort back to ascending for client
        
        socket.emit('more_messages', { 
          roomId, 
          messages: messages.map(msg => ({
            id: msg._id.toString(),
            sender: msg.sender,
            content: msg.content,
            room: msg.room,
            createdAt: msg.createdAt
          })),
          hasMore: messages.length === 50 // Indicate if there might be more
        });
      } catch (error) {
        console.error('Error loading more messages:', error);
        socket.emit('more_messages', { roomId, messages: [], hasMore: false });
      }
    });
    
    // TYPING INDICATOR
    socket.on("typing", (data) => {
      const { roomId } = data;
      const { username } = socket.userData || data;
      
      if (!typingUsers.has(roomId)) {
        typingUsers.set(roomId, new Set());
      }
      
      typingUsers.get(roomId).add(username);
      
      // Broadcast typing users to room
      io.to(roomId).emit("typing_update", {
        roomId,
        users: Array.from(typingUsers.get(roomId))
      });
    });
    
    socket.on("stop_typing", (data) => {
      const { roomId } = data;
      const { username } = socket.userData || data;
      
      if (typingUsers.has(roomId)) {
        typingUsers.get(roomId).delete(username);
        
        // Broadcast updated typing users
        io.to(roomId).emit("typing_update", {
          roomId,
          users: Array.from(typingUsers.get(roomId))
        });
      }
    });
    
    // LEAVE ROOM
    socket.on("leave_room", (data) => {
      const { roomId } = data;
      const { userId, username } = socket.userData || data;
      
      console.log(`User ${username} leaving room ${roomId}`);
      
      socket.leave(roomId);
      
      // Remove user from room tracking
      if (roomUsers.has(roomId)) {
        const users = roomUsers.get(roomId);
        const userToRemove = Array.from(users).find(u => u.userId === userId || u.username === username);
        if (userToRemove) {
          users.delete(userToRemove);
          
          // Remove from typing users
          if (typingUsers.has(roomId)) {
            typingUsers.get(roomId).delete(username);
          }
          
          // Notify everyone in room
          io.to(roomId).emit("user_left", {
            username,
            roomId,
            timestamp: Date.now()
          });
          
          // Update room users list
          const usersArray = Array.from(users).map(user => ({
            userId: user.userId,
            username: user.username
          }));
          
          io.to(roomId).emit("room_users_updated", {
            roomId,
            users: usersArray
          });
        }
      }
    });
    
    // DISCONNECT
    socket.on("disconnect", () => {
      const { userId, username } = socket.userData || {};
      
      if (!userId || !username) {
        console.log(`Anonymous user disconnected: ${socket.id}`);
        return;
      }
      
      console.log(`User disconnected: ${username} (${userId})`);
      
      // Remove from online users
      onlineUsers.delete(userId);
      
      // Remove from all rooms
      for (const [roomId, users] of roomUsers.entries()) {
        const userToRemove = Array.from(users).find(u => u.userId === userId || u.username === username);
        if (userToRemove) {
          users.delete(userToRemove);
          
          // Remove from typing users
          if (typingUsers.has(roomId)) {
            typingUsers.get(roomId).delete(username);
          }
          
          // Notify everyone in room
          io.to(roomId).emit("user_left", {
            username,
            roomId,
            timestamp: Date.now()
          });
          
          // Update room users list
          const usersArray = Array.from(users).map(user => ({
            userId: user.userId,
            username: user.username
          }));
          
          io.to(roomId).emit("room_users_updated", {
            roomId,
            users: usersArray
          });
        }
      }
      
      // Broadcast user is offline
      io.emit("user_status_changed", { userId, username, status: "offline" });
    });
  });
};

export default registerSocketHandlers;