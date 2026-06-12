import { adminSecretKey } from "../app.js";
import { ErrorHandler } from "../utils/utility.js";
import jwt from "jsonwebtoken";
import { TryCatch } from "./error.middleware.js";
import { CHATIFY_ADMIN_TOKEN, CHATIFY_TOKEN } from "../constants/config.js";
import { User } from "../models/user.model.js";

export const isAuthenticated = TryCatch((req, res, next) => {
  const token = req.cookies[CHATIFY_TOKEN];
  if (!token)
    return next(new ErrorHandler("Please login to access this route", 401));

  const decodedToken = jwt.verify(token, process.env.JWT_SECRET);
  req.user = decodedToken._id;

  next();
});

export const adminOnly = TryCatch((req, res, next) => {
  const token = req.cookies[CHATIFY_ADMIN_TOKEN];

  if (!token)
    return next(new ErrorHandler("Only Admin can access this route", 401));

  const secretKey = jwt.verify(token, process.env.JWT_SECRET);

  const isMatched = secretKey === adminSecretKey;

  if (!isMatched)
    return next(new ErrorHandler("Only Admin can access this route", 401));

  next();
});

export const socketAuthenticator = async (err, socket, next) => {
  try {
    if(err) return next(err);
    
    const authToken = socket.request.cookies[CHATIFY_TOKEN];
    if (!authToken) {
      return next(new ErrorHandler("Please login to access this route", 401));
    }

    const decodedToken = jwt.verify(authToken, process.env.JWT_SECRET);
    const user = await User.findById(decodedToken._id);
    if (!user) {
      return next(new ErrorHandler("User not found", 404));
    }
    socket.user = user;
    
    return next();
  } catch (error) {
    console.log(error);
    
    return next(new ErrorHandler(error.message, 500));
  }
}
