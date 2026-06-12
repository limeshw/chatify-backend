import mongoose from "mongoose";
import dotenv from "dotenv";
import jwt from "jsonwebtoken";
import { v4 as uuid } from "uuid";
import { v2 as cloudinary } from "cloudinary";
import { getBase64, getSockets } from "../lib/helper.lib.js";

dotenv.config({
  path: "./.env",
});

const cookieOptions = {
  maxAge: 15 * 24 * 60 * 60 * 1000,
  httpOnly: true,
  secure: process.env.NODE_ENV === "PRODUCTION",
  sameSite: process.env.NODE_ENV === "PRODUCTION" ? "none" : "lax",
};

const connectDB = (uri) => {
  mongoose
    .connect(uri, { dbName: process.env.DBNAME })
    .then((data) => {
      console.log(`Connected to DB : ${data.connection.host}`);
    })
    .catch((err) => {
      throw err;
    });
};

const sendToken = (res, code, user, message) => {
  const token = jwt.sign({ _id: user._id }, process.env.JWT_SECRET, {
    expiresIn: "15d",
  });

  return res.status(code).cookie("chatify-token", token, cookieOptions).json({
    success: true,
    user,
    message,
  });
};

const emitEvent = (req, event, users, data) => {
  const io = req.app.get("io");
  const usersSocket = getSockets(users);
  io.to(usersSocket).emit(event, data);
};

const sanitizeBaseName = (name = "file") =>
  name
    .replace(/\.[^/.]+$/, "")
    .trim()
    .replace(/[^a-zA-Z0-9-_]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "") || "file";

const sanitizeExtension = (name = "") => {
  const match = name.toLowerCase().match(/\.([a-z0-9]+)$/);
  return match ? `.${match[1]}` : "";
};

const getAttachmentKind = (file) => {
  if (file.mimetype?.startsWith("image/")) return "image";
  if (file.mimetype?.startsWith("audio/")) return "audio";
  if (file.mimetype?.startsWith("video/")) return "video";
  return "file";
};

const getCloudinaryResourceType = (file) => {
  if (file.mimetype?.startsWith("image/")) return "image";
  if (file.mimetype?.startsWith("audio/")) return "video";
  if (file.mimetype?.startsWith("video/")) return "video";
  return "raw";
};

const uploadFilesToCloudinary = async (files = []) => {
  const uploadPromises = files.map((file) => {
    const resourceType = getCloudinaryResourceType(file);
    const baseName = sanitizeBaseName(file.originalname);
    const extension = sanitizeExtension(file.originalname);
    const publicId = resourceType === "raw"
      ? `${uuid()}-${baseName}${extension}`
      : `${uuid()}-${baseName}`;

    return new Promise((resolve, reject) => {
      cloudinary.uploader.upload(
        getBase64(file),
        {
          resource_type: resourceType,
          type: "upload",
          public_id: publicId,
          use_filename: false,
          unique_filename: false,
          overwrite: false,
          access_mode: "public",
          filename_override: file.originalname,
        },
        (err, result) => {
          if (err) {
            reject(err);
          } else {
            resolve(result);
          }
        },
      );
    });
  });
  try {
    const results = await Promise.all(uploadPromises);

    const formattedResults = results.map((result, index) => ({
      url: result.secure_url || result.url,
      public_id: result.public_id,
      name: files[index]?.originalname || result.original_filename || result.public_id.split("/").pop(),
      kind: getAttachmentKind(files[index]),
      resource_type: result.resource_type,
      type: result.type,
      format: result.format,
    }));
    return formattedResults;
  } catch (error) {
    throw new Error("Error uploading files to Cloudinary");
  }
};

const deleteFilesFromCloudinary = async (attachments = []) => {
  if (!attachments.length) return;

  await Promise.all(
    attachments.map(async (attachment) => {
      const resourceTypes = attachment.resource_type
        ? [attachment.resource_type]
        : ["image", "video", "raw"];

      for (const resourceType of resourceTypes) {
        const result = await cloudinary.uploader.destroy(attachment.public_id, {
          resource_type: resourceType,
          type: attachment.type || "upload",
          invalidate: true,
        });

        if (result.result === "ok" || result.result === "not found") {
          return result;
        }
      }

      return null;
    }),
  );
};

export {
  cookieOptions,
  connectDB,
  sendToken,
  emitEvent,
  deleteFilesFromCloudinary,
  uploadFilesToCloudinary,
};
