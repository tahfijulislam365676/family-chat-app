'use strict';

// ============================================================
//  Family Chat — প্রফেশনাল ব্যাকএন্ড সার্ভার
//  Node.js + Express + Socket.IO + MongoDB Atlas
// ============================================================

require('dotenv').config();           // .env ফাইল থেকে কনফিগ লোড
const express    = require('express');
const http       = require('http');
const mongoose   = require('mongoose');
const socketIo   = require('socket.io');
const rateLimit  = require('express-rate-limit');
const helmet     = require('helmet');
const morgan     = require('morgan');

// ─── অ্যাপ সেটআপ ──────────────────────────────────────────
const app    = express();
const server = http.createServer(app);

// ─── সিকিউরিটি মিডলওয়্যার ────────────────────────────────
app.use(helmet());                          // HTTP হেডার সুরক্ষা
app.use(morgan('dev'));                      // রিকোয়েস্ট লগিং
app.use(express.static('public'));
app.use(express.json({ limit: '10kb' }));  // বড় পেলোড ব্লক

// ─── রেট লিমিটিং (ব্রুট-ফোর্স প্রতিরোধ) ─────────────────
const authLimiter = rateLimit({
    windowMs : 15 * 60 * 1000, // ১৫ মিনিট
    max      : 20,              // সর্বোচ্চ ২০ বার
    message  : { success: false, message: 'অনেক বেশি চেষ্টা! ১৫ মিনিট পরে আবার চেষ্টা করুন।' }
});

// ─── Socket.IO কনফিগ ──────────────────────────────────────
const io = socketIo(server, {
    cors        : { origin: process.env.ALLOWED_ORIGIN || '*' },
    transports  : ['websocket', 'polling'],
    pingTimeout : 60000
});

// ============================================================
//  ডাটাবেস কানেকশন
// ============================================================
const DB_URI = process.env.MONGODB_URI;

if (!DB_URI) {
    console.error('❌  MONGODB_URI এনভায়রনমেন্ট ভ্যারিয়েবল সেট করা হয়নি!');
    process.exit(1);
}

mongoose.connect(DB_URI)
    .then(() => console.log('✅  MongoDB Atlas সফলভাবে কানেক্ট হয়েছে!'))
    .catch(err => {
        console.error('❌  ডাটাবেস কানেকশন ব্যর্থ:', err.message);
        process.exit(1);
    });

// ─── ডাটাবেস ডিসকানেক্ট লগ ───────────────────────────────
mongoose.connection.on('disconnected', () =>
    console.warn('⚠️  MongoDB ডিসকানেক্ট হয়েছে। রিকানেক্ট হচ্ছে...')
);

// ============================================================
//  হেল্পার ফাংশন
// ============================================================

/** বাংলা সংখ্যা → ইংরেজি সংখ্যা রূপান্তর */
const BANGLA_DIGITS = { '০':'0','১':'1','২':'2','৩':'3','৪':'4','৫':'5','৬':'6','৭':'7','৮':'8','৯':'9' };
const toEnDigits = (str) =>
    str ? str.toString().replace(/[০-৯]/g, d => BANGLA_DIGITS[d]) : str;

/** ফোন নম্বর বেসিক ভ্যালিডেশন (শুধু ডিজিট, ৭-১৫ সংখ্যা) */
const isValidPhone = (phone) => /^\d{7,15}$/.test(phone);

/** পাসওয়ার্ড বেসিক ভ্যালিডেশন (কমপক্ষে ৬ ক্যারেক্টার) */
const isValidPassword = (pass) => typeof pass === 'string' && pass.length >= 6;

// ============================================================
//  ডাটাবেস স্কিমা ও মডেল
// ============================================================

const userSchema = new mongoose.Schema({
    userName     : { type: String, required: true, trim: true },
    userNumber   : { type: String, unique: true, required: true, index: true },
    userPassword : { type: String, required: true, minlength: 6 }
}, { timestamps: true });

const contactSchema = new mongoose.Schema({
    name  : { type: String, required: true, trim: true },
    phone : { type: String, required: true },
    owner : { type: String, required: true, index: true }
}, { timestamps: true });

// একই মালিকের একই কন্টাক্ট ডুপ্লিকেট রোধ
contactSchema.index({ phone: 1, owner: 1 }, { unique: true });

const messageSchema = new mongoose.Schema({
    sender   : { type: String, required: true, index: true },
    receiver : { type: String, required: true, index: true },
    message  : { type: String, required: true, maxlength: 2000 },
    time     : { type: Date, default: Date.now }
});

// বার্তা অনুসন্ধানের জন্য কম্পোজিট ইনডেক্স
messageSchema.index({ sender: 1, receiver: 1, time: 1 });

