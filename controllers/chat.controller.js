import { chatPresenceMap } from "../app.js";
import {
  ALERT,
  MESSAGE_DELETED,
  MESSAGE_REACTION_UPDATED,
  NEW_MESSAGE,
  NEW_MESSAGE_ALERT,
  REFETCH_CHATS,
} from "../constants/events.constant.js";
import { getOtherMembers } from "../lib/helper.lib.js";
import { TryCatch } from "../middlewares/error.middleware.js";
import { Chat } from "../models/chat.model.js";
import { Message } from "../models/message.model.js";
import { User } from "../models/user.model.js";
import {
  deleteFilesFromCloudinary,
  emitEvent,
  uploadFilesToCloudinary,
} from "../utils/features.utils.js";
import { ErrorHandler } from "../utils/utility.js";

const normalizeReplyTo = (message) => {
  if (!message?.replyTo) return undefined;

  return {
    messageId: message.replyTo.messageId,
    content: message.replyTo.content || "",
    senderId: message.replyTo.senderId,
    senderName: message.replyTo.senderName || "Unknown",
  };
};

const normalizeReactions = (reactions = []) =>
  reactions.map((reaction) => ({
    emoji: reaction.emoji,
    users: (reaction.users || []).map((user) => user.toString()),
    count: reaction.users?.length || 0,
  }));

const normalizeMessagePayload = (message) => ({
  _id: message._id,
  content: message.content || "",
  attachments: message.attachments || [],
  sender: message.sender,
  chat: message.chat,
  createdAt: message.createdAt,
  replyTo: normalizeReplyTo(message),
  reactions: normalizeReactions(message.reactions),
});

const getUnreadCountForUser = (chat, userId) =>
  chat.unreadCounts?.find((item) => item.user.toString() === userId.toString())?.count || 0;

const markChatAsRead = async (chat, userId) => {
  const unreadRecord = chat.unreadCounts?.find(
    (item) => item.user.toString() === userId.toString(),
  );

  if (!unreadRecord || unreadRecord.count === 0) return false;

  unreadRecord.count = 0;
  await chat.save();
  return true;
};

const newGroupChat = TryCatch(async (req, res, next) => {
  const { name, members, photo = "" } = req.body;

  // if (members.length < 2)
  //   return next(
  //     new ErrorHandler("Group chat must have at least 3 members", 400),
  //   );

  const allMembers = [...members, req.user];
  await Chat.create({
    name,
    groupChat: true,
    creator: req.user,
    members: allMembers,
    photo,
  });

  emitEvent(req, ALERT, allMembers, `Welcome to ${name} group`);
  emitEvent(req, REFETCH_CHATS, members);

  return res.status(201).json({
    success: true,
    message: "Group chat created successfully",
  });
});

const getMyChats = TryCatch(async (req, res, next) => {
  const chats = await Chat.find({ members: req.user }).populate(
    "members",
    "name avatar",
  );

  const transformedChats = await Promise.all(
    chats.map(async (chat) => {
      const { _id, name, groupChat, members, photo, createdAt, pinnedBy } = chat;
      const otherMember = getOtherMembers(members, req.user);
      const lastMessage = await Message.findOne({ chat: _id })
        .sort({ createdAt: -1 })
        .populate("sender", "name avatar")
        .lean();

      return {
        _id,
        groupChat,
        avatar: groupChat
          ? photo
            ? [photo]
            : members.slice(0, 3).map(({ avatar }) => avatar.url)
          : [otherMember.avatar.url],
        photo,
        name: groupChat ? name : otherMember.name,
        members: members.reduce((prev, curr) => {
          if (curr._id.toString() !== req.user.toString()) {
            prev.push(curr._id);
          }
          return prev;
        }, []),
        createdAt,
        isPinned: pinnedBy?.some((userId) => userId.toString() === req.user.toString()) || false,
        unreadCount: getUnreadCountForUser(chat, req.user),
        lastMessage: lastMessage
          ? {
              _id: lastMessage._id,
              content: lastMessage.content || "",
              createdAt: lastMessage.createdAt,
              sender: {
                _id: lastMessage.sender?._id,
                name: lastMessage.sender?.name,
                avatar: lastMessage.sender?.avatar?.url,
              },
              attachments: lastMessage.attachments || [],
              replyTo: normalizeReplyTo(lastMessage),
              reactions: normalizeReactions(lastMessage.reactions),
            }
          : null,
      };
    }),
  );

  return res.status(200).json({
    success: true,
    chats: transformedChats,
  });
});

