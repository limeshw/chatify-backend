import { User } from "../models/user.model.js";
import {
  cookieOptions,
  emitEvent,
  sendToken,
  uploadFilesToCloudinary,
} from "../utils/features.utils.js";
import bcrypt from "bcrypt";
import { ErrorHandler } from "../utils/utility.js";
import { TryCatch } from "../middlewares/error.middleware.js";
import { Chat } from "../models/chat.model.js";
import { Request } from "../models/request.model.js";
import { NEW_REQUEST, REFETCH_CHATS } from "../constants/events.constant.js";
import { getOtherMembers } from "../lib/helper.lib.js";

const EMOJI_API_URL = "https://emojihub.yurace.pro/api/all";
const EMOJI_CACHE_TTL = 1000 * 60 * 60 * 12;

let emojiCache = {
  data: null,
  fetchedAt: 0,
};

const fallbackEmojis = [
  { name: "grinning face", emoji: "😀", category: "smileys and people" },
  { name: "face with tears of joy", emoji: "😂", category: "smileys and people" },
  { name: "smiling face with heart-eyes", emoji: "😍", category: "smileys and people" },
  { name: "thinking face", emoji: "🤔", category: "smileys and people" },
  { name: "thumbs up", emoji: "👍", category: "smileys and people" },
  { name: "red heart", emoji: "❤️", category: "symbols" },
  { name: "fire", emoji: "🔥", category: "travel and places" },
  { name: "sparkles", emoji: "✨", category: "symbols" },
  { name: "party popper", emoji: "🎉", category: "activities" },
  { name: "rocket", emoji: "🚀", category: "travel and places" },
  { name: "pizza", emoji: "🍕", category: "food and drink" },
  { name: "coffee", emoji: "☕", category: "food and drink" },
];

const unicodeToEmoji = (unicode = []) =>
  unicode
    .map((codepoint) => Number.parseInt(codepoint.replace("U+", ""), 16))
    .filter((value) => !Number.isNaN(value))
    .map((value) => String.fromCodePoint(value))
    .join("");

const newUser = TryCatch(async (req, res, next) => {
  const { name, username, password, bio } = req.body;
  const file = req.file;

  if (!file) return next(new ErrorHandler("Avatar is required", 400));

  const result = await uploadFilesToCloudinary([file]);

  const avatar = {
    public_id: result[0].public_id,
    url: result[0].url,
  };
  // console.log(avatar);
  

  const user = await User.create({ name, username, avatar, password, bio });
  // console.log(user);

  sendToken(res, 201, user, "User created successfully");
});

const login = TryCatch(async (req, res, next) => {
  const { username, password } = req.body;

  const user = await User.findOne({ username }).select("+password");
  if (!user) return next(new ErrorHandler("Invalid Credentials", 404));

  const isPasswordMatch = await bcrypt.compare(password, user.password);
  if (!isPasswordMatch)
    return next(new ErrorHandler("Invalid Credentials", 404));

  sendToken(res, 200, user, `Welcome back ${user.name}`);
});

const getMyProfile = TryCatch(async (req, res, next) => {
  const user = await User.findById(req.user);

  if (!user) return next(new ErrorHandler("User not found", 404));

  res.status(200).json({
    success: true,
    user,
  });
});

const logout = TryCatch(async (req, res) => {
  return res
    .status(200)
    .clearCookie("chatify-token")
    .json({
      success: true,
      message: "Logged out successfully",
    });
});

const searchUser = TryCatch(async (req, res) => {
  const { name = "" } = req.query;

  //finding all my chats
  const myChats = await Chat.find({ groupChat: false, members: req.user });

  //all users from my chats with I chatted
  const allUsersFromMyChats = myChats.flatMap((chat) => chat.members);

  //finding all users except me and my friends
  const allUsersExceptMeAndFriends = await User.find({
    _id: { $nin: [...allUsersFromMyChats, req.user] },
    name: { $regex: name, $options: "i" },
  });

  const users = allUsersExceptMeAndFriends.map(({ _id, name, avatar, username }) => ({
    _id,
    name,
    avatar: avatar.url,
    username,
  }));
  return res.status(200).json({
    success: true,
    users,
  });
});