const User    = mongoose.model('User',    userSchema);
const Contact = mongoose.model('Contact', contactSchema);
const Message = mongoose.model('Message', messageSchema);

// ============================================================
//  API রাউটস
// ============================================================

// ── নিবন্ধন ───────────────────────────────────────────────
app.post('/api/signup', authLimiter, async (req, res) => {
    try {
        const phone    = toEnDigits(req.body.userNumber);
        const password = req.body.userPassword;
        const name     = req.body.userName?.trim();

        if (!name)                      return res.json({ success: false, message: 'নাম দিতে হবে!' });
        if (!isValidPhone(phone))       return res.json({ success: false, message: 'সঠিক ফোন নম্বর দিন!' });
        if (!isValidPassword(password)) return res.json({ success: false, message: 'পাসওয়ার্ড কমপক্ষে ৬ অক্ষরের হতে হবে!' });

        const newUser = new User({ userName: name, userNumber: phone, userPassword: password });
        await newUser.save();
        res.json({ success: true, message: 'অ্যাকাউন্ট তৈরি সফল! 🎉' });
    } catch (err) {
        if (err.code === 11000)
            return res.json({ success: false, message: 'এই নম্বরটি ইতোমধ্যে নিবন্ধিত!' });
        console.error('[signup]', err.message);
        res.status(500).json({ success: false, message: 'সার্ভারে সমস্যা হয়েছে!' });
    }
});

// ── লগইন ──────────────────────────────────────────────────
app.post('/api/login', authLimiter, async (req, res) => {
    try {
        const phone    = toEnDigits(req.body.userNumber);
        const password = req.body.userPassword;

        if (!isValidPhone(phone) || !password)
            return res.json({ success: false, message: 'নম্বর বা পাসওয়ার্ড দিন!' });

        const user = await User.findOne({ userNumber: phone, userPassword: password }).lean();
        if (!user) return res.json({ success: false, message: 'নম্বর বা পাসওয়ার্ড ভুল!' });

        // পাসওয়ার্ড ক্লায়েন্টে পাঠানো হবে না
        const { userPassword: _, ...safeUser } = user;
        res.json({ success: true, user: safeUser });
    } catch (err) {
        console.error('[login]', err.message);
        res.status(500).json({ success: false, message: 'সার্ভারে সমস্যা হয়েছে!' });
    }
});

// ── পাসওয়ার্ড রিসেট ──────────────────────────────────────
app.post('/api/reset-password', authLimiter, async (req, res) => {
    try {
        const phone    = toEnDigits(req.body.userNumber);
        const newPass  = req.body.newPassword;

        if (!isValidPhone(phone))      return res.json({ success: false, message: 'সঠিক ফোন নম্বর দিন!' });
        if (!isValidPassword(newPass)) return res.json({ success: false, message: 'নতুন পাসওয়ার্ড কমপক্ষে ৬ অক্ষরের হতে হবে!' });

        const updated = await User.findOneAndUpdate(
            { userNumber: phone },
            { userPassword: newPass },
            { new: true }
        );

        if (!updated) return res.json({ success: false, message: 'এই নম্বরে কোনো ইউজার পাওয়া যায়নি!' });
        res.json({ success: true, message: 'পাসওয়ার্ড সফলভাবে আপডেট হয়েছে! ✅' });
    } catch (err) {
        console.error('[reset-password]', err.message);
        res.status(500).json({ success: false, message: 'রিসেট করতে সমস্যা হয়েছে!' });
    }
});

// ── কন্টাক্ট সেভ ──────────────────────────────────────────
app.post('/api/save-contact', async (req, res) => {
    try {
        const phone = toEnDigits(req.body.phone);
        const owner = toEnDigits(req.body.owner);
        const name  = req.body.name?.trim();

        if (!name || !isValidPhone(phone) || !isValidPhone(owner))
            return res.json({ success: false, message: 'সব তথ্য সঠিকভাবে দিন!' });

        await Contact.updateOne(
            { phone, owner },
            { $set: { name } },
            { upsert: true }    // থাকলে আপডেট, না থাকলে তৈরি
        );
        res.json({ success: true, message: 'কন্টাক্ট সেভ হয়েছে!' });
    } catch (err) {
        console.error('[save-contact]', err.message);
        res.status(500).json({ success: false, message: 'কন্টাক্ট সেভ করতে সমস্যা হয়েছে!' });
    }
});

// ── কন্টাক্ট তালিকা ───────────────────────────────────────
app.get('/api/get-contacts', async (req, res) => {
    try {
        const owner = toEnDigits(req.query.user);
        if (!isValidPhone(owner))
            return res.json({ success: false, message: 'সঠিক নম্বর দিন!' });

        const contacts = await Contact.find({ owner }).select('-__v').lean();
        res.json({ success: true, contacts });
    } catch (err) {
        console.error('[get-contacts]', err.message);
        res.status(500).json({ success: false });
    }
});

