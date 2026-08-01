const express = require('express');
const http = require('http');
const { Server } = require('socket.io');

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: "*" } });

// Database sets for infractions and suspensions
const userWarnings = {};      // Tracks warnings (Up to 5 before kick)
const postKickViolations = {}; // Tracks if user violated after being kicked once
const activeSuspensions = {}; // 3-Day lockout timestamps

// Target terminology matching your specifications
const profanityFilter = /\b(fuck|naai|suck|dick|pussy|poes|ma se poes|fuckyou|fukkoff|cock|blowjob|Piel|horny|lick|ass|gat|naaier|voetsek|jintoe|bitch|hoer|pielkop|tsek|malpoes|natnai|uitgerekte poes|mal poes|jas|jags|holnaaier|fokkof|groot poes|groot Piel|suig my)\b/i;

const chatRooms = {
    "1": {"name": "The Meeting Post", "users": new Set()},
    "2": {"name": "Teen Zone", "users": new Set()}
};

io.on('connection', (socket) => {

    socket.on('join_server', ({ username, age }) => {
        // Enforce 3-day suspension lock
        if (activeSuspensions[username]) {
            const timeRemaining = activeSuspensions[username] - Date.now();
            if (timeRemaining > 0) {
                const hoursLeft = (timeRemaining / (1000 * 60 * 60)).toFixed(1);
                return socket.emit('error_message', `Suspended: You have been suspended for 3 days, continuing using sexual misconduct chats or profanity will lead to a permanent ban. (${hoursLeft} hours remaining)`);
            } else {
                delete activeSuspensions[username];
                delete postKickViolations[username];
                delete userWarnings[username];
            }
        }
        socket.data.username = username;
    });

    socket.on('join_room', (roomId) => {
        const room = chatRooms[roomId];
        if (!room) return;
        
        socket.join(roomId);
        socket.data.currentRoom = roomId;
        room.users.add(socket.data.username);
    });

    socket.on('send_message', (text) => {
        const roomId = socket.data.currentRoom;
        if (!roomId) return;

        const user = socket.data.username;

        // Run Text Moderation Scan
        if (profanityFilter.test(text)) {
            // Case A: User has already been kicked once and returned to break rules again -> 3 Day Suspension
            if (postKickViolations[user]) {
                activeSuspensions[user] = Date.now() + (3 * 24 * 60 * 60 * 1000); // 3 Days
                socket.emit('error_message', 'You have been suspended for 3 days, continuing using sexual misconduct chats or profanity will lead to a permanent ban.');
                io.to(roomId).emit('chat_message', { sender: 'Moderator', text: `🚫 User ${user} has been suspended for 3 days due to continued violations after a room kick.` });
                socket.disconnect(true);
                return;
            }

            // Track standard pre-kick warnings
            userWarnings[user] = (userWarnings[user] || 0) + 1;
            const count = userWarnings[user];

            if (count > 5) {
                // Trigger Room Kick on 6th instance
                io.to(roomId).emit('chat_message', { sender: 'Moderator', text: `🚨 ${user} has been kicked out of the room for persistent profanity/sexual misconduct.` });
                
                postKickViolations[user] = true; // Mark that they have used up their room kick lifeline
                
                socket.leave(roomId);
                chatRooms[roomId].users.delete(user);
                socket.data.currentRoom = null;
                socket.emit('error_message', 'You were kicked out of the chatroom. Further misconduct will result in an immediate 3-day ban.');
                return;
            } else {
                // Issue plain text warnings (Instances 1 to 5)
                socket.emit('chat_message', {
                    sender: 'Moderator',
                    text: `⚠️ Warning: Please do not use bad language, profanity or sexual misconduct chats in chatrooms. Strike ${count}/5.`
                });
                return; // Suppress message from reaching the room
            }
        }

        // Broadcast clean text messages to the room
        io.to(roomId).emit('chat_message', {
            sender: user,
            text: text
        });
    });
});

server.listen(3000, () => console.log('Mod engine running...'));

// Persistent tracking in memory for violations and suspensions
const userInfractions = {}; // Tracks strike counts per username
const activeSuspensions = {}; // Stores usernames and release timestamps

// List of designated moderator usernames
const moderators = new Set(["Mod_Zama", "Mod_Thabo"]);
const ADMIN_USERNAME = "AdminOwner"; // Change this to your exact username

const chatRooms = {
    "1": {"name": "The Meeting Post", "min_age": 13, "max_age": 99, "users": new Set()},
    "2": {"name": "Teen Zone", "min_age": 13, "max_age": 19, "users": new Set()},
    "21": {"name": "Flirt", "min_age": 18, "max_age": 99, "users": new Set()}
};