const sendFriendRequest = TryCatch(async (req, res, next) => {
  const { userId } = req.body;

  const request = await Request.findOne({
    $or: [
      { sender: req.user, receiver: userId },
      { sender: userId, receiver: req.user },
    ],
  });

  if (request) return next(new ErrorHandler("Request already sent", 400));

  await Request.create({
    sender: req.user,
    receiver: userId,
  });

  emitEvent(req, NEW_REQUEST, [userId]);

  return res.status(200).json({
    success: true,
    message: "Friend Request Sent",
  });
});

const acceptFriendRequest = TryCatch(async (req, res, next) => {
  const { requestId, accept } = req.body;

  const request = await Request.findById(requestId)
    .populate("sender", "name")
    .populate("receiver", "name");

  if (!request) return next(new ErrorHandler("Request not found", 404));

  if (request.receiver._id.toString() !== req.user.toString())
    return next(
      new ErrorHandler("You are not authorized to accept this request", 401),
    );

  if (!accept) {
    await request.deleteOne();

    return res.status(200).json({
      success: true,
      message: "Friend Request Rejected",
    });
  }

  const members = [request.sender._id, request.receiver._id];

  await Promise.all([
    Chat.create({
      members,
      name: `${request.sender.name}-${request.receiver.name}`,
    }),
    request.deleteOne(),
  ]);

  emitEvent(req, REFETCH_CHATS, members);

  return res.status(200).json({
    success: true,
    message: "Friend Request Accepted",
    senderId: request.sender._id,
  });
});

const getMyNotifications = TryCatch(async (req, res) => {
  const requests = await Request.find({ receiver: req.user }).populate(
    "sender",
    "name avatar",
  );

  const allRequests = requests.map(({ _id, sender }) => ({
    _id,
    sender: {
      _id: sender._id,
      name: sender.name,
      avatar: sender.avatar.url,
    },
  }));

  return res.status(200).json({
    success: true,
    allRequests,
  });
});

const getMyFriends = TryCatch(async (req, res) => {
  const chatId = req.query.chatId;

  //find friends of user , here user also included in members array
  const chats = await Chat.find({
    members: req.user,
    groupChat: false,
  }).populate("members", "name avatar username bio createdAt");

  //get other members from the members array , return only other member , and not user
  const friends = chats.map(({ members }) => {
    const otherMember = getOtherMembers(members, req.user);
    return {
      _id: otherMember._id,
      name: otherMember.name,
      username: otherMember.username,
      bio: otherMember.bio,
      createdAt: otherMember.createdAt,
      avatar: otherMember.avatar.url,
    };
  });

  if (chatId) {
    const chat = await Chat.findById(chatId);

    const availableFriends = friends.filter(
      (friend) =>
        !chat.members.some((member) => member.toString() === friend._id.toString()),
    );

    return res.status(200).json({
      success: true,
      friends: availableFriends,
    });
  } else {
    return res.status(200).json({
      success: true,
      friends,
    });
  }
});

const getEmojis = TryCatch(async (req, res) => {
  const now = Date.now();

  if (emojiCache.data && now - emojiCache.fetchedAt < EMOJI_CACHE_TTL) {
    return res.status(200).json({
      success: true,
      emojis: emojiCache.data,
      cached: true,
    });
  }

  try {
    const response = await fetch(EMOJI_API_URL);

    if (!response.ok) {
      throw new Error(`Emoji API responded with ${response.status}`);
    }

    const rawEmojis = await response.json();
    const emojis = rawEmojis
      .map((item) => ({
        name: item.name,
        emoji: unicodeToEmoji(item.unicode),
        category: item.category,
        group: item.group,
      }))
      .filter((item) => item.emoji);

    emojiCache = {
      data: emojis,
      fetchedAt: now,
    };

    return res.status(200).json({
      success: true,
      emojis,
      cached: false,
    });
  } catch (error) {
    return res.status(200).json({
      success: true,
      emojis: emojiCache.data || fallbackEmojis,
      cached: true,
      fallback: true,
    });
  }
});

export {
  newUser,
  login,
  getMyProfile,
  logout,
  searchUser,
  sendFriendRequest,
  acceptFriendRequest,
  getMyNotifications,
  getMyFriends,
  getEmojis,
};
