// --- 0. Core Configuration and Setup ---

import { initializeApp } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-app.js";
import { 
    getAuth, signInAnonymously, signInWithCustomToken, onAuthStateChanged, 
    setPersistence, browserSessionPersistence 
} from "https://www.gstatic.com/firebasejs/11.6.1/firebase-auth.js";
import { 
    getFirestore, doc, getDoc, addDoc, setDoc, updateDoc, deleteDoc, 
    onSnapshot, collection, query, where, orderBy, getDocs, 
    serverTimestamp, setLogLevel
} from "https://www.gstatic.com/firebasejs/11.6.1/firebase-firestore.js";

// Global Variables from Canvas Environment (MANDATORY USE)
const appId = typeof __app_id !== 'undefined' ? __app_id : 'default-app-id';
const firebaseConfig = typeof __firebase_config !== 'undefined' ? JSON.parse(__firebase_config) : null;
const initialAuthToken = typeof __initial_auth_token !== 'undefined' ? __initial_auth_token : null;

// DOM Elements
const START_OVERLAY = document.getElementById('start-overlay');
const START_BUTTON = document.getElementById('start-button');
const SCENE_BG = document.getElementById('scene-background');
const THUMB_LIGHT = document.getElementById('thumb-light');
const KISS_BAR = document.getElementById('kiss-bar');
const LOLLIPOP_ZONE = document.getElementById('lollipop-zone');
const BUBBLE_SVG = document.getElementById('bubble-svg');
const PARTICLE_CONTAINER = document.getElementById('particle-container');
const MEMORY_MODAL = document.getElementById('memory-modal');
const VIEW_MEMORIES_BUTTON = document.getElementById('view-memories-button');
const CLOSE_MODAL_BUTTON = document.getElementById('close-modal-button');
const MEMORIES_LIST = document.getElementById('memories-list');
const AUDIO = document.getElementById('rnb-audio');
const GEMINI_BUTTON = document.getElementById('get-note-button');
const GEMINI_INPUT = document.getElementById('dream-input');
const GEMINI_OUTPUT = document.getElementById('gemini-note-output');

// Firebase Instances
let app, auth, db;
let userId = 'anon';

// State Management
let isAuthReady = false;
let isPlaying = false;
let kissMeterLevel = 0; // 0 to 100
let bubbleScale = 0;
let isBubbleInflating = false;
let memoryCount = 0;

// Mood Configuration (maps 0-100 to color themes)
const MOOD_COLORS = [
    // 0-30: Blue/Numbness
    { name: 'Blue', bgDark: '#0b1d3d', light: '#ADD8E6', mid: '#4682B4', accent: '#BFE7FF', desc: "Muted blue, suggesting numbness and distance." },
    // 31-65: Pink/Red Intensity
    { name: 'Red', bgDark: '#3d0a0a', light: '#FFA07A', mid: '#FF4500', accent: '#FFD6E0', desc: "Fiery red, passionate intensity, and urgency." },
    // 66-100: Purple/Intimacy
    { name: 'Purple', bgDark: '#1a0d33', light: '#E6E6FA', mid: '#8A2BE2', accent: '#D8B9FF', desc: "Deep violet and royal purple, intense intimacy." }
];

// --- 1. Firebase Initialization and Authentication ---

async function initializeFirebase() {
    if (!firebaseConfig) {
        document.getElementById('loading-status').textContent = "Error: Firebase config not found.";
        return;
    }

    try {
        setLogLevel('debug');
        app = initializeApp(firebaseConfig);
        auth = getAuth(app);
        db = getFirestore(app);

        document.getElementById('loading-status').textContent = "Authenticating...";

        // Sign in using the custom token provided by the canvas environment
        if (initialAuthToken) {
            await setPersistence(auth, browserSessionPersistence);
            await signInWithCustomToken(auth, initialAuthToken);
        } else {
            await signInAnonymously(auth);
        }
        
        onAuthStateChanged(auth, (user) => {
            if (user) {
                userId = user.uid;
                isAuthReady = true;
                console.log("Firebase ready. User ID:", userId);
                document.getElementById('loading-status').textContent = `Ready for ${user.displayName || 'Daydreamer'}.`;
                // Once authenticated, start listening for memories
                setupMemoryListener();
            } else {
                isAuthReady = true; // Still ready, but anonymous/unlogged
                document.getElementById('loading-status').textContent = "Ready (Anon).";
            }
        });

    } catch (error) {
        console.error("Firebase initialization failed:", error);
        document.getElementById('loading-status').textContent = "Auth Error: " + error.message;
    }
}

