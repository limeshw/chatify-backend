import { body, check, param, validationResult } from "express-validator";
import { ErrorHandler } from "../utils/utility.js";

const validateHandler = (req, res, next) => {
  const errors = validationResult(req);

  const errorMessages = errors
    .array()
    .map((error) => error.msg)
    .join(", ");

  if (errors.isEmpty()) return next();
  else next(new ErrorHandler(errorMessages, 400));
};

const registerValidator = () => [
  body("name", "Name is required").notEmpty(),
  body("username", "Username is required").notEmpty(),
  body("password", "Password is required").notEmpty(),
  body("bio", "Bio is required").notEmpty(),
];

const loginValidator = () => [
  body("username", "Username is required").notEmpty(),
  body("password", "Password is required").notEmpty(),
];

const newGroupChatValidator = () => [
  body("name", "Name is required").notEmpty(),
  body("members")
    .notEmpty()
    .withMessage("Members is required")
    .isArray({ min: 2, max: 100 })
    .withMessage("Members must be between 2 and 100"),
];

const addMemberValidator = () => [
  body("chatId", "Chat ID is required").notEmpty(),
  body("members")
    .notEmpty()
    .withMessage("Members is required")
    .isArray({ min: 1, max: 97 })
    .withMessage("Members must be between 1 and 97"),
];

const removeMemberValidator = () => [
  body("chatId", "Chat ID is required").notEmpty(),
  body("userId", "User ID is required").notEmpty(),
];

const sendAttachmentsValidator = () => [
  body("chatId", "Chat ID is required").notEmpty(),
];

const sendMessageValidator = () => [
  body("chatId", "Chat ID is required").notEmpty(),
  body("content", "Message content is required").notEmpty(),
];

const messageReactionValidator = () => [
  param("id", "Message ID is required").notEmpty(),
  body("emoji", "Emoji is required").notEmpty(),
];

const chatIdValidator = () => [param("id", "Chat ID is required").notEmpty()];
const messageIdValidator = () => [
  param("id", "Message ID is required").notEmpty(),
];

const chatRenameValidator = () => [
  param("id", "Chat ID is required").notEmpty(),
  body("name", "Name is required").notEmpty(),
];

const sendFriendRequestValidator = () => [
  body("userId", "User ID is required").notEmpty(),
];

const acceptFriendRequestValidator = () => [
  body("requestId", "Request ID is required").notEmpty(),
  body("accept")
    .notEmpty()
    .withMessage("Accept is required")
    .isBoolean()
    .withMessage("Accept must be a boolean"),
];

const adminLoginValidator = () => [
  body("secretKey", "Secret Key is required").notEmpty(),
];

export {
  registerValidator,
  validateHandler,
  loginValidator,
  newGroupChatValidator,
  addMemberValidator,
  removeMemberValidator,
  sendAttachmentsValidator,
  sendMessageValidator,
  messageReactionValidator,
  chatIdValidator,
  messageIdValidator,
  chatRenameValidator,
  sendFriendRequestValidator,
  acceptFriendRequestValidator,
  adminLoginValidator,
};
