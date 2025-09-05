document.addEventListener('DOMContentLoaded', function() {
    // Check if user is logged in
    const token = localStorage.getItem('token');
    const username = localStorage.getItem('username');
    
    if (!token || !username) {
        // Not logged in, redirect to login page
        window.location.href = '/login.html';
        return;
    }
    
    // Update username display
    const usernameElement = document.getElementById('current-user');
    if (usernameElement) {
        usernameElement.textContent = username;
    }
    
    // Update current date
    const dateElement = document.getElementById('current-date');
    if (dateElement) {
        const now = new Date();
        const formattedDate = now.toISOString().replace('T', ' ').substring(0, 19);
        dateElement.textContent = formattedDate;
    }
    
    // Handle logout
    const logoutLink = document.getElementById('logout-link');
    if (logoutLink) {
        logoutLink.addEventListener('click', function(e) {
            e.preventDefault();
            localStorage.removeItem('token');
            localStorage.removeItem('username');
            window.location.href = '/login.html';
        });
    }
    
    // DOM elements
    const roomSection = document.getElementById('room-section');
    const chatSection = document.getElementById('chat-section');
    const roomForm = document.getElementById('room-form');
    const roomNameInput = document.getElementById('room-name');
    const currentRoomSpan = document.getElementById('current-room');
    const leaveRoomBtn = document.getElementById('leave-room-btn');
    const messagesList = document.getElementById('messages');
    const usersInRoomList = document.getElementById('users-in-room');
    const messageForm = document.getElementById('message-form');
    const messageInput = document.getElementById('message-input');
    const typingIndicator = document.getElementById('typing-indicator');
    const availableRoomsList = document.getElementById('available-rooms');
    
    // App state
    let currentRoom = '';
    let typingTimeout = null;
    let oldestMessageTimestamp = null;
    let isLoadingMoreMessages = false;
    let sentMessageIds = new Set(); // Track IDs of messages we've sent
    
    // Connect to Socket.IO server
    const socket = io('/', {
        auth: {
            token: token
        }
    });
    
    const statusEl = document.getElementById('connection-status');
    
    // Socket connection events
    socket.on('connect', () => {
        console.log('Connected to server with ID:', socket.id);
        if (statusEl) {
            statusEl.textContent = 'Connected';
            statusEl.style.color = 'green';
        }
        
        // Send username to server when connected
        socket.emit('user_connected', { 
            userId: socket.id,
            username: username
        });
        
        // Get available rooms
        socket.emit('get_rooms');
    });
    
    socket.on('connect_error', (error) => {
        console.error('Connection error:', error);
        if (statusEl) {
            statusEl.textContent = 'Connection Failed';
            statusEl.style.color = 'red';
        }
    });
    
    socket.on('disconnect', () => {
        console.log('Disconnected from server');
        if (statusEl) {
            statusEl.textContent = 'Disconnected';
            statusEl.style.color = 'orange';
        }
    });
    
    // Format time consistently
    function formatTime(timestamp) {
        return new Date(timestamp).toLocaleTimeString([], { 
            hour: '2-digit', 
            minute: '2-digit' 
        });
    }
    
    // Format date for message groups
    function formatDate(timestamp) {
        return new Date(timestamp).toLocaleDateString([], {
            year: 'numeric',
            month: 'short',
            day: 'numeric'
        });
    }
    
    // Display system message
    function displaySystemMessage(text, timestamp = Date.now()) {
        if (!messagesList) return;
        
        const li = document.createElement('li');
        li.className = 'system-message';
        li.innerHTML = `${text} <span class="message-time">${formatTime(timestamp)}</span>`;
        messagesList.appendChild(li);
        scrollToBottom();
    }
    
    // Display chat message
    function displayChatMessage(sender, content, timestamp = Date.now(), prepend = false, messageId = null) {
        if (!messagesList) return;
        
        // If this message already exists in the DOM, don't add it again
        if (messageId && document.querySelector(`[data-message-id="${messageId}"]`)) {
            return;
        }
        
        const isSelf = sender === username;
        const li = document.createElement('li');
        li.className = isSelf ? 'message self-message' : 'message';
        li.dataset.time = timestamp; // Store timestamp for sorting
        if (messageId) {
            li.dataset.messageId = messageId; // Store message ID for deduplication
        }
        
        li.innerHTML = `
            <span class="message-name">${sender}</span>
            <span class="message-time">${formatTime(timestamp)}</span>
            <div class="message-text">${content}</div>
        `;
        
        if (prepend) {
            // Insert at the beginning for older messages
            messagesList.insertBefore(li, messagesList.firstChild);
            // Update oldest timestamp if needed
            if (!oldestMessageTimestamp || timestamp < oldestMessageTimestamp) {
                oldestMessageTimestamp = timestamp;
            }
        } else {
            // Add to the end for new messages
            messagesList.appendChild(li);
            scrollToBottom();
        }
    }
    
    // Display message date separator
    function displayDateSeparator(timestamp, prepend = false) {
        if (!messagesList) return;
        
        const dateStr = formatDate(timestamp);
        
        // Check if this date separator already exists
        const existingSeparators = Array.from(messagesList.querySelectorAll('.date-separator'));
        for (const sep of existingSeparators) {
            if (sep.querySelector('span').textContent === dateStr) {
                return; // Skip if already exists
            }
        }
        
        const separator = document.createElement('li');
        separator.className = 'date-separator';
        separator.innerHTML = `<div class="date-line"></div><span>${dateStr}</span><div class="date-line"></div>`;
        
        if (prepend) {
            messagesList.insertBefore(separator, messagesList.firstChild);
        } else {
            messagesList.appendChild(separator);
        }
    }
    
    // Handle scroll for loading more messages
    function setupScrollHandler() {
        const chatMessagesContainer = document.querySelector('.chat-messages');
        if (!chatMessagesContainer) return;
        
        chatMessagesContainer.addEventListener('scroll', function() {
            // If scrolled near the top and not already loading
            if (chatMessagesContainer.scrollTop < 50 && !isLoadingMoreMessages && oldestMessageTimestamp) {
                isLoadingMoreMessages = true;
                
                // Request older messages
                socket.emit('load_more_messages', {
                    roomId: currentRoom,
                    before: oldestMessageTimestamp
                });
            }
        });
    }
    
    // Scroll messages to bottom
    function scrollToBottom() {
        const chatMessagesContainer = document.querySelector('.chat-messages');
        if (chatMessagesContainer) {
            chatMessagesContainer.scrollTop = chatMessagesContainer.scrollHeight;
        }
    }
    
    // Join room
    function joinRoom(e) {
        e?.preventDefault();
        const roomName = roomNameInput.value.trim();
        if (!roomName) return;
        
        // Leave current room if in one
        if (currentRoom) {
            socket.emit('leave_room', {
                roomId: currentRoom,
                userId: socket.id,
                username: username
            });
        }
        
        // Reset message tracking
        oldestMessageTimestamp = null;
        sentMessageIds.clear(); // Clear sent message IDs
        
        // Join new room
        currentRoom = roomName;
        socket.emit('join_room', {
            roomId: currentRoom,
            userId: socket.id,
            username: username
        });
        
        // Update UI
        currentRoomSpan.textContent = currentRoom;
        roomSection.classList.add('hidden');
        chatSection.classList.remove('hidden');
        messagesList.innerHTML = ''; // Clear previous messages
        usersInRoomList.innerHTML = ''; // Clear previous users
        
        // Clear input
        roomNameInput.value = '';
    }
    
    // Leave current room
    function leaveRoom() {
        if (!currentRoom) return;
        
        socket.emit('leave_room', {
            roomId: currentRoom,
            userId: socket.id,
            username: username
        });
        
        // Update UI
        currentRoom = '';
        roomSection.classList.remove('hidden');
        chatSection.classList.add('hidden');
    }
    
    // Send message
    function sendMessage(e) {
        e?.preventDefault();
        const content = messageInput.value.trim();
        if (!content || !currentRoom) return;
        
        // Disable send button temporarily to prevent double-sends
        const sendButton = messageForm.querySelector('button[type="submit"]');
        if (sendButton) {
            sendButton.disabled = true;
            setTimeout(() => {
                sendButton.disabled = false;
            }, 500);
        }
        
        console.log("Sending message:", content);
        
        socket.emit('send_message', {
            roomId: currentRoom,
            content,
            username: username
        });
        
        // Clear input
        messageInput.value = '';
        
        // Cancel typing indicator
        if (typingTimeout) {
            clearTimeout(typingTimeout);
            typingTimeout = null;
            socket.emit('stop_typing', {
                roomId: currentRoom,
                username: username
            });
        }
        
        // We no longer immediately display our own message
        // Let the server broadcast it back to ensure consistency
    }
    
    // Handle typing indicator
    function handleTyping() {
        if (!currentRoom) return;
        
        // If we already have a timeout set, don't send another typing event
        if (!typingTimeout) {
            socket.emit('typing', {
                roomId: currentRoom,
                username: username
            });
        }
        
        // Clear existing timeout
        if (typingTimeout) {
            clearTimeout(typingTimeout);
        }
        
        // Set new timeout
        typingTimeout = setTimeout(() => {
            socket.emit('stop_typing', {
                roomId: currentRoom,
                username: username
            });
            typingTimeout = null;
        }, 2000);
    }
    
    // Socket event listeners for chat functionality
    socket.on('available_rooms', (data) => {
        // Update available rooms list
        if (availableRoomsList) {
            availableRoomsList.innerHTML = '';
            
            if (data.rooms.length === 0) {
                const li = document.createElement('li');
                li.textContent = 'No active rooms';
                li.className = 'no-rooms';
                availableRoomsList.appendChild(li);
            } else {
                data.rooms.forEach(room => {
                    const li = document.createElement('li');
                    li.textContent = `${room.name} (${room.userCount} ${room.userCount === 1 ? 'user' : 'users'})`;
                    li.className = 'room-item';
                    
                    // Add indicator for rooms with message history
                    if (room.hasHistory) {
                        li.className += ' has-history';
                    }
                    
                    li.addEventListener('click', () => {
                        roomNameInput.value = room.name;
                        joinRoom();
                    });
                    availableRoomsList.appendChild(li);
                });
            }
        }
    });
    
    socket.on('new_message', (data) => {
        console.log("Received message:", data);
        
        if (data.room === currentRoom) {
            // Always display the message, even if it's our own
            // The server ensures consistency
            
            // Check current date
            const lastMessageDate = getLastMessageDate();
            const newMessageDate = new Date(data.createdAt).toDateString();
            
            // Add date separator if needed
            if (newMessageDate !== lastMessageDate) {
                displayDateSeparator(data.createdAt);
            }
            
            // Display the message
            displayChatMessage(data.sender, data.content, data.createdAt, false, data.id);
        }
    });
    
    // Helper to get the date of the last message
    function getLastMessageDate() {
        const messages = messagesList.querySelectorAll('li.message');
        if (messages.length > 0) {
            const lastMessage = messages[messages.length - 1];
            const timestamp = lastMessage.dataset.time;
            if (timestamp) {
                return new Date(parseInt(timestamp)).toDateString();
            }
        }
        return null;
    }
    
    socket.on('user_joined', (data) => {
        if (data.roomId === currentRoom) {
            displaySystemMessage(`${data.username} joined the room`, data.timestamp);
        }
    });
    
    socket.on('user_left', (data) => {
        if (data.roomId === currentRoom) {
            displaySystemMessage(`${data.username} left the room`, data.timestamp);
        }
    });
    
    socket.on('typing_update', (data) => {
        if (data.roomId === currentRoom && typingIndicator) {
            if (data.users.length > 0 && !data.users.includes(username)) {
                if (data.users.length === 1) {
                    typingIndicator.textContent = `${data.users[0]} is typing...`;
                } else if (data.users.length === 2) {
                    typingIndicator.textContent = `${data.users[0]} and ${data.users[1]} are typing...`;
                } else {
                    typingIndicator.textContent = `Multiple users are typing...`;
                }
            } else {
                typingIndicator.textContent = '';
            }
        }
    });
    
    // Handle room history when joining
    socket.on('room_history', (data) => {
        if (data.roomId === currentRoom) {
            // Clear existing messages
            messagesList.innerHTML = '';
            oldestMessageTimestamp = null;
            sentMessageIds.clear();
            
            // Display historical messages
            if (data.messages && data.messages.length > 0) {
                // Get oldest message timestamp
                oldestMessageTimestamp = new Date(data.messages[0].createdAt).getTime();
                
                // Track current date for date separators
                let currentDate = null;
                
                data.messages.forEach(msg => {
                    const msgDate = new Date(msg.createdAt).toDateString();
                    
                    // Add date separator if date changes
                    if (msgDate !== currentDate) {
                        currentDate = msgDate;
                        displayDateSeparator(msg.createdAt);
                    }
                    
                    // Display the message
                    displayChatMessage(msg.sender, msg.content, msg.createdAt, false, msg.id);
                    
                    // If it's our message, mark it as seen
                    if (msg.id && msg.sender === username) {
                        sentMessageIds.add(msg.id);
                    }
                });
            }
            
            // Add system message that you joined
            displaySystemMessage(`You joined room: ${currentRoom}`);
        }
    });
    
    // Handle loading more messages
    socket.on('more_messages', (data) => {
        if (data.roomId === currentRoom) {
            isLoadingMoreMessages = false;
            
            if (data.messages && data.messages.length > 0) {
                // Remember scroll position
                const chatMessagesContainer = document.querySelector('.chat-messages');
                const oldScrollHeight = chatMessagesContainer.scrollHeight;
                
                // Track current date for date separators
                let currentDate = null;
                let lastDate = null;
                
                // Get the date of the first message currently displayed
                if (messagesList.firstChild) {
                    const firstMsgTime = messagesList.firstChild.dataset.time;
                    if (firstMsgTime) {
                        lastDate = new Date(parseInt(firstMsgTime)).toDateString();
                    }
                }
                
                // Add messages in reverse order (oldest first)
                for (let i = data.messages.length - 1; i >= 0; i--) {
                    const msg = data.messages[i];
                    const msgDate = new Date(msg.createdAt).toDateString();
                    
                    // Add date separator if date changes
                    if (msgDate !== currentDate && msgDate !== lastDate) {
                        currentDate = msgDate;
                        displayDateSeparator(msg.createdAt, true);
                    }
                    
                    // Display the message
                    displayChatMessage(msg.sender, msg.content, msg.createdAt, true, msg.id);
                    
                    // If it's our message, mark it as seen
                    if (msg.id && msg.sender === username) {
                        sentMessageIds.add(msg.id);
                    }
                }
                
                // Update oldest timestamp
                if (data.messages.length > 0) {
                    const oldestMsg = data.messages[0];
                    oldestMessageTimestamp = new Date(oldestMsg.createdAt).getTime();
                }
                
                // Restore scroll position
                chatMessagesContainer.scrollTop = chatMessagesContainer.scrollHeight - oldScrollHeight;
            }
        }
    });
    
    // Handle updated users list in room
    socket.on('room_users_updated', (data) => {
        if (data.roomId === currentRoom && usersInRoomList) {
            // Update users in room display
            usersInRoomList.innerHTML = '';
            
            data.users.forEach(user => {
                const li = document.createElement('li');
                li.textContent = user.username;
                
                // Highlight current user
                if (user.username === username) {
                    li.classList.add('current-user');
                }
                
                usersInRoomList.appendChild(li);
            });
        }
    });
    
    // Event listeners
    if (roomForm) {
        roomForm.addEventListener('submit', joinRoom);
    }
    
    if (leaveRoomBtn) {
        leaveRoomBtn.addEventListener('click', leaveRoom);
    }
    
    if (messageForm) {
        messageForm.addEventListener('submit', sendMessage);
    }
    
    if (messageInput) {
        messageInput.addEventListener('input', handleTyping);
    }
    
    // Set up scroll handler for loading more messages
    setupScrollHandler();
    
    // Request rooms periodically
    setInterval(() => {
        if (socket.connected) {
            socket.emit('get_rooms');
        }
    }, 5000);
});