const getMyGroups = TryCatch(async (req, res) => {
  const chats = await Chat.find({
    members: req.user,
    groupChat: true,
    creator: req.user,
  }).populate("members", "name avatar");

  const groups = chats.map(({ members, _id, name, groupChat, photo, createdAt }) => ({
    _id,
    groupChat,
    name,
    avatar: photo ? [photo] : members.slice(0, 3).map(({ avatar }) => avatar.url),
    photo,
    createdAt,
  }));

  return res.status(200).json({
    success: true,
    groups,
  });
});

const addMembers = TryCatch(async (req, res, next) => {
  const { chatId, members } = req.body;

  // if (!members || members.length < 1)
  //   return next(new ErrorHandler("Please provide members", 400));

  const chat = await Chat.findById(chatId);

  if (!chat) return next(new ErrorHandler("Chat not found", 404));
  if (!chat.groupChat)
    return next(new ErrorHandler("This is not a group chat", 400));
  if (chat.creator.toString() !== req.user.toString())
    return next(new ErrorHandler("You are not authorized to add members", 400));

  const allNewMembersPromise = members.map((i) => User.findById(i, "name"));
  const allNewMembers = await Promise.all(allNewMembersPromise);

  const uniqueMembers = allNewMembers.filter(
    (i) =>
      i &&
      !chat.members.some((member) => member.toString() === i._id.toString()),
  );

  chat.members.push(...uniqueMembers.map((i) => i._id));

  if (chat.members.length > 100)
    return next(new ErrorHandler("Group member limit exceeded", 400));

  await chat.save();

  const allUserName = allNewMembers.map((i) => i.name).join(",");

  emitEvent(
    req,
    ALERT,
    chat.members,
    `${allUserName} has been added to the group ${chat.name}`,
  );

  emitEvent(req, REFETCH_CHATS, chat.members);

  return res.status(200).json({
    success: true,
    message: "Members added successfully",
  });
});

const removeMembers = TryCatch(async (req, res, next) => {
  const { chatId, userId } = req.body;
  const [chat, userToRemove] = await Promise.all([
    Chat.findById(chatId),
    User.findById(userId, "name"),
  ]);

  if (!chat) return next(new ErrorHandler("Chat not found", 404));
  if (!chat.groupChat)
    return next(new ErrorHandler("This is not a group chat", 400));
  if (chat.creator.toString() !== req.user.toString())
    return next(
      new ErrorHandler("You are not authorized to remove members", 400),
    );

  if (chat.members.length <= 3)
    return next(new ErrorHandler("Group must have at least 3 members", 400));

  const allChatMembers = chat.members.map((i) => i.toString());

  chat.members = chat.members.filter(
    (member) => member.toString() !== userId.toString(),
  );

  await chat.save();

  emitEvent(req, ALERT, chat.members, {
    message: `${userToRemove.name} has been removed from the group ${chat.name}`,
    chatId,
  });

  emitEvent(req, REFETCH_CHATS, allChatMembers);

  return res.status(200).json({
    success: true,
    message: "Member removed successfully",
  });
});

const leaveGroup = TryCatch(async (req, res, next) => {
  const chatId = req.params.id;

  const chat = await Chat.findById(chatId);

  if (!chat) return next(new ErrorHandler("Chat not found", 404));

  if (!chat.groupChat)
    return next(new ErrorHandler("This is not a group chat", 400));

  const remainingMembers = chat.members.filter(
    (member) => member.toString() !== req.user.toString(),
  );
  const allChatMembers = chat.members.map((member) => member.toString());

  if (remainingMembers.length === 0) {
    await Promise.all([chat.deleteOne(), Message.deleteMany({ chat: chatId })]);

    emitEvent(req, REFETCH_CHATS, allChatMembers);

    return res.status(200).json({
      success: true,
      message: "Group deleted because no members remained",
    });
  }

  if (chat.creator.toString() === req.user.toString()) {
    const randomElement = Math.floor(Math.random() * remainingMembers.length);
    const newCreator = remainingMembers[randomElement];
    chat.creator = newCreator;
  }

  chat.members = remainingMembers;

  const [user] = await Promise.all([
    User.findById(req.user, "name"),
    chat.save(),
  ]);

  emitEvent(req, ALERT, chat.members, {
    message: `${user.name} has left the group`,
    chatId,
  });
  emitEvent(req, REFETCH_CHATS, allChatMembers);

  return res.status(200).json({
    success: true,
    message: "Member left successfully",
  });
});

