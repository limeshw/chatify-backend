const corsOptions = {
    origin: [process.env.CLIENT_URL],
    methods:["GET","POST","PUT","DELETE"],
    credentials: true,
}

const CHATIFY_TOKEN = "chatify-token";
const CHATIFY_ADMIN_TOKEN = "chatify-admin-token";

export {corsOptions,CHATIFY_TOKEN,CHATIFY_ADMIN_TOKEN}    