// --- 2. Firestore Memory Log ---

function getMemoryCollectionRef() {
    // Private data path: /artifacts/{appId}/users/{userId}/daydream_memories
    return collection(db, `artifacts/${appId}/users/${userId}/daydream_memories`);
}

/**
 * Sets up a real-time listener for the user's saved memories.
 */
function setupMemoryListener() {
    if (!db || !userId) return;

    const q = query(getMemoryCollectionRef());

    onSnapshot(q, (snapshot) => {
        const memories = [];
        snapshot.forEach((doc) => {
            memories.push({ id: doc.id, ...doc.data() });
        });
        memoryCount = memories.length;
        VIEW_MEMORIES_BUTTON.textContent = `View Keepsakes (${memoryCount})`;
        renderMemories(memories);
    }, (error) => {
        console.error("Error listening to memories:", error);
    });
}

/**
 * Renders the memories into the modal list.
 */
function renderMemories(memories) {
    MEMORIES_LIST.innerHTML = '';
    if (memories.length === 0) {
        MEMORIES_LIST.innerHTML = '<p class="text-gray-500">No moments saved yet...</p>';
        return;
    }

    memories.sort((a, b) => (b.timestamp?.seconds || 0) - (a.timestamp?.seconds || 0));

    memories.forEach(mem => {
        const date = mem.timestamp?.toDate() ? mem.timestamp.toDate().toLocaleDateString() : 'N/A';
        const item = document.createElement('div');
        item.className = 'p-3 rounded-lg shadow-md border border-purple-300/50 bg-white/70';
        item.innerHTML = `
            <p class="text-sm font-semibold text-purple-700">${mem.note || 'Untitled Note'}</p>
            <p class="text-xs text-gray-600 mt-1">Mood: <span style="color: ${mem.colorLight || 'gray'}">${mem.colorName}</span></p>
            <p class="text-xs text-gray-500">${date}</p>
        `;
        MEMORIES_LIST.appendChild(item);
    });
}

/**
 * Saves a new note to Firestore.
 */
async function saveMemory(note, colorName, colorLight) {
    if (!db || !userId) {
        console.error("Cannot save memory: Firebase not ready.");
        return;
    }
    
    try {
        await addDoc(getMemoryCollectionRef(), {
            note: note,
            colorName: colorName,
            colorLight: colorLight,
            timestamp: serverTimestamp()
        });
        GEMINI_OUTPUT.textContent = "Memory saved! 💜";
    } catch (error) {
        console.error("Failed to save memory:", error);
        GEMINI_OUTPUT.textContent = "Error saving memory.";
    }
}


// --- 3. Gemini API Interaction (Dream Whisperer) ---

const apiKey = ""; // Canvas will provide
const modelName = "gemini-2.5-flash-preview-09-2025";
const apiUrl = `https://generativelanguage.googleapis.com/v1beta/models/${modelName}:generateContent?key=${apiKey}`;

/**
 * Calls Gemini to generate a personalized note and saves it.
 */
async function getAndSavePoeticReflection(inputWord) {
    if (!db || !userId) {
        GEMINI_OUTPUT.textContent = "Please wait for authentication to complete.";
        return;
    }
    
    GEMINI_BUTTON.disabled = true;
    const originalText = GEMINI_BUTTON.textContent;
    GEMINI_BUTTON.textContent = "Dreaming...";
    GEMINI_OUTPUT.textContent = "Contacting the Dream Whisperer...";

    const currentMood = getCurrentMood(kissMeterLevel);

    const systemPrompt = "You are a surrealist poet writing a highly romantic love note based on the user's input word and the scene's current mood. Write a single, concise, three-line poetic stanza. Incorporate the input word and the mood colors. Do not include any title, prefaces, or explanation.";
    const userQuery = `Input Word: "${inputWord}". Current Mood: ${currentMood.desc} The prominent colors are ${currentMood.light} and ${currentMood.mid}. Write a three-line romantic poem.`;

    const payload = {
        contents: [{ parts: [{ text: userQuery }] }],
        systemInstruction: {
            parts: [{ text: systemPrompt }]
        },
    };

    try {
        const response = await fetch(apiUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });

        const result = await response.json();
        const text = result.candidates?.[0]?.content?.parts?.[0]?.text || "The whisper was too soft to hear.";
        
        // Display and save the note
        GEMINI_OUTPUT.innerHTML = text.replace(/\n/g, '<br>'); // Display newlines for stanza
        await saveMemory(text, currentMood.name, currentMood.light);
        
    } catch (error) {
        console.error("Gemini API call failed:", error);
        GEMINI_OUTPUT.textContent = "Error: Connection lost to the dream stream.";
    } finally {
        GEMINI_BUTTON.textContent = originalText;
        GEMINI_BUTTON.disabled = false;
    }
}

