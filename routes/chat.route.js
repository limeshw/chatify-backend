import express from "express";
import { isAuthenticated } from "../middlewares/auth.middleware.js";
import {
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
} from "../controllers/chat.controller.js";
import { attachmentsMulter } from "../middlewares/multer.middleware.js";
import {
  addMemberValidator,
  chatIdValidator,
  chatRenameValidator,
  messageIdValidator,
  messageReactionValidator,
  newGroupChatValidator,
  removeMemberValidator,
  sendAttachmentsValidator,
  sendMessageValidator,
  validateHandler,
} from "../lib/validators.lib.js";

const router = express.Router();

//Autherized routes
router.use(isAuthenticated);
router.post("/new", newGroupChatValidator(), validateHandler, newGroupChat);
router.get("/my", getMyChats);
router.get("/my/groups", getMyGroups);
router.get("/shared/:id", chatIdValidator(), validateHandler, getSharedContent);
router.put("/addmembers", addMemberValidator(), validateHandler, addMembers);
router.put("/removemember", removeMemberValidator(), validateHandler, removeMembers);
router.put("/:id/pin", chatIdValidator(), validateHandler, togglePinnedChat);
router.delete("/leave/:id", chatIdValidator(), validateHandler, leaveGroup);
router.post("/message/text", sendMessageValidator(), validateHandler, sendTextMessage);
router.post(
  "/message",
  attachmentsMulter,
  sendAttachmentsValidator(),
  validateHandler,
  sendAttachments,
);
router.get("/message/:id", chatIdValidator(), validateHandler, getMessages);
router.put("/message/:id/reaction", messageReactionValidator(), validateHandler, reactToMessage);
router.delete("/message/:id", messageIdValidator(), validateHandler, deleteMessage);

router
  .route("/:id")
  .get(chatIdValidator(), validateHandler, getChatDetails)
  .put(chatRenameValidator(), validateHandler, renameGroup)
  .delete(chatIdValidator(), validateHandler, deleteChat);

export default router;