const sendAttachments = TryCatch(async (req, res, next) => {
  const { chatId } = req.body;

  const files = req.files || [];
  if (files.length < 1)
    return next(new ErrorHandler("Files are required", 400));
  if (files.length > 5)
    return next(new ErrorHandler("Files can't be more than 5", 400));

  const [chat, user] = await Promise.all([
    Chat.findById(chatId),
    User.findById(req.user, "name"),
  ]);

  if (!chat) return next(new ErrorHandler("Chat not found", 404));

  if (files.length < 1)
    return next(new ErrorHandler("Please provide attachments", 400));

  //from cloudinary
  const attachments = await uploadFilesToCloudinary(files);

  const messageForDB = {
    content: "",
    attachments,
    sender: user._id,
    chat: chatId,
  };

  const message = await Message.create(messageForDB);
  const populatedMessage = await Message.findById(message._id)
    .populate("sender", "name avatar")
    .lean();

  chat.members.forEach((memberId) => {
    const existingRecord = chat.unreadCounts.find(
      (item) => item.user.toString() === memberId.toString(),
    );

    if (memberId.toString() === req.user.toString()) {
      if (existingRecord) existingRecord.count = 0;
      return;
    }

    if (chatPresenceMap.get(chatId.toString())?.has(memberId.toString())) {
      if (existingRecord) existingRecord.count = 0;
      return;
    }

    if (existingRecord) existingRecord.count += 1;
    else chat.unreadCounts.push({ user: memberId, count: 1 });
  });

  await chat.save();

  emitEvent(req, NEW_MESSAGE, chat.members, {
    message: normalizeMessagePayload(populatedMessage),
    chatId,
  });

  emitEvent(req, NEW_MESSAGE_ALERT, chat.members, { chatId });
  emitEvent(req, REFETCH_CHATS, chat.members);
  return res.status(200).json({
    success: true,
    message: normalizeMessagePayload(populatedMessage),
  });
});

const getChatDetails = TryCatch(async (req, res, next) => {
  if (req.query.populate === "true") {
    const chat = await Chat.findById(req.params.id)
      .populate("members", "name avatar username bio createdAt")
      .lean();
    if (!chat) return next(new ErrorHandler("Chat not found", 404));

    chat.members = chat.members.map(({ _id, name, avatar, username, bio, createdAt }) => ({
      _id,
      name,
      avatar: avatar.url,
      username,
      bio,
      createdAt,
    }));

    return res.status(200).json({
      success: true,
      chat,
    });
  } else {
    const chat = await Chat.findById(req.params.id);
    if (!chat) return next(new ErrorHandler("Chat not found", 404));
    return res.status(200).json({
      success: true,
      chat,
    });
  }
});

const renameGroup = TryCatch(async (req, res, next) => {
  const chatId = req.params.id;
  const { name } = req.body;

  const chat = await Chat.findById(chatId);

  if (!chat) return next(new ErrorHandler("chat not found", 404));

  if (!chat.groupChat)
    return next(new ErrorHandler("This is not a group chat", 400));

  if (chat.creator.toString() !== req.user.toString())
    return next(
      new ErrorHandler("You are not authorized to rename this group", 403),
    );

  chat.name = name;
  await chat.save();

  emitEvent(req, REFETCH_CHATS, chat.members);

  return res.status(200).json({
    success: true,
    message: "Group renamed successfully",
  });
});

const deleteChat = TryCatch(async (req, res, next) => {
  const chatId = req.params.id;
  const chat = await Chat.findById(chatId);

  if (!chat) return next(new ErrorHandler("chat not found", 404));

  const members = chat.members;

  if (chat.groupChat && chat.creator.toString() !== req.user.toString())
    return next(
      new ErrorHandler("You are not authorized to delete this group chat", 403),
    );

  if (!chat.groupChat && !chat.members.includes(req.user.toString())) {
    return next(
      new ErrorHandler("You are not allowed to delete the chat", 403),
    );
  }

  const messagesWithAttachments = await Message.find({
    chat: chatId,
    attachments: { $exists: true, $ne: [] },
  });

  const attachmentsToDelete = [];

  messagesWithAttachments.forEach(({ attachments }) =>
    attachments.forEach((attachment) => attachmentsToDelete.push(attachment)),
  );

  await Promise.all([
    deleteFilesFromCloudinary(attachmentsToDelete),
    chat.deleteOne(),
    Message.deleteMany({ chat: chatId }),
  ]);

  emitEvent(req, REFETCH_CHATS, members);

  return res.status(200).json({
    success: true,
    message: "Chat deleted successfully",
  });
});