// --- 4. Main Scene Logic & Interactions ---

/**
 * Maps the kiss meter level to the current mood colors.
 */
function getCurrentMood(level) {
    if (level <= 30) return MOOD_COLORS[0]; // Blue
    if (level <= 65) return MOOD_COLORS[1]; // Red
    return MOOD_COLORS[2]; // Purple
}

/**
 * Updates the CSS variables based on the current mood.
 */
function updateSceneColors(level) {
    const mood = getCurrentMood(level);
    SCENE_BG.style.setProperty('--color-bg-dark', mood.bgDark);
    SCENE_BG.style.backgroundColor = mood.bgDark;

    // Apply colors to the thumb light and accents
    THUMB_LIGHT.style.setProperty('--color-light', mood.light);
    SCENE_BG.style.setProperty('--color-light', mood.light);
    KISS_BAR.style.setProperty('--color-mid', mood.mid);

    // Update heart particle color to match the light mood
    document.documentElement.style.setProperty('--color-pastel-pink', mood.accent);
}

/**
 * The main game/animation loop for constant updates.
 */
function gameLoop() {
    if (!isPlaying) return;

    // 1. Mood & Color Update
    updateSceneColors(kissMeterLevel);
    KISS_BAR.style.width = `${kissMeterLevel}%`;

    // 2. Bubble Inflation Update
    if (isBubbleInflating) {
        bubbleScale = Math.min(100, bubbleScale + 0.8);
    } else if (bubbleScale > 0) {
        // Bubble pops if released above a certain size
        if (bubbleScale > 10) {
            popBubble(bubbleScale);
            // Add a small mood boost on a successful pop
            kissMeterLevel = Math.min(100, kissMeterLevel + 5); 
        }
        bubbleScale = 0; // Reset
    }
    
    // Animate the bubble
    BUBBLE_SVG.style.width = `${bubbleScale * 1.5}px`;
    BUBBLE_SVG.style.height = `${bubbleScale * 1.5}px`;
    BUBBLE_SVG.style.opacity = bubbleScale > 0 ? 0.8 : 0;
    
    // 3. Kiss Meter Decay (Gentle Fade)
    kissMeterLevel = Math.max(0, kissMeterLevel - 0.05);

    // 4. Purple Bloom Finale Check
    if (kissMeterLevel >= 100) {
        triggerPurpleBloom();
        kissMeterLevel = 99; // Keep it near max until manually reset
    }

    // 5. Heart Particle Spawner (Gentle drift)
    if (Math.random() < 0.05) {
        createHeartParticle();
    }
    
    requestAnimationFrame(gameLoop);
}

/**
 * Triggers the "Purple All Over" final cinematic moment.
 */
function triggerPurpleBloom() {
    // Prevent re-triggering immediately
    if (document.body.classList.contains('scene-bloom')) return;
    
    document.body.classList.add('scene-bloom');
    // Emit a massive burst of purple hearts
    for (let i = 0; i < 50; i++) {
        createHeartParticle(MOOD_COLORS[2].light);
    }

    // Display the success message on the kiss label
    document.getElementById('kiss-label').textContent = "PURPLE ALL OVER! 💜";

    // Reset the bloom effect after 2 seconds
    setTimeout(() => {
        document.body.classList.remove('scene-bloom');
        document.getElementById('kiss-label').textContent = "Mood Level";
    }, 2000);
}


/**
 * Creates and animates a single floating heart particle.
 */
