import mongoose, { Types } from "mongoose";
const { Schema, model, models } = mongoose;

const chatSchema = new Schema(
  {
    name: {
      type: String,
      required: true,
    },
    groupChat: {
      type: Boolean,
      default: false,
    },
    creator: {
      type: Types.ObjectId,
      ref: "User",
    },
    members: [
      {
        type: Types.ObjectId,
        ref: "User",
      },
    ],
    photo: {
      type: String,
      default: "",
    },
    pinnedBy: [
      {
        type: Types.ObjectId,
        ref: "User",
      },
    ],
    unreadCounts: [
      {
        user: {
          type: Types.ObjectId,
          ref: "User",
          required: true,
        },
        count: {
          type: Number,
          default: 0,
        },
      },
    ],
  },
  { timestamps: true },
);

export const Chat = models.Chat || model("Chat", chatSchema);
