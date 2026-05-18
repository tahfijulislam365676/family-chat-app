const express = require('express');
const http = require('http');
const mongoose = require('mongoose');
const socketIo = require('socket.io');

const app = express();
const server = http.createServer(app);

// সকেট কনফিগারেশন: অনলাইন সার্ভারে স্ট্যাবল কানেকশনের জন্য আপডেট করা হয়েছে
const io = socketIo(server, {
    cors: { origin: "*" },
    transports: ['websocket', 'polling']
});

app.use(express.static('public'));
app.use(express.json());

// --- MongoDB Atlas অনলাইন কানেকশন (আপনার দেওয়া পাসওয়ার্ড ও লিংক অনুযায়ী) ---
const DB_URI = "mongodb+srv://tahfijulislam365676_db_user:J98w7SWNscFksfRG@cluster0.9pu3xn3.mongodb.net/familyChat?retryWrites=true&w=majority";

mongoose.connect(DB_URI)
    .then(() => console.log("অনলাইন ডাটাবেস (MongoDB Atlas) সফলভাবে কানেক্ট হয়েছে! ✅"))
    .catch(err => {
        console.log("ডাটাবেস কানেকশনে সমস্যা হচ্ছে! এরর টাইপ:", err.name);
    });

// --- ডাটাবেস স্কিমা (অপরিবর্তিত) ---
const UserSchema = new mongoose.Schema({
    userName: String,
    userNumber: { type: String, unique: true },
    userPassword: String
});
const User = mongoose.model('User', UserSchema);

const ContactSchema = new mongoose.Schema({
    name: String,
    phone: String,
    owner: String
});
const Contact = mongoose.model('Contact', ContactSchema);

const MessageSchema = new mongoose.Schema({
    sender: String,
    receiver: String,
    message: String,
    time: { type: Date, default: Date.now }
});
const Message = mongoose.model('Message', MessageSchema);

// --- এপিআই রাউটস (আপনার সব ফাংশন আগের মতোই রাখা হয়েছে) ---
app.post('/api/signup', async (req, res) => {
    try {
        const newUser = new User(req.body);
        await newUser.save();
        res.json({ success: true, message: "অ্যাকাউন্ট তৈরি সফল!" });
    } catch (err) {
        res.json({ success: false, message: "এই নাম্বারটি আগেই নিবন্ধিত!" });
    }
});

app.post('/api/login', async (req, res) => {
    try {
        const user = await User.findOne({ userNumber: req.body.userNumber, userPassword: req.body.userPassword });
        if(user) res.json({ success: true, user });
        else res.json({ success: false, message: "নাম্বার বা পাসওয়ার্ড ভুল!" });
    } catch (err) {
        res.json({ success: false, message: "সার্ভারে সমস্যা হয়েছে!" });
    }
});

app.post('/api/save-contact', async (req, res) => {
    try {
        const newContact = new Contact(req.body);
        await newContact.save();
        res.json({ success: true });
    } catch (err) {
        res.json({ success: false });
    }
});

app.get('/api/get-contacts', async (req, res) => {
    try {
        const contacts = await Contact.find({ owner: req.query.user });
        res.json({ success: true, contacts });
    } catch (err) {
        res.json({ success: false });
    }
});

app.get('/api/get-messages', async (req, res) => {
    try {
        const { from, to } = req.query;
        const messages = await Message.find({
            $or: [
                { sender: from, receiver: to },
                { sender: to, receiver: from }
            ]
        }).sort({ time: 1 });
        res.json({ success: true, messages });
    } catch (err) {
        res.json({ success: false });
    }
});

app.post('/api/reset-password', async (req, res) => {
    try {
        const { userNumber, newPassword } = req.body;
        const user = await User.findOneAndUpdate({ userNumber: userNumber }, { userPassword: newPassword });
        if(user) res.json({ success: true, message: "পাসওয়ার্ড সফলভাবে আপডেট হয়েছে!" });
        else res.json({ success: false, message: "এই নাম্বারে কোনো ইউজার পাওয়া যায়নি!" });
    } catch (err) {
        res.json({ success: false, message: "রিসেট করতে সমস্যা হয়েছে!" });
    }
});

// --- সকেট লজিক (অনলাইন ডেটা ট্রান্সফার ফিক্স) ---
let onlineUsers = {}; 

io.on('connection', (socket) => {
    
    // ইউজার জয়েন করলে তাকে নাম্বার অনুযায়ী ম্যাপে রাখা
    socket.on('join', (myNumber) => {
        if (myNumber) {
            onlineUsers[myNumber] = socket.id; 
            console.log(`ইউজার ${myNumber} অনলাইন। আইডি: ${socket.id}`);
        }
    });

    // মেসেজ আদান-প্রদান (সরাসরি সকেট আইডি ব্যবহার করে)
    socket.on('send-msg', async (data) => {
        try {
            const newMsg = new Message({
                sender: data.from,
                receiver: data.to,
                message: data.msg
            });
            await newMsg.save();
            
            const targetId = onlineUsers[data.to];
            if (targetId) {
                io.to(targetId).emit('receive-msg', data);
            }
        } catch (err) {
            console.log("মেসেজ প্রসেস করতে এরর!");
        }
    });

    // ভিডিও ও অডিও কল হ্যান্ডলিং
    socket.on('call-user', (data) => {
        const targetId = onlineUsers[data.to];
        if (targetId) {
            io.to(targetId).emit('incoming-call', {
                from: data.from,
                signal: data.signal,
                type: data.type
            });
        }
    });

    socket.on('answer-call', (data) => {
        const targetId = onlineUsers[data.to];
        if (targetId) {
            io.to(targetId).emit('call-accepted', data.signal);
        }
    });

    socket.on('end-call', (data) => {
        const targetId = onlineUsers[data.to];
        if (targetId) {
            io.to(targetId).emit('call-ended');
        }
    });
    
    socket.on('disconnect', () => {
        for (let phone in onlineUsers) {
            if (onlineUsers[phone] === socket.id) {
                delete onlineUsers[phone];
                console.log(`${phone} অফলাইন হয়েছে`);
                break;
            }
        }
    });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`সার্ভার চালু হয়েছে ${PORT} পোর্টে...`));