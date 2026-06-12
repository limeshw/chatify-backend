const corsOptions = {
    origin: ["http://localhost:5174","http://localhost:4174","http://localhost:3000","http://localhost:5173",process.env.CLIENT_URL],
    methods:["GET","POST","PUT","DELETE"],
    credentials: true,
}

const CHATIFY_TOKEN = "chatify-token";
const CHATIFY_ADMIN_TOKEN = "chatify-admin-token";

export {corsOptions,CHATIFY_TOKEN,CHATIFY_ADMIN_TOKEN}    