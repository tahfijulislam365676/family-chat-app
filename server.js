const express = require('express');
const http = require('http');
const mongoose = require('mongoose');
const socketIo = require('socket.io');

const app = express();
const server = http.createServer(app);

// সকেট কনফিগারেশন
const io = socketIo(server, {
    cors: { origin: "*" },
    transports: ['websocket', 'polling']
});

app.use(express.static('public'));
app.use(express.json());

// --- ১. বাংলা নাম্বার থেকে ইংরেজি নাম্বারে রূপান্তরের ফাংশন (Internal Helper) ---
function convertToEn(str) {
    if (!str) return str;
    const banglaDigits = {'০':'0','১':'1','২':'2','৩':'3','৪':'4','৫':'5','৬':'6','৭':'7','৮':'8','৯':'9'};
    return str.toString().replace(/[০-৯]/g, function(w) { return banglaDigits[w]; });
}

// --- MongoDB Atlas অনলাইন কানেকশন ---
const DB_URI = "mongodb+srv://tahfijulislam365676_db_user:J98w7SWNscFksfRG@cluster0.9pu3xn3.mongodb.net/familyChat?retryWrites=true&w=majority";

mongoose.connect(DB_URI)
    .then(() => console.log("অনলাইন ডাটাবেস (MongoDB Atlas) সফলভাবে কানেক্ট হয়েছে! ✅"))
    .catch(err => {
        console.log("ডাটাবেস কানেকশনে সমস্যা হচ্ছে! এরর টাইপ:", err.name);
    });

// --- ডাটাবেস স্কিমা ---
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

// --- এপিআই রাউটস (নাম্বার কনভার্ট সহ) ---
app.post('/api/signup', async (req, res) => {
    try {
        req.body.userNumber = convertToEn(req.body.userNumber); // ফিক্স
        const newUser = new User(req.body);
        await newUser.save();
        res.json({ success: true, message: "অ্যাকাউন্ট তৈরি সফল!" });
    } catch (err) {
        res.json({ success: false, message: "এই নাম্বারটি আগেই নিবন্ধিত!" });
    }
});

app.post('/api/login', async (req, res) => {
    try {
        const phone = convertToEn(req.body.userNumber); // ফিক্স
        const user = await User.findOne({ userNumber: phone, userPassword: req.body.userPassword });
        if(user) res.json({ success: true, user });
        else res.json({ success: false, message: "নাম্বার বা পাসওয়ার্ড ভুল!" });
    } catch (err) {
        res.json({ success: false, message: "সার্ভারে সমস্যা হয়েছে!" });
    }
});

app.post('/api/save-contact', async (req, res) => {
    try {
        req.body.phone = convertToEn(req.body.phone); // ফিক্স
        req.body.owner = convertToEn(req.body.owner); // ফিক্স
        const newContact = new Contact(req.body);
        await newContact.save();
        res.json({ success: true });
    } catch (err) {
        res.json({ success: false });
    }
});

app.get('/api/get-contacts', async (req, res) => {
    try {
        const ownerPhone = convertToEn(req.query.user); // ফিক্স
        const contacts = await Contact.find({ owner: ownerPhone });
        res.json({ success: true, contacts });
    } catch (err) {
        res.json({ success: false });
    }
});

app.get('/api/get-messages', async (req, res) => {
    try {
        const from = convertToEn(req.query.from); // ফিক্স
        const to = convertToEn(req.query.to);     // ফিক্স
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
        const phone = convertToEn(req.body.userNumber); // ফিক্স
        const { newPassword } = req.body;
        const user = await User.findOneAndUpdate({ userNumber: phone }, { userPassword: newPassword });
        if(user) res.json({ success: true, message: "পাসওয়ার্ড সফলভাবে আপডেট হয়েছে!" });
        else res.json({ success: false, message: "এই নাম্বারে কোনো ইউজার পাওয়া যায়নি!" });
    } catch (err) {
        res.json({ success: false, message: "রিসেট করতে সমস্যা হয়েছে!" });
    }
});

// --- সকেট লজিক (রিয়েল-টাইম ডাটা হ্যান্ডলিং) ---
let onlineUsers = {}; 

io.on('connection', (socket) => {
    
    socket.on('join', (myNumber) => {
        const phone = convertToEn(myNumber); // ফিক্স
        if (phone) {
            onlineUsers[phone] = socket.id; 
            console.log(`ইউজার ${phone} অনলাইন। আইডি: ${socket.id}`);
        }
    });

    socket.on('send-msg', async (data) => {
        try {
            const from = convertToEn(data.from); // ফিক্স
            const to = convertToEn(data.to);     // ফিক্স
            
            const newMsg = new Message({
                sender: from,
                receiver: to,
                message: data.msg
            });
            await newMsg.save();
            
            const targetId = onlineUsers[to];
            if (targetId) {
                // রিসিভারকে ডাটা পাঠানোর সময় অরিজিনাল ডাটা ফরম্যাট রাখা হয়েছে
                io.to(targetId).emit('receive-msg', { from, msg: data.msg });
            }
        } catch (err) {
            console.log("মেসেজ প্রসেস করতে এরর!");
        }
    });

    socket.on('call-user', (data) => {
        const from = convertToEn(data.from); // ফিক্স
        const to = convertToEn(data.to);     // ফিক্স
        const targetId = onlineUsers[to];
        if (targetId) {
            io.to(targetId).emit('incoming-call', {
                from: from,
                signal: data.signal,
                type: data.type
            });
        }
    });

    socket.on('answer-call', (data) => {
        const to = convertToEn(data.to); // ফিক্স
        const targetId = onlineUsers[to];
        if (targetId) {
            io.to(targetId).emit('call-accepted', data.signal);
        }
    });

    socket.on('end-call', (data) => {
        const to = convertToEn(data.to); // ফিক্স
        const targetId = onlineUsers[to];
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