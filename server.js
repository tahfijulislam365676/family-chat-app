const express = require('express');
const http = require('http');
const mongoose = require('mongoose');
const socketIo = require('socket.io');

const app = express();
const server = http.createServer(app);

// সকেট কনফিগারেশন আপডেট করা হয়েছে অনলাইন সার্ভারের জন্য
const io = socketIo(server, {
    cors: { origin: "*" },
    transports: ['websocket', 'polling']
});

app.use(express.static('public'));
app.use(express.json());

// --- MongoDB Atlas অনলাইন কানেকশন ---
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

// --- এপিআই রাউটস (অপরিবর্তিত) ---
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

// --- সকেট লজিক (নিখুঁত সংশোধন) ---
let users = {}; // একটি অবজেক্টে নাম্বার এবং সকেট আইডি জমা রাখা হবে

io.on('connection', (socket) => {
    socket.on('join', (myNumber) => {
        if (myNumber) {
            socket.join(myNumber); // নাম্বার দিয়ে একটি ভার্চুয়াল রুম তৈরি
            users[myNumber] = socket.id; // নাম্বারকে সকেট আইডির সাথে ম্যাপ করা
            console.log(myNumber + " রুমে জয়েন করেছে। সকেট আইডি: " + socket.id);
        }
    });

    socket.on('send-msg', async (data) => {
        try {
            const newMsg = new Message({
                sender: data.from,
                receiver: data.to,
                message: data.msg
            });
            await newMsg.save();
            
            // receiver এর নাম্বার ওয়ালা রুমে মেসেজ পাঠানো
            io.to(data.to).emit('receive-msg', data);
        } catch (err) {
            console.log("মেসেজ সেভ করতে সমস্যা হয়েছে");
        }
    });

    // ভিডিও কল শুরু
    socket.on('call-user', (data) => {
        console.log(`কল রিকোয়েস্ট: ${data.from} থেকে ${data.to}`);
        io.to(data.to).emit('incoming-call', {
            from: data.from,
            signal: data.signal || data.signalData,
            type: data.type
        });
    });

    socket.on('answer-call', (data) => {
        io.to(data.to).emit('call-accepted', data.signal);
    });

    socket.on('webrtc-signal', (data) => {
        io.to(data.to).emit('webrtc-signal', data);
    });

    socket.on('end-call', (data) => {
        io.to(data.to).emit('call-ended');
    });
    
    socket.on('disconnect', () => {
        // ইউজার চলে গেলে লিস্ট থেকে মুছে ফেলা
        for (let phone in users) {
            if (users[phone] === socket.id) {
                delete users[phone];
                break;
            }
        }
        console.log("ইউজার ডিসকানেক্ট হয়েছে");
    });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`সার্ভার চালু হয়েছে ${PORT} পোর্টে...`));