const getMessages = TryCatch(async (req, res, next) => {
  const chatId = req.params.id;
  const { page = 1 } = req.query;

  const resultPerPage = 20;
  const skip = (page - 1) * resultPerPage;

  const chat = await Chat.findById(chatId);

  if (!chat) return next(new ErrorHandler("Chat not found", 404));

  if (!chat.members.includes(req.user.toString()))
    return next(
      new ErrorHandler("You are not allowed to access this chat", 403),
    );

  const [messages, totalMessagesCount] = await Promise.all([
    Message.find({ chat: chatId })
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(resultPerPage)
      .populate("sender", "name avatar username")
      .lean(),
    Message.countDocuments({ chat: chatId }),
  ]);

  const wasMarkedRead = await markChatAsRead(chat, req.user);
  if (wasMarkedRead) {
    emitEvent(req, REFETCH_CHATS, [req.user]);
  }

  const totalPages = Math.ceil(totalMessagesCount / resultPerPage) || 0;

  return res.status(200).json({
    success: true,
    messages: messages.reverse().map((message) => ({
      ...normalizeMessagePayload(message),
      sender: message.sender,
    })),
    totalPages,
  });
});

const sendTextMessage = TryCatch(async (req, res, next) => {
  const { chatId, content, replyToMessageId } = req.body;

  if (!content?.trim()) {
    return next(new ErrorHandler("Message content is required", 400));
  }

  const [chat, user, replySource] = await Promise.all([
    Chat.findById(chatId),
    User.findById(req.user, "name avatar"),
    replyToMessageId ? Message.findById(replyToMessageId).populate("sender", "name") : null,
  ]);

  if (!chat) return next(new ErrorHandler("Chat not found", 404));
  if (!chat.members.some((member) => member.toString() === req.user.toString())) {
    return next(new ErrorHandler("You are not allowed to send messages in this chat", 403));
  }
  if (replyToMessageId && !replySource) {
    return next(new ErrorHandler("Reply message not found", 404));
  }
  if (replySource && replySource.chat.toString() !== chatId.toString()) {
    return next(new ErrorHandler("Reply message does not belong to this chat", 400));
  }

  const replyTo = replySource
    ? {
        messageId: replySource._id,
        content: replySource.content || (replySource.attachments?.length ? "Attachment" : ""),
        senderId: replySource.sender?._id || replySource.sender,
        senderName: replySource.sender?.name || "Unknown",
      }
    : undefined;

  const message = await Message.create({
    content: content.trim(),
    sender: user._id,
    chat: chatId,
    replyTo,
  });

  const populatedMessage = await Message.findById(message._id)
    .populate("sender", "name avatar")
    .lean();

  chat.members.forEach((memberId) => {
    const existingRecord = chat.unreadCounts.find(
      (item) => item.user.toString() === memberId.toString(),
    );

    if (memberId.toString() === req.user.toString()) {
      if (existingRecord) existingRecord.count = 0;
      return;
    }

    if (chatPresenceMap.get(chatId.toString())?.has(memberId.toString())) {
      if (existingRecord) existingRecord.count = 0;
      return;
    }

    if (existingRecord) existingRecord.count += 1;
    else chat.unreadCounts.push({ user: memberId, count: 1 });
  });

  await chat.save();

  emitEvent(req, NEW_MESSAGE, chat.members, {
    chatId,
    message: normalizeMessagePayload(populatedMessage),
  });
  emitEvent(req, NEW_MESSAGE_ALERT, chat.members, { chatId });
  emitEvent(req, REFETCH_CHATS, chat.members);

  return res.status(201).json({
    success: true,
    message: normalizeMessagePayload(populatedMessage),
  });
});

const deleteMessage = TryCatch(async (req, res, next) => {
  const messageId = req.params.id;

  const message = await Message.findById(messageId);

  if (!message) return next(new ErrorHandler("Message not found", 404));
  if (message.sender.toString() !== req.user.toString())
    return next(
      new ErrorHandler("You are not authorized to delete this message", 403),
    );

  const chat = await Chat.findById(message.chat);
  if (!chat) return next(new ErrorHandler("Chat not found", 404));

  await Promise.all([
    message.attachments?.length
      ? deleteFilesFromCloudinary(message.attachments)
      : Promise.resolve(),
    message.deleteOne(),
  ]);

  emitEvent(req, MESSAGE_DELETED, chat.members, {
    chatId: chat._id,
    messageId,
  });
  emitEvent(req, REFETCH_CHATS, chat.members);

  return res.status(200).json({
    success: true,
    message: "Message deleted successfully",
  });
});