function createHeartParticle(color = null) {
    const heart = document.createElement('div');
    heart.className = 'heart-particle';
    heart.innerHTML = '&#x2764;'; // Unicode Heart

    // Randomize initial position at the bottom
    const size = Math.random() * 2 + 0.8;
    heart.style.fontSize = `${size}rem`;
    heart.style.left = `${Math.random() * 100}vw`;
    heart.style.animationDuration = `${Math.random() * 10 + 20}s`; // 20s-30s float speed
    heart.style.animationDelay = `${Math.random() * -30}s`; // Start offset

    if (color) {
         heart.style.color = color;
         heart.style.textShadow = `0 0 10px ${color}`;
    }

    PARTICLE_CONTAINER.appendChild(heart);

    // Clean up heart after animation duration
    setTimeout(() => heart.remove(), 35000); 
}

/**
 * Handles the moment the bubble pops.
 */
function popBubble(size) {
    // Add a mood boost proportional to the bubble size
    kissMeterLevel = Math.min(100, kissMeterLevel + (size / 10)); 
    
    // Emit a burst of hearts where the bubble was
    const popCount = Math.floor(size / 5);
    const rect = BUBBLE_SVG.getBoundingClientRect();

    for (let i = 0; i < popCount; i++) {
        const burstHeart = createHeartParticle();
        // Give burst hearts an initial velocity/position
        burstHeart.style.left = `${rect.x + rect.width / 2}px`;
        burstHeart.style.top = `${rect.y + rect.height / 2}px`;
        // Temporarily increase speed for the "burst" effect
        burstHeart.style.animationDuration = `${Math.random() * 2 + 1}s`; 
        burstHeart.style.fontSize = `${Math.random() * 1.5 + 0.5}rem`;
    }
}

// --- 5. Event Listeners ---

function startScene() {
    if (!isAuthReady) {
        console.warn("Scene cannot start, Firebase not ready.");
        return;
    }
    
    isPlaying = true;
    START_OVERLAY.style.opacity = 0;
    setTimeout(() => START_OVERLAY.style.display = 'none', 1000);

    // Start the R&B audio (will only play if user interaction initiated it)
    AUDIO.src = 'placeholder_audio.mp3'; // Replace with your actual R&B loop URL
    AUDIO.play().catch(e => console.log("Audio autoplay blocked."));
    
    requestAnimationFrame(gameLoop);
}

// 1. Initial Start Button
START_BUTTON.addEventListener('click', startScene);

// 2. Thumb Light Effect (Follow Cursor/Touch)
document.addEventListener('mousemove', (e) => {
    THUMB_LIGHT.style.left = `${e.clientX - 125}px`;
    THUMB_LIGHT.style.top = `${e.clientY - 125}px`;
});
document.addEventListener('touchstart', (e) => {
    const touch = e.touches[0];
    THUMB_LIGHT.style.left = `${touch.clientX - 125}px`;
    THUMB_LIGHT.style.top = `${touch.clientY - 125}px`;
    THUMB_LIGHT.style.opacity = 0.9;
});
document.addEventListener('touchend', () => {
    THUMB_LIGHT.style.opacity = 0.7;
});

// 3. Blow Bubble Interaction (Hold to Inflate)
function startInflating() { isBubbleInflating = true; }
function stopInflating() { isBubbleInflating = false; }

LOLLIPOP_ZONE.addEventListener('mousedown', startInflating);
LOLLIPOP_ZONE.addEventListener('mouseup', stopInflating);
LOLLIPOP_ZONE.addEventListener('mouseleave', stopInflating); // Prevents infinite inflation if cursor leaves while holding
LOLLIPOP_ZONE.addEventListener('touchstart', startInflating);
LOLLIPOP_ZONE.addEventListener('touchend', stopInflating);

// 4. Memory Modal Controls
VIEW_MEMORIES_BUTTON.addEventListener('click', () => {
    if (isAuthReady) {
        MEMORY_MODAL.classList.remove('hidden');
    } else {
        alert("Please wait for the app to initialize its connection first.");
    }
});
CLOSE_MODAL_BUTTON.addEventListener('click', () => {
    MEMORY_MODAL.classList.add('hidden');
});

// 5. Gemini API Trigger
GEMINI_BUTTON.addEventListener('click', () => {
    const inputWord = GEMINI_INPUT.value.trim();
    if (inputWord) {
        getAndSavePoeticReflection(inputWord);
        GEMINI_INPUT.value = ''; // Clear input
    } else {
        GEMINI_OUTPUT.textContent = "Please provide an input word first.";
    }
});


// --- 6. Initial App Execution ---
window.onload = initializeFirebase;