// ── মেসেজ হিস্ট্রি ────────────────────────────────────────
app.get('/api/get-messages', async (req, res) => {
    try {
        const from  = toEnDigits(req.query.from);
        const to    = toEnDigits(req.query.to);
        const limit = Math.min(parseInt(req.query.limit) || 50, 200); // সর্বোচ্চ ২০০

        if (!isValidPhone(from) || !isValidPhone(to))
            return res.json({ success: false, message: 'সঠিক নম্বর দিন!' });

        const messages = await Message.find({
            $or: [
                { sender: from, receiver: to },
                { sender: to,   receiver: from }
            ]
        }).sort({ time: 1 }).limit(limit).select('-__v').lean();

        res.json({ success: true, messages });
    } catch (err) {
        console.error('[get-messages]', err.message);
        res.status(500).json({ success: false });
    }
});

// ─── ৪০৪ হ্যান্ডলার ────────────────────────────────────────
app.use((req, res) => res.status(404).json({ success: false, message: 'রাউট পাওয়া যায়নি!' }));

// ─── গ্লোবাল এরর হ্যান্ডলার ───────────────────────────────
app.use((err, req, res, _next) => {
    console.error('[global-error]', err.message);
    res.status(500).json({ success: false, message: 'অপ্রত্যাশিত সমস্যা হয়েছে!' });
});

// ============================================================
//  Socket.IO — রিয়েল-টাইম লজিক
// ============================================================

/** অনলাইন ইউজার ম্যাপ: { ফোন → socketId } */
const onlineUsers = new Map();

io.on('connection', (socket) => {

    // ── ইউজার জয়েন ─────────────────────────────────────────
    socket.on('join', (rawNumber) => {
        const phone = toEnDigits(rawNumber);
        if (!isValidPhone(phone)) return;

        onlineUsers.set(phone, socket.id);
        socket.data.phone = phone;          // ডিসকানেক্টে ব্যবহারের জন্য
        console.log(`🟢  ${phone} অনলাইন`);
    });

    // ── মেসেজ পাঠানো ────────────────────────────────────────
    socket.on('send-msg', async (data) => {
        try {
            const from = toEnDigits(data.from);
            const to   = toEnDigits(data.to);
            const msg  = (data.msg || '').trim().slice(0, 2000); // সর্বোচ্চ ২০০০ অক্ষর

            if (!isValidPhone(from) || !isValidPhone(to) || !msg) return;

            // ডাটাবেসে সেভ
            await Message.create({ sender: from, receiver: to, message: msg });

            // রিসিভার অনলাইন থাকলে পাঠাও
            const targetId = onlineUsers.get(to);
            if (targetId) {
                io.to(targetId).emit('receive-msg', { from, msg });
            }
        } catch (err) {
            console.error('[send-msg]', err.message);
        }
    });

    // ── ভয়েস/ভিডিও কল শুরু ─────────────────────────────────
    socket.on('call-user', (data) => {
        const from     = toEnDigits(data.from);
        const to       = toEnDigits(data.to);
        const targetId = onlineUsers.get(to);

        if (targetId) {
            io.to(targetId).emit('incoming-call', {
                from,
                signal : data.signal,
                type   : data.type      // 'audio' বা 'video'
            });
        }
    });

    // ── কল গ্রহণ ────────────────────────────────────────────
    socket.on('answer-call', (data) => {
        const targetId = onlineUsers.get(toEnDigits(data.to));
        if (targetId) {
            io.to(targetId).emit('call-accepted', data.signal);
        }
    });

    // ── কল শেষ ──────────────────────────────────────────────
    socket.on('end-call', (data) => {
        const targetId = onlineUsers.get(toEnDigits(data.to));
        if (targetId) {
            io.to(targetId).emit('call-ended');
        }
    });

    // ── ডিসকানেক্ট ──────────────────────────────────────────
    socket.on('disconnect', () => {
        const phone = socket.data.phone;
        if (phone) {
            onlineUsers.delete(phone);
            console.log(`🔴  ${phone} অফলাইন`);
        }
    });
});

// ============================================================
//  সার্ভার চালু
// ============================================================
const PORT = process.env.PORT || 3000;
server.listen(PORT, () =>
    console.log(`🚀  সার্ভার চালু: http://localhost:${PORT}`)
);

// ─── অপ্রত্যাশিত এরর হ্যান্ডলিং (ক্র্যাশ প্রতিরোধ) ──────
process.on('unhandledRejection', (reason) => {
    console.error('⚠️  UnhandledRejection:', reason);
});
process.on('uncaughtException', (err) => {
    console.error('💥  UncaughtException:', err.message);
    process.exit(1);
});