const reactToMessage = TryCatch(async (req, res, next) => {
  const messageId = req.params.id;
  const { emoji } = req.body;

  if (!emoji) return next(new ErrorHandler("Emoji is required", 400));

  const message = await Message.findById(messageId);
  if (!message) return next(new ErrorHandler("Message not found", 404));

  const chat = await Chat.findById(message.chat);
  if (!chat) return next(new ErrorHandler("Chat not found", 404));
  if (!chat.members.some((member) => member.toString() === req.user.toString())) {
    return next(new ErrorHandler("You are not allowed to react in this chat", 403));
  }

  const reaction = message.reactions.find((item) => item.emoji === emoji);
  if (reaction) {
    const alreadyReacted = reaction.users.some((userId) => userId.toString() === req.user.toString());
    if (alreadyReacted) {
      reaction.users = reaction.users.filter((userId) => userId.toString() !== req.user.toString());
    } else {
      reaction.users.push(req.user);
    }
  } else {
    message.reactions.push({
      emoji,
      users: [req.user],
    });
  }

  message.reactions = message.reactions.filter((item) => item.users.length > 0);
  await message.save();

  const payload = {
    chatId: chat._id,
    messageId: message._id,
    reactions: normalizeReactions(message.reactions),
  };

  emitEvent(req, MESSAGE_REACTION_UPDATED, chat.members, payload);

  return res.status(200).json({
    success: true,
    ...payload,
  });
});

const togglePinnedChat = TryCatch(async (req, res, next) => {
  const chatId = req.params.id;
  const chat = await Chat.findById(chatId);

  if (!chat) return next(new ErrorHandler("Chat not found", 404));
  if (!chat.members.some((member) => member.toString() === req.user.toString())) {
    return next(new ErrorHandler("You are not allowed to update this chat", 403));
  }

  const alreadyPinned = chat.pinnedBy.some((userId) => userId.toString() === req.user.toString());

  if (alreadyPinned) {
    chat.pinnedBy = chat.pinnedBy.filter((userId) => userId.toString() !== req.user.toString());
  } else {
    chat.pinnedBy.push(req.user);
  }

  await chat.save();

  return res.status(200).json({
    success: true,
    isPinned: !alreadyPinned,
    message: alreadyPinned ? "Chat unpinned" : "Chat pinned",
  });
});

const getSharedContent = TryCatch(async (req, res, next) => {
  const chatId = req.params.id;
  const chat = await Chat.findById(chatId);

  if (!chat) return next(new ErrorHandler("Chat not found", 404));
  if (!chat.members.some((member) => member.toString() === req.user.toString())) {
    return next(new ErrorHandler("You are not allowed to access this chat", 403));
  }

  const messages = await Message.find({ chat: chatId })
    .sort({ createdAt: -1 })
    .populate("sender", "name")
    .lean();

  const media = [];
  const files = [];
  const linkMap = new Map();
  const linkRegex = /https?:\/\/[^\s]+/g;

  messages.forEach((message) => {
    (message.attachments || []).forEach((attachment) => {
      let kind = attachment.kind;
      if (!kind || kind === "file") {
        const url = (attachment.url || "").split("?")[0].toLowerCase();
        if (/\.(png|jpg|jpeg|gif|webp|avif|bmp|svg)$/.test(url)) kind = "image";
        else if (/\.(mp3|wav|ogg|m4a|aac|flac)$/.test(url)) kind = "audio";
        else if (/\.(mp4|webm|mov|mkv|avi|m4v)$/.test(url)) kind = "video";
        else kind = "file";
      }

      const item = {
        messageId: message._id,
        url: attachment.url,
        name: attachment.name || attachment.public_id,
        kind: kind,
        senderName: message.sender?.name || "Unknown",
        createdAt: message.createdAt,
      };

      if (["image", "video", "audio"].includes(item.kind)) {
        media.push(item);
      } else {
        files.push(item);
      }
    });

    const matches = message.content?.match(linkRegex) || [];
    matches.forEach((match) => {
      if (!linkMap.has(match)) {
        linkMap.set(match, {
          messageId: message._id,
          url: match,
          senderName: message.sender?.name || "Unknown",
          createdAt: message.createdAt,
        });
      }
    });
  });

  return res.status(200).json({
    success: true,
    media,
    files,
    links: Array.from(linkMap.values()),
  });
});

export {
  addMembers,
  deleteChat,
  getChatDetails,
  getMessages,
  getMyChats,
  getMyGroups,
  getSharedContent,
  leaveGroup,
  newGroupChat,
  deleteMessage,
  reactToMessage,
  removeMembers,
  renameGroup,
  sendAttachments,
  sendTextMessage,
  togglePinnedChat,
};
