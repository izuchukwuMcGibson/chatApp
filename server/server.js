import express from "express";
import http from "http";
import { Server } from "socket.io";
import dotenv from "dotenv";
import cors from "cors";
import userRouter from "./routes/user.routes.js";
import connectDB from "./config/db.js";
import registerSocketHandlers from "./socket/socketHandlers.js";

dotenv.config();

const PORT = process.env.PORT || 3500;
const app = express();

// Middleware
app.use(cors());
app.use(express.json());

// Routes
app.use("/api/users", userRouter);

// Create HTTP server and attach socket.io
const httpServer = http.createServer(app);
const io = new Server(httpServer, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"],
    credentials: true
  },
});

// Register socket handlers
registerSocketHandlers(io);

// In your server.js
// app.use(express.static(path.join(__dirname, 'public')));

// Start server
httpServer.listen(PORT, () => {
  connectDB();
  console.log(`🚀 Server running on port ${PORT}`);
});