io.on('connection', (socket) => {

    socket.on('join_server', ({ username, age }) => {
        // Check if user is currently under a 3-day suspension
        if (activeSuspensions[username]) {
            const remains = activeSuspensions[username] - Date.now();
            if (remains > 0) {
                const daysLeft = (remains / (1000 * 60 * 60 * 24)).toFixed(1);
                return socket.emit('error_message', `Access Denied: Suspended for ${daysLeft} more days due to bad language repeat violations.`);
            } else {
                delete activeSuspensions[username]; // Suspension expired
            }
        }

        socket.data.username = username;
        socket.data.age = parseInt(age);
        
        // Define role parameters
        socket.data.isAdmin = (username === ADMIN_USERNAME);
        socket.data.isMod = moderators.has(username);
    });

    socket.on('join_room', (roomId) => {
        const room = chatRooms[roomId];
        if (!room) return socket.emit('error_message', 'Room does not exist.');

        if (socket.data.age < room.min_age || socket.data.age > room.max_age) {
            return socket.emit('error_message', `Access Denied for your age group.`);
        }

        if (socket.data.currentRoom) {
            socket.leave(socket.data.currentRoom);
            chatRooms[socket.data.currentRoom].users.delete(socket.data.username);
        }

        socket.join(roomId);
        socket.data.currentRoom = roomId;
        room.users.add(socket.data.username);

        // System notification of user entering
        io.to(roomId).emit('chat_message', { sender: 'System', text: `${socket.data.username} entered ${room.name}.` });
        
        // Admin tracking logic: Check if Main Admin is already physically in this room
        let adminPresent = false;
        for (let client of io.sockets.adapter.rooms.get(roomId) || []) {
            if (io.sockets.sockets.get(client)?.data.isAdmin) {
                adminPresent = true;
                break;
            }
        }

        if (adminPresent && socket.data.isMod) {
            socket.emit('chat_message', { 
                sender: 'System', 
                text: '⚠️ NOTICE: Admin Owner is active in this room. Stand down; Admin controls all user interactions.' 
            });
        }
    });

    socket.on('send_message', (text) => {
        const roomId = socket.data.currentRoom;
        if (!roomId) return;

        const room = chatRooms[roomId];
        let senderDisplay = socket.data.username;

        // Visual rules for styling tags matching classic layouts
        if (socket.data.isAdmin) {
            senderDisplay = `${socket.data.username} - admin main operator/moderator`;
        } else if (socket.data.isMod) {
            senderDisplay = `${socket.data.username} - moderator`;
        }

        // 1. Check room for active Admin Override state
        let isAdminInRoom = false;
        const connectedClients = io.sockets.adapter.rooms.get(roomId) || [];
        for (let clientId of connectedClients) {
            if (io.sockets.sockets.get(clientId)?.data.isAdmin) {
                isAdminInRoom = true;
                break;
            }
        }

        // Strict Command Guard: Prevent Moderator interference if Admin is in the room
        if (isAdminInRoom && socket.data.isMod && text.startsWith('.')) {
            return socket.emit('chat_message', { 
                sender: 'System', 
                text: '❌ Action blocked: You cannot issue moderation commands while Admin is inside the room.' 
            });
        }

        // 2. Process Staff Commands (`.kick` / `.suspend`)
        if (text.startsWith('.')) {
            const args = text.split(' ');
            const command = args[0].toLowerCase();
            const targetUser = args[1];

            if (socket.data.isMod || socket.data.isAdmin) {
                let targetSocket = null;
                for (let clientId of connectedClients) {
                    let s = io.sockets.sockets.get(clientId);
                    if (s && s.data.username === targetUser) {
                        targetSocket = s;
                        break;
                    }
                }

                if (!targetSocket) {
                    return socket.emit('chat_message', { sender: 'System', text: `User "${targetUser}" not found in this room.` });
                }

                if (command === '.kick') {
                    io.to(roomId).emit('chat_message', { 
                        sender: 'System', 
                        text: `🚨 ${targetUser} has been kicked out of the room by staff for disruptive behavior.` 
                    });
                    targetSocket.leave(roomId);
                    room.users.delete(targetUser);
                    targetSocket.data.currentRoom = null;
                    targetSocket.emit('error_message', 'You were kicked out of the chatroom for rude/disrespectful behavior.');
                    return;
                }

                if (command === '.suspend') {
                    // Instantly trigger the 3-day structural lock out
                    activeSuspensions[targetUser] = Date.now() + (3 * 24 * 60 * 60 * 1000); 
                    io.to(roomId).emit('chat_message', { 
                        sender: 'System', 
                        text: `🚫 ${targetUser} has been given a 3-day server suspension.` 
                    });
                    targetSocket.disconnect(true);
                    return;
                }
            }
        }

        // 3. Automated Automated Language Guard (Warning & Strike Management)
        const profanityFilter = /badword1|badword2|vulgartext|sexualkeyword/i; // Customize filter words here
        if (profanityFilter.test(text) && !socket.data.isAdmin && !socket.data.isMod) {
            
            const user = socket.data.username;
            userInfractions[user] = (userInfractions[user] || 0) + 1;
            const currentStrikes = userInfractions[user];

            if (currentStrikes >= 3) {
                // Automate 3-day lockout after 3rd instance violation
                activeSuspensions[user] = Date.now() + (3 * 24 * 60 * 60 * 1000);
                socket.emit('error_message', 'You have been suspended for 3 days due to repeated inappropriate language usage.');
                io.to(roomId).emit('chat_message', { sender: 'System', text: `🚫 ${user} has been automatically suspended for 3 days after 3 language strikes.` });
                socket.disconnect(true);
                return;
            } else {
                // Warnings issued on instance 1 and 2 without forcing room drop
                socket.emit('chat_message', { 
                    sender: 'System', 
                    text: `⚠️ WARNING: Please refrain from using inappropriate language, profanity, or sexual misconduct text. Strike ${currentStrikes}/3.` 
                });
                return; 
            }
        }

        // Route normal chat texts with the custom text strings attached
        io.to(roomId).emit('chat_message', {
            sender: senderDisplay,
            text: text,
            roleClass: socket.data.isAdmin ? 'admin-user' : (socket.data.isMod ? 'mod-user' : 'normal-user')
        });
    });

    socket.on('disconnect', () => {
        if (socket.data.currentRoom && chatRooms[socket.data.currentRoom]) {
            chatRooms[socket.data.currentRoom].users.delete(socket.data.username);
        }
    });
});

server.listen(3000, () => console.log('Secure Chat engine active on 3000'));
