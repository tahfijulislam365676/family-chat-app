const express = require('express');
const http = require('http');
const mongoose = require('mongoose');
const socketIo = require('socket.io');

const app = express();
const server = http.createServer(app);
const io = socketIo(server);

app.use(express.static('public'));
app.use(express.json());

// --- MongoDB Atlas অনলাইন কানেকশন (ভেরিফাইড লিংক) ---
const DB_URI = "mongodb+srv://tahfijulislam365676_db_user:J98w7SWNscFksfRG@cluster0.9pu3xn3.mongodb.net/familyChat?retryWrites=true&w=majority";

mongoose.connect(DB_URI)
    .then(() => console.log("অনলাইন ডাটাবেস (MongoDB Atlas) সফলভাবে কানেক্ট হয়েছে! ✅"))
    .catch(err => {
        console.log("ডাটাবেস কানেকশনে সমস্যা হচ্ছে! এরর টাইপ:", err.name);
        console.log("সম্ভাব্য কারণ: আপনার আইপি (IP) এখনো MongoDB-তে অ্যাক্টিভ হয়নি অথবা ইন্টারনেট ব্লক করছে।");
    });

// --- ডাটাবেস স্কিমা ---

// ইউজার স্কিমা
const UserSchema = new mongoose.Schema({
    userName: String,
    userNumber: { type: String, unique: true },
    userPassword: String
});
const User = mongoose.model('User', UserSchema);

// কন্টাক্ট স্কিমা
const ContactSchema = new mongoose.Schema({
    name: String,
    phone: String,
    owner: String 
});
const Contact = mongoose.model('Contact', ContactSchema);

// মেসেজ স্কিমা
const MessageSchema = new mongoose.Schema({
    sender: String,
    receiver: String,
    message: String,
    time: { type: Date, default: Date.now }
});
const Message = mongoose.model('Message', MessageSchema);

// --- এপিআই রাউটস ---

// রেজিস্ট্রেশন
app.post('/api/signup', async (req, res) => {
    try {
        const newUser = new User(req.body);
        await newUser.save();
        res.json({ success: true, message: "অ্যাকাউন্ট তৈরি সফল!" });
    } catch (err) { 
        res.json({ success: false, message: "এই নাম্বারটি আগেই নিবন্ধিত!" }); 
    }
});

// লগইন
app.post('/api/login', async (req, res) => {
    try {
        const user = await User.findOne({ userNumber: req.body.userNumber, userPassword: req.body.userPassword });
        if(user) res.json({ success: true, user });
        else res.json({ success: false, message: "নাম্বার বা পাসওয়ার্ড ভুল!" });
    } catch (err) {
        res.json({ success: false, message: "সার্ভারে সমস্যা হয়েছে!" });
    }
});

// কন্টাক্ট সেভ করা
app.post('/api/save-contact', async (req, res) => {
    try {
        const newContact = new Contact(req.body);
        await newContact.save();
        res.json({ success: true });
    } catch (err) { 
        res.json({ success: false }); 
    }
});

// কন্টাক্ট লিস্ট লোড করা
app.get('/api/get-contacts', async (req, res) => {
    try {
        const contacts = await Contact.find({ owner: req.query.user });
        res.json({ success: true, contacts });
    } catch (err) {
        res.json({ success: false });
    }
});

// পুরনো মেসেজ লোড করা
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

// পাসওয়ার্ড রিসেট
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

// --- সকেট লজিক ---
io.on('connection', (socket) => {
    socket.on('join', (myNumber) => {
        socket.join(myNumber);
        console.log(myNumber + " রুমে জয়েন করেছে");
    });

    socket.on('send-msg', async (data) => {
        try {
            const newMsg = new Message({ 
                sender: data.from, 
                receiver: data.to, 
                message: data.msg 
            });
            await newMsg.save();
            io.to(data.to).emit('receive-msg', data);
        } catch (err) {
            console.log("মেসেজ সেভ করতে সমস্যা হয়েছে");
        }
    });

    socket.on('call-user', (data) => {
        io.to(data.to).emit('incoming-call', data);
    });
    
    socket.on('disconnect', () => {
        console.log("ইউজার ডিসকানেক্ট হয়েছে");
    });
});

// --- লাইভ সার্ভার পোর্ট সেটআপ ---
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`সার্ভার চালু হয়েছে ${PORT} পোর্টে...`));