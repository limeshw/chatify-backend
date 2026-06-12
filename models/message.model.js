import mongoose, { Types } from "mongoose";
const { Schema, model, models } = mongoose;

const messageSchema = new Schema(
  {
    content: String,

    attachments: [
      {
        public_id: {
          type: String,
          required: true,
        },
        url: {
          type: String,
          required: true,
        },
        name: {
          type: String,
        },
        kind: {
          type: String,
          enum: ["image", "audio", "video", "file"],
        },
        resource_type: {
          type: String,
          enum: ["image", "video", "raw"],
        },
        type: {
          type: String,
        },
        format: {
          type: String,
        },
      },
    ],
    sender: {
      type: Types.ObjectId,
      ref: "User",
      required: true,
    },
    chat: {
      type: Types.ObjectId,
      ref: "Chat",
      required: true,
    },
    replyTo: {
      messageId: {
        type: Types.ObjectId,
        ref: "Message",
      },
      content: String,
      senderId: {
        type: Types.ObjectId,
        ref: "User",
      },
      senderName: String,
    },
    reactions: [
      {
        emoji: {
          type: String,
          required: true,
        },
        users: [
          {
            type: Types.ObjectId,
            ref: "User",
          },
        ],
      },
    ],
  },
  { timestamps: true },
);

export const Message =
  mongoose.models.Message || model("Message", messageSchema);
