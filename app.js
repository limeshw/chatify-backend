import cookieParser from "cookie-parser";
import dotenv from "dotenv";
import express from "express";
import { Server } from "socket.io";
import { createServer } from "http";
import { errorMiddleware } from "./middlewares/error.middleware.js";
import { connectDB } from "./utils/features.utils.js";
import { v4 as uuid } from "uuid";
import cors from "cors";
import { v2 as cloudinary } from "cloudinary";

import { CHAT_JOINED, CHAT_LEAVED, NEW_MESSAGE, NEW_MESSAGE_ALERT, ONLINE_USERS, START_TYPING, STOP_TYPING } from "./constants/events.constant.js";
import { getSockets } from "./lib/helper.lib.js";
import { Message } from "./models/message.model.js";
import { corsOptions } from "./constants/config.js";
import { socketAuthenticator } from "./middlewares/auth.middleware.js";

import adminRoutes from "./routes/admin.route.js";
import chatRoutes from "./routes/chat.route.js";
import userRoutes from "./routes/user.route.js";

dotenv.config({
  path: "./.env",
});

const mongoURI = process.env.MONGO_URI;
const PORT = process.env.PORT || 3000;
const envMode = process.env.NODE_ENV.trim() || "PRODUCTION";
const adminSecretKey = process.env.ADMIN_SECRET_KEY;

const userSocketIDs = new Map();
const chatPresenceMap = new Map();
const chatMembersMap = new Map();

connectDB(mongoURI);

cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET,
});

const app = express();
const server = createServer(app);
const io = new Server(server, {
  cors: corsOptions,
});

app.set("io", io);

app.use(express.urlencoded({ extended: true }));
app.use(express.json());
app.use(cookieParser());
app.use(cors(corsOptions));

app.get("/", (req, res) => {
  res.send("Hello From Chatify");
});

app.use("/api/v1/users", userRoutes);
app.use("/api/v1/chats", chatRoutes);
app.use("/api/v1/admin", adminRoutes);

//socket.io
io.use((socket, next) => {
  cookieParser()(socket.request, socket.request.res,async(err) => await socketAuthenticator(err,socket,next));
});
io.on("connection", (socket) => {
  const user = socket.user;  
  socket.data.activeChats = new Set();

userSocketIDs.set(user._id.toString(), socket.id);
  // console.log("User connected : ", socket.id);
  // console.log(userSocketIDs);

  socket.on(NEW_MESSAGE, async ({ chatId, members, message }) => {
    const messageForRealTime = {
      content: message,
      _id: uuid(),
      sender: {
        _id: user._id,
        name: user.name,
      },
      chat: chatId,
      createdAt: new Date().toISOString(),
    };

    const messageForDB = {
      content: message,
      sender: user._id,
      chat: chatId,
    };

    // console.log("Emitting..." , messageForRealTime);
    

    const memberSockets = getSockets(members);

    io.to(memberSockets).emit(NEW_MESSAGE, {
      chatId,
      message: messageForRealTime,
    });
    io.to(memberSockets).emit(NEW_MESSAGE_ALERT, {chatId});

    // console.log("New Message" , messageForRealTime);
    try {
      await Message.create(messageForDB);
    } catch (error) {
      // console.log(error);
      throw new Error(error);
    }
  });

  socket.on(START_TYPING , ({members,chatId}) => {
    // console.log("Start Typing..." ,chatId);
    const memberSockets = getSockets(members);

    socket.to(memberSockets).emit(START_TYPING , {
      chatId,
      userId: user._id.toString(),
      name: user.name,
    });
  })

  socket.on(STOP_TYPING , ({members,chatId}) => {
    // console.log("Stop Typing..." ,chatId);
    const memberSockets = getSockets(members);

    socket.to(memberSockets).emit(STOP_TYPING , {
      chatId,
      userId: user._id.toString(),
    });
  })

  socket.on(CHAT_JOINED, ({ userId, chatId, members }) => {
    if (!chatId) return;

    const normalizedUserId = userId.toString();
    const normalizedMembers = [...new Set((members || []).map((member) => member.toString()))];
    const currentPresence = chatPresenceMap.get(chatId) || new Set();

    currentPresence.add(normalizedUserId);
    chatPresenceMap.set(chatId, currentPresence);
    chatMembersMap.set(chatId, normalizedMembers);
    socket.data.activeChats.add(chatId);

    const membersSocket = [...new Set([...getSockets(normalizedMembers), socket.id].filter(Boolean))];
    io.to(membersSocket).emit(ONLINE_USERS, {
      chatId,
      users: Array.from(currentPresence),
    });
  });

  socket.on(CHAT_LEAVED, ({ userId, chatId, members }) => {
    if (!chatId) return;

    const normalizedUserId = userId.toString();
    const currentPresence = chatPresenceMap.get(chatId) || new Set();

    currentPresence.delete(normalizedUserId);
    socket.data.activeChats.delete(chatId);

    if (currentPresence.size === 0) {
      chatPresenceMap.delete(chatId);
    } else {
      chatPresenceMap.set(chatId, currentPresence);
    }

    if (members?.length) {
      chatMembersMap.set(chatId, [...new Set(members.map((member) => member.toString()))]);
    }

    const currentMembers = chatMembersMap.get(chatId) || [];
    const membersSocket = [...new Set([...getSockets(currentMembers), socket.id].filter(Boolean))];
    io.to(membersSocket).emit(ONLINE_USERS, {
      chatId,
      users: Array.from(currentPresence),
    });
  });

  socket.on("disconnect", () => {
    // console.log("User disconnected : ", socket.id);
    userSocketIDs.delete(user._id.toString());

    for (const chatId of socket.data.activeChats || []) {
      const currentPresence = chatPresenceMap.get(chatId) || new Set();
      currentPresence.delete(user._id.toString());

      if (currentPresence.size === 0) {
        chatPresenceMap.delete(chatId);
      } else {
        chatPresenceMap.set(chatId, currentPresence);
      }

      const currentMembers = chatMembersMap.get(chatId) || [];
      const membersSocket = getSockets(currentMembers).filter(Boolean);
      io.to(membersSocket).emit(ONLINE_USERS, {
        chatId,
        users: Array.from(currentPresence),
      });
    }
  });
});

app.use(errorMiddleware);

server.listen(PORT, () => {
  console.log(
    `Server is running on http://localhost:${PORT} in ${envMode} mode`,
  );
});

export { envMode, adminSecretKey, userSocketIDs, chatPresenceMap };
