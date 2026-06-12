import express from "express";
import {
  acceptFriendRequest,
  getMyFriends,
  getMyNotifications,
  getMyProfile,
  getEmojis,
  login,
  logout,
  newUser,
  searchUser,
  sendFriendRequest,
} from "../controllers/user.controller.js";
import { singleAvatar } from "../middlewares/multer.middleware.js";
import { isAuthenticated } from "../middlewares/auth.middleware.js";
import {
  acceptFriendRequestValidator,
  loginValidator,
  registerValidator,
  sendFriendRequestValidator,
  validateHandler,
} from "../lib/validators.lib.js";

const router = express.Router();

router.post(
  "/new",
  singleAvatar,
  registerValidator(),
  validateHandler,
  newUser,
);
router.post("/login", loginValidator(), validateHandler, login);

//Autherized routes
router.use(isAuthenticated);
router.get("/me", getMyProfile);
router.get("/logout", logout);
router.get("/search", searchUser);
router.put(
  "/sendrequest",
  sendFriendRequestValidator(),
  validateHandler,
  sendFriendRequest,
);
router.put(
  "/acceptrequest",
  acceptFriendRequestValidator(),
  validateHandler,
  acceptFriendRequest,
);

router.get("/notifications", getMyNotifications);
router.get("/friends", getMyFriends);
router.get("/emojis", getEmojis);

export default router;
