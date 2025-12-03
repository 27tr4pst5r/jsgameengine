import * as THREE from 'three';
import * as CANNON from 'https://cdn.jsdelivr.net/npm/cannon-es@0.20.0/dist/cannon-es.js';
import { Engine3D } from './engine3d.js';

// --- FIREBASE IMPORTS ---
import { initializeApp } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-app.js";
import { getDatabase, ref, set, push, update, get, remove, onDisconnect, onChildAdded, onChildChanged, onChildRemoved, query, limitToLast, limitToFirst, serverTimestamp } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-database.js";

// !!! ---------------------------------------------------------------- !!!
// !!! REPLACE THIS WITH YOUR OWN FIREBASE CONFIG FROM CONSOLE.FIREBASE.GOOGLE.COM !!!
// !!! ---------------------------------------------------------------- !!!
const firebaseConfig = {
    apiKey: "AIzaSyBoWUXZ03KpmO8Vido7GlFTipfFZmGakik",
    authDomain: "game2-c8d5a.firebaseapp.com",
    projectId: "game2-c8d5a",
    storageBucket: "game2-c8d5a.firebasestorage.app",
    messagingSenderId: "882556276572",
    appId: "1:882556276572:web:9b144925cabc8d8bf5fb99",
    measurementId: "G-D3WRK6V5VP"
};

// --- HELPER: GUN MESH GENERATOR ---
function createGunMesh(isFirstPerson) {
    const gunGroup = new THREE.Group();
    const metalMat = new THREE.MeshStandardMaterial({
        color: 0x333333,
        roughness: 0.2,
        metalness: 0.8
    });
    const glowMat = new THREE.MeshStandardMaterial({
        color: 0x00ccff,
        emissive: 0x00ccff,
        emissiveIntensity: 2
    });

    // Barrel
    const barrel = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.04, 0.5, 12), metalMat);
    barrel.rotation.x = -Math.PI / 2;
    gunGroup.add(barrel);
    
    // Handle
    const handle = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.2, 0.06), metalMat);
    handle.position.set(0, -0.15, 0.15);
    handle.rotation.x = -0.3;
    gunGroup.add(handle);
    
    // Rings
    const r1 = new THREE.Mesh(new THREE.CylinderGeometry(0.042, 0.042, 0.02, 12), glowMat);
    r1.rotation.x = -Math.PI / 2;
    r1.position.z = -0.2;
    gunGroup.add(r1);

    const r2 = new THREE.Mesh(new THREE.CylinderGeometry(0.042, 0.042, 0.02, 12), glowMat);
    r2.rotation.x = -Math.PI / 2;
    r2.position.z = 0;
    gunGroup.add(r2);

    // Ray
    const rayGeo = new THREE.CylinderGeometry(0.01, 0.01, 1, 8, 1, true);
    rayGeo.rotateX(-Math.PI / 2);
    rayGeo.translate(0, 0, 0.5); // Origin at start
    const rayMat = new THREE.MeshBasicMaterial({
        color: 0x00ccff,
        transparent: true,
        opacity: 0.3,
        blending: THREE.AdditiveBlending,
        depthWrite: false
    });
    const rayMesh = new THREE.Mesh(rayGeo, rayMat);
    
    // Core
    const coreGeo = new THREE.CylinderGeometry(0.002, 0.002, 1, 4, 1, true);
    coreGeo.rotateX(-Math.PI / 2);
    coreGeo.translate(0, 0, 0.5);
    rayMesh.add(new THREE.Mesh(coreGeo, new THREE.MeshBasicMaterial({
        color: 0xffffff,
        transparent: true,
        opacity: 0.8
    })));
    rayMesh.visible = false;

    return { gunGroup, rayMesh };
}

// --- VOICE CHAT MANAGER CLASS (PeerJS Wrapper) ---
class VoiceManager {
    constructor() {
        this.peer = null;
        this.localStream = null;
        this.connections = {}; 
        this.audioContext = null;
        this.analyser = null;
        this.dataArray = null;
        this.isReady = false;
        this.myId = null;
    }

    async init(id) {
        this.myId = id;
        try {
            // 1. Check for Browser Support & HTTPS
            if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
                console.warn("Voice Chat Disabled: Environment is not secure (HTTP) or browser unsupported.");
                this.updateStatus("Voice Disabled (Insecure Connection)");
                this.initPeerOnly(id); // Fallback to listen-only
                return;
            }

            // 2. Init Audio Context
            if (!this.audioContext) {
                this.audioContext = new (window.AudioContext || window.webkitAudioContext)();
            }

            // 3. Request Mic Access
            this.localStream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
            
            // 4. Setup Analysis (for visuals)
            const source = this.audioContext.createMediaStreamSource(this.localStream);
            this.analyser = this.audioContext.createAnalyser();
            this.analyser.fftSize = 64;
            source.connect(this.analyser);
            this.dataArray = new Uint8Array(this.analyser.frequencyBinCount);

            // 5. Start Muted
            this.toggleMic(false);

            // 6. Connect to P2P Server
            this.initPeerOnly(id);

        } catch (e) {
            console.warn("Voice Chat Init Failed (Mic denied?):", e);
            this.updateStatus("Voice Disabled (Mic Denied)");
            this.initPeerOnly(id);
        }
    }

    updateStatus(msg) {
        const status = document.getElementById('connection-status');
        if(status) {
            status.innerText = msg;
            status.style.color = '#ffaa00';
            status.style.display = 'block';
        }
    }

    initPeerOnly(id) {
         if (typeof Peer === 'undefined') return; // PeerJS not loaded

         try {
             this.peer = new Peer(id); 
             this.peer.on('open', (id) => {
                 console.log('Voice Chat Ready (ID):', id);
                 this.isReady = true;
             });
             this.peer.on('call', (call) => {
                 // Answer call. If we have a mic stream, send it. If not, send nothing.
                 call.answer(this.localStream || undefined); 
                 this.handleCall(call);
             });
             this.peer.on('error', (err) => console.warn('PeerJS Error:', err));
         } catch(e) {
             console.error("PeerJS Failed:", e);
         }
    }

    handleCall(call) {
        call.on('stream', (remoteStream) => {
            // Resume audio context if browser paused it
            if (this.audioContext && this.audioContext.state === 'suspended') {
                this.audioContext.resume();
            }
            
            const audio = new Audio();
            audio.srcObject = remoteStream;
            audio.autoplay = true;
            document.body.appendChild(audio); 
            audio.play().catch(e => {}); // Ignore autoplay errors
        });
        this.connections[call.peer] = call;
    }

    connectTo(remoteId) {
        if (!this.isReady || !this.peer) return;
        if (this.connections[remoteId]) return;

        // Call them. If we have no mic, we just send undefined (Listen Only)
        const call = this.peer.call(remoteId, this.localStream || undefined);
        this.handleCall(call);
    }

    toggleMic(isActive) {
        if (this.localStream) {
            const tracks = this.localStream.getAudioTracks();
            if(tracks.length > 0) tracks[0].enabled = isActive;
        }
        // Resume context on interaction
        if (isActive && this.audioContext && this.audioContext.state === 'suspended') {
            this.audioContext.resume();
        }
    }

    isSpeaking() {
        if (!this.analyser || !this.localStream || !this.localStream.getAudioTracks()[0].enabled) return false;
        this.analyser.getByteFrequencyData(this.dataArray);
        let sum = 0;
        for (let i = 0; i < this.dataArray.length; i++) sum += this.dataArray[i];
        return (sum / this.dataArray.length) > 10;
    }
}

// --- MULTIPLAYER MANAGER ---
class NetworkManager {
    constructor(scene, localPlayer) {
        this.scene = scene;
        this.localPlayer = localPlayer;
        this.remotePlayers = {}; 
        this.syncedObjects = {}; 
        this.playerId = 'user_' + Math.random().toString(36).substr(2, 9);
        this.playerName = "Player";
        this.db = null;
        this.playerRef = null;
        this.lastUpdate = 0;
        this.tickRate = 50; 
        this.playerColor = Math.floor(Math.random()*16777215);
        this.isChatting = false; 
        this.isSpawned = false;
        this.ping = 0;
        this.voice = new VoiceManager();
    }

    init() {
        try {
            const app = initializeApp(firebaseConfig);
            this.db = getDatabase(app);
            
            const playersRef = ref(this.db, 'players');
            onChildAdded(playersRef, (snapshot) => {
                if (snapshot.key === this.playerId) return; 
                this.addRemotePlayer(snapshot.key, snapshot.val());
            });
            onChildChanged(playersRef, (snapshot) => {
                if (snapshot.key === this.playerId) return;
                if (this.remotePlayers[snapshot.key]) {
                    this.remotePlayers[snapshot.key].updateData(snapshot.val());
                }
            });
            onChildRemoved(playersRef, (snapshot) => this.removeRemotePlayer(snapshot.key));

            this.initObjectSync();
            this.initChat();
            setInterval(() => this.cleanupGhosts(), 5000);
            setInterval(() => this.measurePing(), 4000);

            const status = document.getElementById('connection-status');
            if(status) {
                status.innerText = `Connected`;
                status.style.color = '#00ff00';
            }
            
        } catch (e) {
            console.error("Firebase Init Failed:", e);
            const status = document.getElementById('connection-status');
            if(status) {
                status.innerText = "Firebase Config Missing!";
                status.style.color = '#ff0000';
                status.style.display = 'block';
            }
        }
    }

    measurePing() {
        if (!this.db) return;
        const start = Date.now();
        set(ref(this.db, `ping/${this.playerId}`), start).then(() => {
            this.ping = Date.now() - start;
        });
    }

    cleanupGhosts() {
        const now = Date.now();
        for (let id in this.remotePlayers) {
            if (now - this.remotePlayers[id].lastUpdateLocal > 10000) {
                this.removeRemotePlayer(id);
                remove(ref(this.db, 'players/' + id)).catch(()=>{});
            }
        }
    }

    initObjectSync() {
        if(!this.db) return;
        const objectsRef = ref(this.db, 'objects');
        get(query(objectsRef, limitToFirst(1))).then((snapshot) => {
            if (!snapshot.exists()) this.generateWorld();
        });

        onChildAdded(objectsRef, (s) => this.spawnSyncedObject(s.key, s.val()));
        onChildChanged(objectsRef, (s) => {
            if (this.syncedObjects[s.key]) this.syncedObjects[s.key].updateData(s.val());
        });
    }

    generateWorld() {
        if(!this.db) return;
        for (let i = 0; i < 50; i++) {
            const sy = 1 + Math.random() * 5;
            push(ref(this.db, 'objects'), {
                x: (Math.random() - 0.5) * 100, y: sy / 2 + 5, z: (Math.random() - 0.5) * 100,
                sx: 1 + Math.random() * 2, sy: sy, sz: 1 + Math.random() * 2,
                tex: Math.floor(Math.random() * 3),
                qx: 0, qy: 0, qz: 0, qw: 1,
                owner: null,
                frozen: false
            });
        }
    }

    spawnSyncedObject(id, data) {
        if (this.syncedObjects[id]) return;
        const grids = [orangeGrid, blueGrid, greyGrid];
        const mat = new THREE.MeshStandardMaterial({ map: grids[data.tex] || greyGrid, roughness: 0.5, metalness: 0.1 });
        const cube = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), mat);
        cube.scale.set(data.sx, data.sy, data.sz);
        cube.position.set(data.x, data.y, data.z);
        if (data.qx) cube.quaternion.set(data.qx, data.qy, data.qz, data.qw);
        cube.castShadow = true; cube.receiveShadow = true;
        
        cube.userData.originalMat = mat;

        const body = createPhysicsBox(cube, 50);
        game.add(cube);
        obstacles.push(cube);
        cameraColliders.push(cube);

        const syncObj = new SyncedObject(id, cube, body);
        this.syncedObjects[id] = syncObj;
        syncObj.updateData(data);

        cube.userData.firebaseId = id; 
        body.userData.firebaseId = id;
    }

    freezeObject(id) {
        if (!id || !this.syncedObjects[id] || !this.db) return;
        update(ref(this.db, `objects/${id}`), {
            frozen: true,
            owner: null 
        });
    }

    unfreezeObject(id) {
        if (!id || !this.syncedObjects[id] || !this.db) return;
        update(ref(this.db, `objects/${id}`), {
            frozen: false,
            owner: this.playerId 
        });
    }

    claimObject(id) {
        if (!id || !this.syncedObjects[id] || !this.db) return;
        if (this.syncedObjects[id].isFrozen) return;
        update(ref(this.db, `objects/${id}`), { owner: this.playerId });
    }

    spawn(name) {
        this.playerName = name || "Player";
        // INIT VOICE
        this.voice.init(this.playerId);

        if (this.db) {
            this.playerRef = ref(this.db, 'players/' + this.playerId);
            set(this.playerRef, {
                name: this.playerName,
                x: 0, y: 5, z: 0, ry: 0,
                crouch: 0, speed: 0, 
                color: this.playerColor,
                timestamp: serverTimestamp(),
                ping: 0,
                jump: false,
                holdingGun: false,
                firing: false,
                rayDist: 0,
                isTalking: false
            });
            onDisconnect(this.playerRef).remove();
        }
        this.isSpawned = true;
        const status = document.getElementById('connection-status');
        if(status) status.innerText = `Playing as ${this.playerName}`;
    }

    initChat() {
        if(!this.db) return;
        const chatInput = document.getElementById('chat-input');
        const chatMessages = document.getElementById('chat-messages');
        const chatContainer = document.getElementById('chat-container');
        const messagesRef = query(ref(this.db, 'chat'), limitToLast(20));
        
        onChildAdded(messagesRef, (snapshot) => {
            const msg = snapshot.val();
            if (!msg || !msg.text) return;
            const div = document.createElement('div');
            div.className = 'chat-msg appear';
            const nameSpan = document.createElement('span');
            nameSpan.className = 'chat-name';
            nameSpan.innerText = msg.name + ':';
            nameSpan.style.color = '#' + msg.color.toString(16).padStart(6, '0');
            div.appendChild(nameSpan);
            div.appendChild(document.createTextNode(msg.text));
            chatMessages.appendChild(div);
            chatMessages.scrollTop = chatMessages.scrollHeight;
            setTimeout(() => { div.classList.remove('appear'); }, 5000);
        });

        chatInput.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') {
                const text = chatInput.value.trim();
                if (text) {
                    push(ref(this.db, 'chat'), { name: this.playerName, text: text, color: this.playerColor, timestamp: serverTimestamp() });
                    chatInput.value = '';
                }
                this.isChatting = false;
                chatContainer.classList.remove('active');
                game.input.lock();
                chatInput.blur();
            }
        });

        window.addEventListener('keydown', (e) => {
            const chatBind = game.input.bindings['Chat'] || 'Enter';
            if (e.code === chatBind) {
                if (document.pointerLockElement === document.body && this.isSpawned) {
                    this.isChatting = true; 
                    document.exitPointerLock();
                    chatContainer.classList.add('active'); 
                    setTimeout(() => chatInput.focus(), 50);
                }
            }
        });
    }

    addRemotePlayer(id, data) {
        if (data.timestamp && Date.now() - data.timestamp > 30000) {
            if(this.db) remove(ref(this.db, 'players/' + id)).catch(()=>{});
            return;
        }
        this.remotePlayers[id] = new RemotePlayer(this.scene, data);
        this.voice.connectTo(id);
    }

    removeRemotePlayer(id) {
        if (this.remotePlayers[id]) {
            this.remotePlayers[id].dispose();
            delete this.remotePlayers[id];
        }
    }

    update(dt) {
        if (!this.isSpawned) return;

        // PTT Logic
        if (game.input.isAction('Voice')) {
            this.voice.toggleMic(true);
        } else {
            this.voice.toggleMic(false);
        }

        // Player List UI
        const playerList = document.getElementById('player-list');
        if (game.input.isAction('PlayerList')) {
            playerList.style.display = 'flex';
            playerList.innerHTML = `<div class="plist-header"><span>PLAYER</span><span>PING</span></div>`;
            playerList.innerHTML += `<div class="plist-row"><span class="plist-name" style="color:#00ff00;">${this.playerName} (You)</span><span class="plist-ping">${this.ping}ms</span></div>`;
            for (let id in this.remotePlayers) {
                const p = this.remotePlayers[id];
                playerList.innerHTML += `<div class="plist-row"><span class="plist-name">${p.currentName || "Unknown"}</span><span class="plist-ping">${p.ping}ms</span></div>`;
            }
        } else {
            playerList.style.display = 'none';
        }

        if (!this.playerRef) return;

        const now = performance.now();
        if (this.db && now - this.lastUpdate > this.tickRate) {
            set(this.playerRef, {
                name: this.playerName,
                x: this.localPlayer.position.x,
                y: this.localPlayer.position.y,
                z: this.localPlayer.position.z,
                ry: this.localPlayer.rotation.y,
                crouch: this.localPlayer.crouchFactor,
                speed: this.localPlayer.currentSpeed,
                isDead: this.localPlayer.isDead,
                color: this.playerColor,
                timestamp: serverTimestamp(),
                ping: this.ping,
                jump: !this.localPlayer.onGround,
                holdingGun: this.localPlayer.gunState?.holding || false,
                firing: this.localPlayer.gunState?.firing || false,
                rayDist: this.localPlayer.gunState?.dist || 0,
                isTalking: this.voice.isSpeaking()
            });

            for (let id in this.syncedObjects) {
                const obj = this.syncedObjects[id];
                if (obj.owner === this.playerId && !obj.isFrozen) {
                    update(ref(this.db, `objects/${id}`), {
                        x: obj.body.position.x,
                        y: obj.body.position.y,
                        z: obj.body.position.z,
                        qx: obj.body.quaternion.x,
                        qy: obj.body.quaternion.y,
                        qz: obj.body.quaternion.z,
                        qw: obj.body.quaternion.w
                    });
                } else {
                    obj.update(dt);
                }
            }
            this.lastUpdate = now;
        }

        for (let id in this.remotePlayers) {
            this.remotePlayers[id].update(dt);
        }
    }
}

// --- SYNCED OBJECT CLASS ---
class SyncedObject {
    constructor(id, mesh, body) {
        this.id = id;
        this.mesh = mesh;
        this.body = body;
        this.owner = null;
        this.isFrozen = false;
        this.targetPos = new THREE.Vector3();
        this.targetQuat = new THREE.Quaternion();
        this.isMoved = false;
        this.iceMat = new THREE.MeshStandardMaterial({
            color: 0x00ffff,
            roughness: 0.1,
            metalness: 0.8,
            emissive: 0x0088ff,
            emissiveIntensity: 0.5,
            transparent: true,
            opacity: 0.8
        });
    }

    updateData(data) {
        this.owner = data.owner;
        this.targetPos.set(data.x, data.y, data.z);
        if (data.qw !== undefined) this.targetQuat.set(data.qx, data.qy, data.qz, data.qw);

        if (this.isFrozen !== !!data.frozen) {
            this.isFrozen = !!data.frozen;
            if (this.isFrozen) {
                this.body.type = CANNON.Body.STATIC;
                this.body.mass = 0;
                this.body.velocity.set(0, 0, 0);
                this.body.angularVelocity.set(0, 0, 0);
                this.mesh.material = this.iceMat;
            } else {
                this.body.type = CANNON.Body.DYNAMIC;
                this.body.mass = 50;
                this.body.wakeUp();
                if (this.mesh.userData.originalMat) this.mesh.material = this.mesh.userData.originalMat;
            }
            this.body.updateMassProperties();
        }
        this.isMoved = true;
    }

    update(dt) {
        if (!this.isMoved) return;
        this.mesh.position.lerp(this.targetPos, 10 * dt);
        this.mesh.quaternion.slerp(this.targetQuat, 10 * dt);
        this.body.position.copy(this.mesh.position);
        this.body.quaternion.copy(this.mesh.quaternion);
        this.body.velocity.set(0, 0, 0);
        this.body.angularVelocity.set(0, 0, 0);
    }
}

// --- REMOTE PLAYER CLASS ---
class RemotePlayer {
    constructor(scene, data) {
        this.scene = scene;
        this.mesh = createHumanoidMesh(data.color || 0xffffff);
        this.scene.add(this.mesh);

        const visuals = createGunMesh(false);
        this.gunGroup = visuals.gunGroup;
        this.rayMesh = visuals.rayMesh;
        this.mesh.userData.limbs.rightArm.add(this.gunGroup);
        this.gunGroup.position.set(0, -0.55, -0.15);
        this.scene.add(this.rayMesh);

        this.targetPos = new THREE.Vector3();
        this.targetRotY = 0;
        this.crouchFactor = 0;
        this.moveSpeed = 0;
        this.nameTag = null;
        this.voiceIcon = null;
        this.currentName = null;
        this.ping = 0;
        this.isJumping = false;
        this.lastUpdateLocal = Date.now();
        this.updateData(data);
    }

    createNameTag(name) {
        if (this.nameTag) this.mesh.remove(this.nameTag);
        
        const group = new THREE.Group();
        group.position.y = 2.4;
        
        const canvas = document.createElement('canvas');
        const ctx = canvas.getContext('2d');
        canvas.width = 512; canvas.height = 256; 
        
        ctx.fillStyle = "rgba(0, 0, 0, 0.4)";
        const x=56, y=100, w=400, h=100, r=20;
        ctx.beginPath();
        ctx.moveTo(x+r, y); ctx.lineTo(x+w-r, y); ctx.quadraticCurveTo(x+w, y, x+w, y+r);
        ctx.lineTo(x+w, y+h-r); ctx.quadraticCurveTo(x+w, y+h, x+w-r, y+h);
        ctx.lineTo(x+r, y+h); ctx.quadraticCurveTo(x, y+h, x, y+h-r);
        ctx.lineTo(x, y+r); ctx.quadraticCurveTo(x, y, x+r, y);
        ctx.fill();
        ctx.fillStyle = "white";
        ctx.font = "bold 60px Arial";
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.shadowColor = "black";
        ctx.shadowBlur = 4;
        ctx.fillText(name, 256, 150);

        const tex = new THREE.CanvasTexture(canvas);
        const spriteMat = new THREE.SpriteMaterial({ map: tex, transparent: true, depthTest: false });
        this.nameTag = new THREE.Sprite(spriteMat);
        this.nameTag.scale.set(4, 2, 1);
        group.add(this.nameTag);

        const vCanvas = document.createElement('canvas');
        vCanvas.width = 128; vCanvas.height = 128;
        const vCtx = vCanvas.getContext('2d');
        vCtx.font = "100px Arial";
        vCtx.textAlign = "center";
        vCtx.textBaseline = "middle";
        vCtx.fillText("🔊", 64, 64);
        const vTex = new THREE.CanvasTexture(vCanvas);
        const vMat = new THREE.SpriteMaterial({ map: vTex, transparent: true, depthTest: false });
        this.voiceIcon = new THREE.Sprite(vMat);
        this.voiceIcon.position.y = 0.8;
        this.voiceIcon.scale.set(0.5, 0.5, 1);
        this.voiceIcon.visible = false;
        group.add(this.voiceIcon);

        this.mesh.add(group);
    }

    updateData(data) {
        this.targetPos.set(data.x, data.y, data.z);
        this.targetRotY = data.ry;
        this.crouchFactor = data.crouch || 0;
        this.moveSpeed = data.speed || 0;
        this.ping = data.ping || 0;
        this.isJumping = !!data.jump;
        this.mesh.visible = !data.isDead;

        const newName = data.name || "Unknown";
        if (this.currentName !== newName) {
            this.currentName = newName;
            this.createNameTag(newName);
        }

        if(this.voiceIcon) {
            this.voiceIcon.visible = !!data.isTalking;
            if(data.isTalking) {
                this.voiceIcon.scale.setScalar(0.5 + Math.sin(Date.now() * 0.02) * 0.1);
            }
        }

        this.gunGroup.visible = !!data.holdingGun;
        this.rayMesh.visible = !!data.firing;

        if (data.firing) {
            const handPos = new THREE.Vector3();
            this.gunGroup.getWorldPosition(handPos);
            const forward = new THREE.Vector3(0, 0, -1).applyAxisAngle(new THREE.Vector3(0, 1, 0), this.targetRotY);
            const gunTip = handPos.clone().add(forward.multiplyScalar(0.5));
            const endPoint = gunTip.clone().add(forward.multiplyScalar(data.rayDist || 10));

            this.rayMesh.position.copy(gunTip);
            this.rayMesh.lookAt(endPoint);
            this.rayMesh.scale.set(1, 1, gunTip.distanceTo(endPoint));
        }
        this.lastUpdateLocal = Date.now();
    }

    update(dt) {
        this.mesh.position.lerp(this.targetPos, 10 * dt);
        let diff = this.targetRotY - this.mesh.rotation.y;
        while (diff > Math.PI) diff -= Math.PI * 2;
        while (diff < -Math.PI) diff += Math.PI * 2;
        this.mesh.rotation.y += diff * 10 * dt;
        updateLimbVisuals(this.mesh, this.crouchFactor, dt, this.moveSpeed, this.isJumping);
    }

    dispose() {
        this.scene.remove(this.mesh);
        this.scene.remove(this.rayMesh);
    }
}

// --- SHARED LIMB ANIMATION LOGIC ---
function updateLimbVisuals(mesh, crouchFactor, dt, speed, isJumping) {
    const {
        leftArm,
        rightArm,
        leftLegHip,
        rightLegHip,
        leftLegKnee,
        rightLegKnee,
        torso,
        spine,
        head,
        legTotalHeight
    } = mesh.userData.limbs;
    mesh.userData.animTime = (mesh.userData.animTime || 0);
    const hipBend = Math.PI * 0.4 * crouchFactor;
    const kneeBend = -Math.PI * 0.7 * crouchFactor;
    const torsoDrop = -0.35 * crouchFactor;
    const spineLean = -Math.PI * 0.25 * crouchFactor;
    const headLook = Math.PI * 0.25 * crouchFactor;
    const hipShift = 0.25 * crouchFactor;
    const armHang = -Math.PI * 0.1 * crouchFactor;
    torso.position.y = legTotalHeight + torsoDrop;
    torso.position.z = hipShift;
    spine.rotation.x = spineLean;
    head.rotation.x = headLook;
    let leftHipRot = hipBend;
    let rightHipRot = hipBend;
    let leftKneeRot = kneeBend;
    let rightKneeRot = kneeBend;
    let leftArmRot = armHang;
    let rightArmRot = armHang;
    if (speed > 0.1 && !isJumping) {
        mesh.userData.animTime += dt * speed * 0.8;
        const angle = Math.sin(mesh.userData.animTime) * 1.4;
        const swingMult = (1.0 - crouchFactor * 0.5);
        leftHipRot += angle * swingMult;
        rightHipRot += -angle * swingMult;
        leftKneeRot += Math.min(0, -angle * 1.5 * swingMult);
        rightKneeRot += Math.min(0, angle * 1.5 * swingMult);
        leftArmRot += -angle * swingMult;
        rightArmRot += angle * swingMult;
    }
    if (isJumping) {
        leftHipRot = -0.5;
        rightHipRot = 0.5;
        leftKneeRot = -1.5;
        rightKneeRot = -0.2;
        leftArmRot = -2.0;
        rightArmRot = -2.0;
    }
    const s = 15 * dt;

    function smoothRotX(obj, target) {
        obj.rotation.x += (target - obj.rotation.x) * s;
    }
    smoothRotX(leftLegHip, leftHipRot);
    smoothRotX(rightLegHip, rightHipRot);
    smoothRotX(leftLegKnee, leftKneeRot);
    smoothRotX(rightLegKnee, rightKneeRot);
    smoothRotX(leftArm, leftArmRot);
    smoothRotX(rightArm, rightArmRot);
}

// --- HELPER: GENERATE PROTOTYPE GRID TEXTURE ---
function createGridTexture(color1 = '#333333', color2 = '#444444', size = 512, divisions = 4) {
    const canvas = document.createElement('canvas');
    canvas.width = size;
    canvas.height = size;
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = color1;
    ctx.fillRect(0, 0, size, size);
    ctx.strokeStyle = color2;
    ctx.lineWidth = 4;
    ctx.beginPath();
    const step = size / divisions;
    for (let i = 0; i <= divisions; i++) {
        ctx.moveTo(i * step, 0);
        ctx.lineTo(i * step, size);
        ctx.moveTo(0, i * step);
        ctx.lineTo(size, i * step);
    }
    ctx.stroke();
    ctx.lineWidth = 10;
    ctx.strokeRect(0, 0, size, size);
    const texture = new THREE.CanvasTexture(canvas);
    texture.wrapS = THREE.RepeatWrapping;
    texture.wrapT = THREE.RepeatWrapping;
    texture.anisotropy = 4;
    texture.colorSpace = THREE.SRGBColorSpace;
    return texture;
}
const darkGrid = createGridTexture('#1a1a1a', '#333333', 512, 2);
const orangeGrid = createGridTexture('#ff6600', '#ff8822', 256, 1);
const blueGrid = createGridTexture('#0066ff', '#0088ff', 256, 1);
const greyGrid = createGridTexture('#555555', '#777777', 256, 2);

// --- PHYSICS WORLD SETUP ---
const world = new CANNON.World();
world.gravity.set(0, -30, 0);
world.broadphase = new CANNON.NaiveBroadphase();
world.solver.iterations = 20;
const defaultMaterial = new CANNON.Material('default');
const defaultContactMaterial = new CANNON.ContactMaterial(defaultMaterial, defaultMaterial, {
    friction: 0.4,
    restitution: 0.1
});
world.addContactMaterial(defaultContactMaterial);
const wheelMaterial = new CANNON.Material('wheel');
const wheelContactMaterial = new CANNON.ContactMaterial(wheelMaterial, defaultMaterial, {
    friction: 3.5,
    restitution: 0
});
world.addContactMaterial(wheelContactMaterial);
const obstacles = [];
const cameraColliders = [];

// --- HELPER: Create Physics Box ---
function createPhysicsBox(mesh, mass = 1) {
    const shape = new CANNON.Box(new CANNON.Vec3(mesh.scale.x / 2, mesh.scale.y / 2, mesh.scale.z / 2));
    const body = new CANNON.Body({
        mass: mass,
        position: new CANNON.Vec3(mesh.position.x, mesh.position.y, mesh.position.z),
        material: defaultMaterial,
        shape: shape
    });
    mesh.userData.body = body;
    body.userData = {
        mesh: mesh
    };
    world.addBody(body);
    return body;
}

// --- CLASS: CAR ---
class Car {
    constructor(scene, world, position) {
        this.scene = scene;
        this.world = world;
        this.wheelMeshes = [];
        this.chassisBody = null;
        this.vehicle = null;
        this.currentSteering = 0;
        this.targetSteering = 0;
        const chassisShape = new CANNON.Box(new CANNON.Vec3(1, 0.5, 2));
        this.chassisBody = new CANNON.Body({
            mass: 800,
            material: defaultMaterial
        });
        this.chassisBody.addShape(chassisShape, new CANNON.Vec3(0, 0.3, 0));
        this.chassisBody.position.copy(position);
        this.chassisBody.angularDamping = 0.95;
        this.chassisBody.linearDamping = 0.1;
        const chassisGroup = new THREE.Group();
        const mainBody = new THREE.Mesh(new THREE.BoxGeometry(2, 1, 4), new THREE.MeshStandardMaterial({
            color: 0xcc0000,
            metalness: 0.6,
            roughness: 0.3
        }));
        mainBody.position.y = 0.3;
        mainBody.castShadow = true;
        mainBody.receiveShadow = true;
        chassisGroup.add(mainBody);
        const cabin = new THREE.Mesh(new THREE.BoxGeometry(1.8, 0.7, 2), new THREE.MeshStandardMaterial({
            color: 0x111111,
            metalness: 0.8,
            roughness: 0.1
        }));
        cabin.position.y = 1.15;
        cabin.position.z = -0.5;
        cabin.castShadow = true;
        chassisGroup.add(cabin);
        const lightGeo = new THREE.BoxGeometry(0.4, 0.2, 0.1);
        const lightMat = new THREE.MeshStandardMaterial({
            color: 0xffffaa,
            emissive: 0xffffaa,
            emissiveIntensity: 5
        });
        const hl = new THREE.Mesh(lightGeo, lightMat);
        hl.position.set(-0.6, 0.5, 2);
        chassisGroup.add(hl);
        const hr = new THREE.Mesh(lightGeo, lightMat);
        hr.position.set(0.6, 0.5, 2);
        chassisGroup.add(hr);
        const tailMat = new THREE.MeshStandardMaterial({
            color: 0xff0000,
            emissive: 0xff0000,
            emissiveIntensity: 3
        });
        const tl = new THREE.Mesh(lightGeo, tailMat);
        tl.position.set(-0.6, 0.5, -2);
        chassisGroup.add(tl);
        const tr = new THREE.Mesh(lightGeo, tailMat);
        tr.position.set(0.6, 0.5, -2);
        chassisGroup.add(tr);
        this.chassisMesh = chassisGroup;
        this.scene.add(this.chassisMesh);
        this.chassisBody.userData = {
            mesh: this.chassisMesh
        };
        this.chassisMesh.userData.body = this.chassisBody;
        this.chassisMesh.userData.isCar = true;
        this.chassisMesh.userData.carController = this;
        this.vehicle = new CANNON.RaycastVehicle({
            chassisBody: this.chassisBody,
            indexRightAxis: 0,
            indexUpAxis: 1,
            indexForwardAxis: 2
        });
        const options = {
            radius: 0.5,
            directionLocal: new CANNON.Vec3(0, -1, 0),
            suspensionStiffness: 45,
            suspensionRestLength: 0.4,
            frictionSlip: 3.0,
            dampingRelaxation: 4.0,
            dampingCompression: 4.0,
            maxSuspensionForce: 100000,
            rollInfluence: 0.1,
            axleLocal: new CANNON.Vec3(1, 0, 0),
            chassisConnectionPointLocal: new CANNON.Vec3(1, 1, 0),
            maxSuspensionTravel: 0.3,
            customSlidingRotationalSpeed: -30,
            useCustomSlidingRotationalSpeed: true
        };
        options.chassisConnectionPointLocal.set(1, 0, 1.2);
        this.vehicle.addWheel(options);
        options.chassisConnectionPointLocal.set(-1, 0, 1.2);
        this.vehicle.addWheel(options);
        options.chassisConnectionPointLocal.set(1, 0, -1.2);
        this.vehicle.addWheel(options);
        options.chassisConnectionPointLocal.set(-1, 0, -1.2);
        this.vehicle.addWheel(options);
        this.vehicle.addToWorld(this.world);
        const wheelGeo = new THREE.CylinderGeometry(0.5, 0.5, 0.4, 24);
        wheelGeo.rotateZ(Math.PI / 2);
        const wheelMat = new THREE.MeshStandardMaterial({
            color: 0x111111,
            roughness: 0.9
        });
        const hubGeo = new THREE.BoxGeometry(0.3, 0.1, 0.4);
        const hubMesh = new THREE.Mesh(hubGeo, new THREE.MeshStandardMaterial({
            color: 0x888888
        }));
        for (let i = 0; i < this.vehicle.wheelInfos.length; i++) {
            const wheelGroup = new THREE.Group();
            const wheel = new THREE.Mesh(wheelGeo, wheelMat);
            wheel.castShadow = true;
            wheelGroup.add(wheel);
            wheelGroup.add(hubMesh.clone());
            this.scene.add(wheelGroup);
            this.wheelMeshes.push(wheelGroup);
        }
        this.world.addBody(this.chassisBody);
        obstacles.push(this.chassisMesh);
    }
    update(dt) {
        this.chassisMesh.position.copy(this.chassisBody.position);
        this.chassisMesh.quaternion.copy(this.chassisBody.quaternion);
        for (let i = 0; i < this.vehicle.wheelInfos.length; i++) {
            this.vehicle.updateWheelTransform(i);
            const t = this.vehicle.wheelInfos[i].worldTransform;
            this.wheelMeshes[i].position.copy(t.position);
            this.wheelMeshes[i].quaternion.copy(t.quaternion);
        }
        const steerSpeed = 6.0 * dt;
        this.currentSteering += (this.targetSteering - this.currentSteering) * steerSpeed;
        this.vehicle.setSteeringValue(this.currentSteering, 0);
        this.vehicle.setSteeringValue(this.currentSteering, 1);
    }
    control(input) {
        if (!input) {
            this.targetSteering = 0;
            this.vehicle.applyEngineForce(0, 2);
            this.vehicle.applyEngineForce(0, 3);
            this.vehicle.setBrake(10, 0);
            this.vehicle.setBrake(10, 1);
            this.vehicle.setBrake(10, 2);
            this.vehicle.setBrake(10, 3);
            return;
        }
        const maxSteerVal = 0.5;
        const maxForce = 6000;
        const brakeForce = 100;
        if (input.isAction('Left')) this.targetSteering = maxSteerVal;
        else if (input.isAction('Right')) this.targetSteering = -maxSteerVal;
        else this.targetSteering = 0;
        let force = 0;
        if (input.isAction('Forward')) force = -maxForce;
        if (input.isAction('Backward')) force = maxForce;
        this.vehicle.applyEngineForce(force, 2);
        this.vehicle.applyEngineForce(force, 3);
        if (input.isAction('Jump')) {
            this.vehicle.setBrake(brakeForce, 0);
            this.vehicle.setBrake(brakeForce, 1);
            this.vehicle.setBrake(brakeForce, 2);
            this.vehicle.setBrake(brakeForce, 3);
        } else {
            this.vehicle.setBrake(0, 0);
            this.vehicle.setBrake(0, 1);
            this.vehicle.setBrake(0, 2);
            this.vehicle.setBrake(0, 3);
        }
    }
}

// --- HELPER: Create Rigged Humanoid Mesh (Unchanged) ---
function createHumanoidMesh(customColor) {
    const playerGroup = new THREE.Group();
    playerGroup.userData.limbs = {};
    const blueMat = new THREE.MeshStandardMaterial({
        color: customColor || 0x0077ff,
        roughness: 0.3,
        metalness: 0.6,
        emissive: 0x002255,
        emissiveIntensity: 0.2
    });
    const blackMat = new THREE.MeshStandardMaterial({
        color: 0x111111,
        roughness: 0.8,
        metalness: 0.2
    });
    const headSize = 0.4;
    const torsoWidth = 0.6;
    const torsoDepth = 0.3;
    const torsoHeight = 0.8;
    const limbWidth = 0.2;
    const limbDepth = 0.2;
    const armLength = 0.7;
    const upperLegLen = 0.45;
    const lowerLegLen = 0.45;
    const footHeight = 0.12;
    const legTotal = upperLegLen + lowerLegLen + (footHeight * 0.5);
    const jointSize = 0.22;
    const torsoGroup = new THREE.Group();
    torsoGroup.position.y = legTotal;
    playerGroup.add(torsoGroup);
    const spineGroup = new THREE.Group();
    spineGroup.position.y = 0;
    torsoGroup.add(spineGroup);
    const torsoMesh = new THREE.Mesh(new THREE.BoxGeometry(torsoWidth, torsoHeight, torsoDepth), blueMat);
    torsoMesh.position.y = torsoHeight / 2;
    torsoMesh.castShadow = true;
    spineGroup.add(torsoMesh);
    const stripeMat = new THREE.MeshStandardMaterial({
        color: 0x00ffff,
        emissive: 0x00ffff,
        emissiveIntensity: 2.0
    });
    const s1 = new THREE.Mesh(new THREE.BoxGeometry(torsoWidth + 0.02, 0.05, torsoDepth + 0.02), stripeMat);
    s1.position.y = torsoHeight * 0.33;
    s1.castShadow = true;
    spineGroup.add(s1);
    const s2 = new THREE.Mesh(new THREE.BoxGeometry(torsoWidth + 0.02, 0.05, torsoDepth + 0.02), stripeMat);
    s2.position.y = torsoHeight * 0.66;
    s2.castShadow = true;
    spineGroup.add(s2);
    const head = new THREE.Mesh(new THREE.BoxGeometry(headSize, headSize, headSize), blueMat);
    head.position.y = torsoHeight + 0.1 + headSize / 2;
    head.castShadow = true;
    spineGroup.add(head);
    const eyeMat = new THREE.MeshBasicMaterial({
        color: 0xffffff
    });
    const eye1 = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.08, 0.05), eyeMat);
    eye1.position.set(-0.1, 0, -0.2);
    head.add(eye1);
    const eye2 = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.08, 0.05), eyeMat);
    eye2.position.set(0.1, 0, -0.2);
    head.add(eye2);

    function createArm(isLeft) {
        const armGroup = new THREE.Group();
        const xDir = isLeft ? -1 : 1;
        armGroup.position.set((torsoWidth / 2 + limbWidth / 2) * xDir, torsoHeight - 0.1, 0);
        const shoulder = new THREE.Mesh(new THREE.BoxGeometry(jointSize, jointSize, jointSize), blackMat);
        shoulder.castShadow = true;
        armGroup.add(shoulder);
        const armPart = new THREE.Mesh(new THREE.BoxGeometry(limbWidth, armLength, limbDepth), blueMat);
        armPart.position.y = -armLength / 2;
        armPart.castShadow = true;
        armGroup.add(armPart);
        const hand = new THREE.Mesh(new THREE.BoxGeometry(limbWidth, 0.1, limbDepth), blackMat);
        hand.position.y = -armLength;
        hand.castShadow = true;
        armGroup.add(hand);
        return armGroup;
    }
    const leftArm = createArm(true);
    const rightArm = createArm(false);
    spineGroup.add(leftArm);
    spineGroup.add(rightArm);

    function createLeg(isLeft) {
        const xDir = isLeft ? -1 : 1;
        const hipGroup = new THREE.Group();
        hipGroup.position.set((torsoWidth / 4) * xDir, 0, 0);
        const hipJoint = new THREE.Mesh(new THREE.BoxGeometry(jointSize, jointSize, jointSize), blackMat);
        hipJoint.castShadow = true;
        hipGroup.add(hipJoint);
        const upperLeg = new THREE.Mesh(new THREE.BoxGeometry(limbWidth, upperLegLen, limbDepth), blueMat);
        upperLeg.position.y = -upperLegLen / 2;
        upperLeg.castShadow = true;
        hipGroup.add(upperLeg);
        const kneeGroup = new THREE.Group();
        kneeGroup.position.y = -upperLegLen;
        hipGroup.add(kneeGroup);
        const kneeJoint = new THREE.Mesh(new THREE.BoxGeometry(jointSize * 0.9, jointSize * 0.9, jointSize * 0.9), blackMat);
        kneeJoint.castShadow = true;
        kneeGroup.add(kneeJoint);
        const kneeCap = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.16, 0.05), blackMat);
        kneeCap.position.z = -0.12;
        kneeGroup.add(kneeCap);
        const lowerLeg = new THREE.Mesh(new THREE.BoxGeometry(limbWidth, lowerLegLen, limbDepth), blueMat);
        lowerLeg.position.y = -lowerLegLen / 2;
        lowerLeg.castShadow = true;
        kneeGroup.add(lowerLeg);
        const foot = new THREE.Mesh(new THREE.BoxGeometry(limbWidth + 0.02, footHeight, 0.35), blackMat);
        foot.position.y = -lowerLegLen - (footHeight / 2) + 0.02;
        foot.position.z = -0.1;
        foot.castShadow = true;
        kneeGroup.add(foot);
        return {
            hip: hipGroup,
            knee: kneeGroup
        };
    }
    const leftLeg = createLeg(true);
    const rightLeg = createLeg(false);
    torsoGroup.add(leftLeg.hip);
    torsoGroup.add(rightLeg.hip);
    leftLeg.hip.position.y = 0;
    rightLeg.hip.position.y = 0;
    playerGroup.userData.limbs = {
        spine: spineGroup,
        head: head,
        leftArm,
        rightArm,
        leftLegHip: leftLeg.hip,
        leftLegKnee: leftLeg.knee,
        rightLegHip: rightLeg.hip,
        rightLegKnee: rightLeg.knee,
        torso: torsoGroup,
        legTotalHeight: legTotal
    };
    return playerGroup;
}

// --- PHYSICS GUN ---
class PhysicsGun {
    constructor(camera, scene) {
        this.camera = camera;
        this.scene = scene;
        this.playerMesh = null;
        this.raycaster = new THREE.Raycaster();
        this.heldBody = null;
        this.holdDistance = 0;
        this.maxGrabDistance = 30;
        this.maxVisualDistance = 5000;
        this.isActive = true;
        this.isThirdPerson = false;
        this.isFreecam = false;

        const visuals = createGunMesh(true);
        this.gunGroup = visuals.gunGroup;
        this.rayMesh = visuals.rayMesh;
        this.gunGroup.position.set(0.3, -0.3, -0.5);
        this.camera.add(this.gunGroup);
        this.scene.add(this.rayMesh);
    }
    setActive(active) {
        this.isActive = active;
        this.gunGroup.visible = active;
        if (!active && this.heldBody) this.release();
    }
    setThirdPerson(isThird) {
        this.isThirdPerson = isThird;
        if (isThird && this.playerMesh) {
            const rightArm = this.playerMesh.userData.limbs.rightArm;
            rightArm.add(this.gunGroup);
            this.gunGroup.position.set(0, -0.55, -0.15);
            this.gunGroup.rotation.set(0, 0, 0);
        } else {
            this.camera.add(this.gunGroup);
            this.gunGroup.position.set(0.3, -0.3, -0.5);
            this.gunGroup.rotation.set(0, 0, 0);
        }
        this.gunGroup.visible = this.isActive;
    }
    release() {
        if (!this.heldBody) return;
        if (this.heldBody.type !== CANNON.Body.STATIC) this.heldBody.angularDamping = 0.01;
        this.heldBody = null;
        this.rayMesh.visible = false;
    }
    update(dt, input) {
        if (player) {
            player.gunState = {
                holding: this.isActive,
                firing: (!!this.heldBody || input.isAction('Fire')),
                dist: (this.heldBody ? this.holdDistance : this.maxVisualDistance)
            };
        }

        if (this.isThirdPerson) {
            if (this.playerMesh) this.playerMesh.updateMatrixWorld(true);
            if (this.isFreecam) this.gunGroup.rotation.x = 0;
            else this.gunGroup.rotation.x = this.camera.rotation.x;
        } else {
            this.camera.updateMatrixWorld();
        }
        const start = new THREE.Vector3(0, 0, -0.3);
        start.applyMatrix4(this.gunGroup.matrixWorld);

        if (input.isLocked && this.isActive) {
            if (input.isAction('Fire')) {
                this.rayMesh.visible = true;

                if (!this.heldBody) {
                    this.raycaster.setFromCamera(new THREE.Vector2(0, 0), this.camera);
                    const intersects = this.raycaster.intersectObjects(obstacles);

                    const direction = new THREE.Vector3();
                    this.camera.getWorldDirection(direction);
                    let endPoint = this.camera.position.clone().add(direction.multiplyScalar(this.maxVisualDistance));

                    if (intersects.length > 0) {
                        const hit = intersects[0];
                        endPoint.copy(hit.point);

                        if (hit.distance <= this.maxGrabDistance) {
                            let hitObj = hit.object;
                            while (hitObj && !hitObj.userData.body && hitObj.parent) hitObj = hitObj.parent;

                            const body = hitObj.userData.body;
                            if (body) {
                                this.heldBody = body;
                                this.holdDistance = hit.distance;
                                if (hitObj.userData.firebaseId) {
                                    network.claimObject(hitObj.userData.firebaseId);
                                }
                            }
                        }
                    }
                    this.rayMesh.position.copy(start);
                    this.rayMesh.lookAt(endPoint);
                    this.rayMesh.scale.set(1, 1, start.distanceTo(endPoint));
                } else {
                    if (input.isActionPressed('AltFire')) {
                        const fbId = this.heldBody.userData.mesh.userData.firebaseId;

                        if (this.heldBody.type === CANNON.Body.DYNAMIC) {
                            if (fbId) network.freezeObject(fbId);
                            this.heldBody.type = CANNON.Body.STATIC;
                            this.heldBody.velocity.set(0, 0, 0);
                            this.heldBody.angularVelocity.set(0, 0, 0);
                            this.heldBody.mass = 0;
                            this.heldBody.updateMassProperties();
                            this.release();
                            return;
                        } else if (this.heldBody.type === CANNON.Body.STATIC) {
                            if (fbId) network.unfreezeObject(fbId);
                            this.heldBody.type = CANNON.Body.DYNAMIC;
                            this.heldBody.mass = 50;
                            this.heldBody.wakeUp();
                            this.heldBody.updateMassProperties();
                        }
                    }

                    if (this.heldBody.type === CANNON.Body.DYNAMIC && input.scrollDelta !== 0) {
                        this.holdDistance -= input.scrollDelta * 0.02;
                        let minLimit = 2;
                        if (this.isThirdPerson) minLimit += 2.0;
                        this.holdDistance = Math.max(minLimit, Math.min(this.holdDistance, this.maxGrabDistance));
                    }

                    const direction = new THREE.Vector3();
                    this.camera.getWorldDirection(direction);
                    const targetPos = this.camera.position.clone().add(direction.multiplyScalar(this.holdDistance));

                    const currentPos = new THREE.Vector3(this.heldBody.position.x, this.heldBody.position.y, this.heldBody.position.z);

                    this.rayMesh.position.copy(start);
                    this.rayMesh.lookAt(currentPos);
                    this.rayMesh.scale.set(1, 1, start.distanceTo(currentPos));

                    if (this.heldBody.type === CANNON.Body.DYNAMIC) {
                        if (input.isAction('Rotate')) {
                            const rotSpeed = 0.002;
                            const mesh = this.heldBody.userData.mesh;
                            mesh.rotateOnWorldAxis(new THREE.Vector3(0, 1, 0), input.mouseDelta.x * rotSpeed);
                            const camRight = new THREE.Vector3(1, 0, 0).applyQuaternion(this.camera.quaternion);
                            mesh.rotateOnWorldAxis(camRight, input.mouseDelta.y * rotSpeed);
                            this.heldBody.quaternion.copy(mesh.quaternion);
                            this.heldBody.angularVelocity.set(0, 0, 0);

                            const vel = targetPos.sub(currentPos).multiplyScalar(10.0);
                            this.heldBody.velocity.set(vel.x, vel.y, vel.z);
                        } else {
                            const newPos = new THREE.Vector3().lerpVectors(currentPos, targetPos, 10 * dt);
                            const vel = newPos.sub(currentPos).multiplyScalar(1.0 / dt);
                            this.heldBody.velocity.set(vel.x, vel.y, vel.z);
                            this.heldBody.angularVelocity.scale(0.1, this.heldBody.angularVelocity);
                        }
                    }
                }
            } else {
                this.release();
                this.rayMesh.visible = false;
            }
        }
    }
}

function getWorldAABB(obj) {
    const halfX = obj.scale.x / 2;
    const halfY = obj.scale.y / 2;
    const halfZ = obj.scale.z / 2;
    const basisX = new THREE.Vector3(1, 0, 0).applyQuaternion(obj.quaternion);
    const basisY = new THREE.Vector3(0, 1, 0).applyQuaternion(obj.quaternion);
    const basisZ = new THREE.Vector3(0, 0, 1).applyQuaternion(obj.quaternion);
    const wx = Math.abs(basisX.x * halfX) + Math.abs(basisY.x * halfY) + Math.abs(basisZ.x * halfZ);
    const wy = Math.abs(basisX.y * halfX) + Math.abs(basisY.y * halfY) + Math.abs(basisZ.y * halfZ);
    const wz = Math.abs(basisX.z * halfX) + Math.abs(basisY.z * halfY) + Math.abs(basisZ.z * halfZ);
    return {
        x: wx,
        y: wy,
        z: wz
    };
}

class FirstPersonController {
    constructor(camera, scene) {
        this.camera = camera;
        this.scene = scene;
        this.position = new THREE.Vector3(0, 5, 0);
        this.velocity = new THREE.Vector3(0, 0, 0);
        this.rotation = new THREE.Euler(0, 0, 0, 'YXZ');
        this.onGround = false;
        this.health = 100;
        this.energy = 100;
        this.isDead = false;
        this.isGodMode = false;
        this.isInfiniteStamina = false;
        this.drivingCar = null;
        this.currentSpeed = 0;
        this.gunState = {
            holding: false,
            firing: false,
            dist: 0
        };
        this.smoothCarPos = new THREE.Vector3();
        this.smoothCarQuat = new THREE.Quaternion();
        this.carCamYaw = 0;
        this.carCamPitch = 0.2;
        this.walkSpeed = 10.0;
        this.sprintSpeed = 18.0;
        this.crouchSpeed = 4.0;
        this.jumpForce = 12.0;
        this.gravity = 30.0;
        this.sensitivity = 0.002;
        this.width = 0.6;
        this.heightStanding = 2.0;
        this.heightCrouching = 1.0;
        this.currentHeight = this.heightStanding;
        this.gun = null;
        this.isThirdPerson = false;
        this.playerMesh = createHumanoidMesh();
        this.playerMesh.visible = false;
        this.scene.add(this.playerMesh);
        this.animTime = 0;
        this.crouchFactor = 0;
        this.cameraRaycaster = new THREE.Raycaster();
        this.isFlying = false;
        this.isNoclip = false;
        this.isFreecam = false;
        this.isFreecamMove = false;
    }
    getCollision(x, y, z) {
        if (this.isNoclip) return null;
        const halfW = this.width / 2;
        for (const obs of obstacles) {
            if (this.drivingCar && obs === this.drivingCar.chassisMesh) continue;
            const size = getWorldAABB(obs);
            if (x - halfW < obs.position.x + size.x && x + halfW > obs.position.x - size.x && z - halfW < obs.position.z + size.z && z + halfW > obs.position.z - size.z && y < obs.position.y + size.y && y + this.currentHeight > obs.position.y - size.y) {
                return {
                    mesh: obs,
                    top: obs.position.y + size.y
                };
            }
        }
        return null;
    }
    applyFallDamage() {
        if (this.isNoclip || this.isFlying || this.isGodMode || this.drivingCar) return;
        if (this.velocity.y < -24) {
            const damage = (Math.abs(this.velocity.y) - 20) * 3.0;
            this.health = Math.max(0, this.health - damage);
        }
    }
    die() {
        if (this.isDead) return;
        this.isDead = true;
        document.getElementById('death-screen').style.display = 'flex';
        document.exitPointerLock();
    }
    respawn() {
        this.isDead = false;
        this.health = 100;
        this.energy = 100;
        this.position.set(0, 5, 0);
        this.velocity.set(0, 0, 0);
        if (this.drivingCar) this.exitVehicle();
        document.getElementById('death-screen').style.display = 'none';
        document.body.requestPointerLock();
    }
    updateCarCamera(input, dt) {
        if (!this.drivingCar) return;
        this.smoothCarPos.lerp(this.drivingCar.chassisMesh.position, 0.2);
        this.smoothCarQuat.slerp(this.drivingCar.chassisMesh.quaternion, 0.1);
        if (this.isThirdPerson) {
            if (input.isLocked) {
                this.carCamYaw -= input.mouseDelta.x * 0.002;
                this.carCamPitch -= input.mouseDelta.y * 0.002;
                this.carCamPitch = Math.max(-0.5, Math.min(1.0, this.carCamPitch));
            }
            const idealDist = 8.0;
            const offsetX = idealDist * Math.sin(this.carCamYaw) * Math.cos(this.carCamPitch);
            const offsetY = idealDist * Math.sin(this.carCamPitch);
            const offsetZ = idealDist * Math.cos(this.carCamYaw) * Math.cos(this.carCamPitch);
            const idealPos = this.smoothCarPos.clone().add(new THREE.Vector3(offsetX, offsetY + 2.5, offsetZ));
            const direction = idealPos.clone().sub(this.smoothCarPos).normalize();
            const distance = this.smoothCarPos.distanceTo(idealPos);
            this.cameraRaycaster.set(this.smoothCarPos, direction);
            const hits = this.cameraRaycaster.intersectObjects(cameraColliders);
            let finalPos = idealPos;
            if (hits.length > 0 && hits[0].distance < distance) {
                const hitDist = Math.max(0.5, hits[0].distance - 0.5);
                finalPos = this.smoothCarPos.clone().add(direction.multiplyScalar(hitDist));
            }
            this.camera.position.lerp(finalPos, 0.2);
            this.camera.lookAt(this.smoothCarPos);
        } else {
            if (input.isLocked) {
                this.rotation.y -= input.mouseDelta.x * 0.002;
                this.rotation.x -= input.mouseDelta.y * 0.002;
                this.rotation.x = Math.max(-Math.PI / 2, Math.min(Math.PI / 2, this.rotation.x));
            }
            const seatOffset = new THREE.Vector3(0, 1.2, 0.5);
            seatOffset.applyQuaternion(this.smoothCarQuat);
            const camPos = this.smoothCarPos.clone().add(seatOffset);
            this.camera.position.copy(camPos);
            const lookDir = new THREE.Vector3(0, 0, 1);
            lookDir.applyEuler(new THREE.Euler(this.rotation.x, this.rotation.y + Math.PI, 0));
            lookDir.applyQuaternion(this.smoothCarQuat);
            const lookTarget = camPos.clone().add(lookDir);
            this.camera.lookAt(lookTarget);
            const upVec = new THREE.Vector3(0, 1, 0).applyQuaternion(this.smoothCarQuat);
            this.camera.up.lerp(upVec, 0.1);
        }
    }
    enterVehicle(car) {
        this.drivingCar = car;
        this.playerMesh.visible = false;
        if (this.gun) this.gun.setActive(false);
        this.smoothCarPos.copy(car.chassisMesh.position);
        this.smoothCarQuat.copy(car.chassisMesh.quaternion);
        this.carCamYaw = Math.PI;
        this.carCamPitch = 0.2;
        this.rotation.set(0, 0, 0);
    }
    exitVehicle() {
        if (!this.drivingCar) return;
        const exitPos = this.drivingCar.chassisMesh.position.clone();
        exitPos.x += 2.5;
        exitPos.y += 1.0;
        this.position.copy(exitPos);
        this.camera.position.copy(this.position);
        this.camera.up.set(0, 1, 0);
        this.velocity.set(0, 0, 0);
        this.drivingCar.control(null);
        this.drivingCar = null;
        if (!this.isThirdPerson) this.playerMesh.visible = false;
        if (hotbarManager.activeSlot === 1) this.gun.setActive(true);
    }
    update(dt, input) {
        if (!network.isSpawned) return;
        if (this.health <= 0 && !this.isDead) this.die();
        if (this.isDead) return;
        if (document.activeElement === document.getElementById('chat-input')) return;
        if (input.isActionPressed('Inventory')) {
            const inv = document.getElementById('inventory-menu');
            if (inv.classList.contains('visible')) {
                inv.classList.remove('visible');
                game.input.lock();
            } else {
                document.getElementById('admin-menu').classList.remove('visible');
                inv.classList.add('visible');
                game.input.unlock();
            }
        }
        if (input.isActionPressed('AdminMenu')) {
            const adminMenu = document.getElementById('admin-menu');
            if (adminMenu.classList.contains('visible')) {
                adminMenu.classList.remove('visible');
                game.input.lock();
            } else {
                document.getElementById('inventory-menu').classList.remove('visible');
                adminMenu.classList.add('visible');
                game.input.unlock();
            }
        }
        if (this.drivingCar) {
            this.drivingCar.control(input);
            if (input.isActionPressed('Interact')) {
                this.exitVehicle();
            }
            if (input.isActionPressed('ToggleView')) {
                this.isThirdPerson = !this.isThirdPerson;
            }
            this.updateCarCamera(input, dt);
            return;
        }
        if (input.isActionPressed('ToggleView')) {
            this.isThirdPerson = !this.isThirdPerson;
            this.playerMesh.visible = this.isThirdPerson;
            if (this.gun) this.gun.setThirdPerson(this.isThirdPerson);
        }
        const isEffectiveThirdPerson = this.isThirdPerson || this.isFreecam;
        this.playerMesh.visible = isEffectiveThirdPerson;
        if (this.gun) {
            this.gun.setThirdPerson(isEffectiveThirdPerson);
            this.gun.isFreecam = this.isFreecam;
        }
        if (input.isActionPressed('Interact')) {
            const raycaster = new THREE.Raycaster();
            raycaster.setFromCamera(new THREE.Vector2(0, 0), this.camera);
            const intersects = raycaster.intersectObjects(obstacles, true);
            if (intersects.length > 0 && intersects[0].distance < 4) {
                let obj = intersects[0].object;
                while (obj.parent && !obj.userData.isCar) {
                    obj = obj.parent;
                }
                if (obj.userData.isCar) {
                    this.enterVehicle(obj.userData.carController);
                    return;
                }
            }
        }
        if (this.isFreecam && input.isLocked) {
            if (!this.isFreecamMove) {
                const sensitivity = 0.002;
                const camEuler = new THREE.Euler().setFromQuaternion(this.camera.quaternion, 'YXZ');
                camEuler.y -= input.mouseDelta.x * sensitivity;
                camEuler.x -= input.mouseDelta.y * sensitivity;
                camEuler.x = Math.max(-Math.PI / 2, Math.min(Math.PI / 2, camEuler.x));
                this.camera.quaternion.setFromEuler(camEuler);
                let flySpeed = 20.0 * dt;
                if (input.isAction('Sprint')) flySpeed *= 2.0;
                const forward = new THREE.Vector3(0, 0, -1).applyQuaternion(this.camera.quaternion);
                const right = new THREE.Vector3(1, 0, 0).applyQuaternion(this.camera.quaternion);
                const up = new THREE.Vector3(0, 1, 0);
                if (input.isAction('Forward')) this.camera.position.add(forward.multiplyScalar(flySpeed));
                if (input.isAction('Backward')) this.camera.position.sub(forward.multiplyScalar(flySpeed));
                if (input.isAction('Right')) this.camera.position.add(right.multiplyScalar(flySpeed));
                if (input.isAction('Left')) this.camera.position.sub(right.multiplyScalar(flySpeed));
                if (input.isAction('Jump')) this.camera.position.add(up.multiplyScalar(flySpeed));
                if (input.isAction('Crouch')) this.camera.position.sub(up.multiplyScalar(flySpeed));
                return;
            }
        }
        let moveX = 0,
            moveZ = 0,
            moveY = 0;
        let speed = 0;
        let direction = new THREE.Vector3(0, 0, 0);
        if (input.isLocked) {
            let freezeLook = false;
            if (this.gun && this.gun.heldBody && this.gun.heldBody.type !== CANNON.Body.STATIC && input.isAction('Rotate')) freezeLook = true;
            if (!freezeLook) {
                this.rotation.y -= input.mouseDelta.x * this.sensitivity;
                this.rotation.x -= input.mouseDelta.y * this.sensitivity;
                this.rotation.x = Math.max(-Math.PI / 2, Math.min(Math.PI / 2, this.rotation.x));
            }
            if (input.isAction('Sprint') && (this.energy > 0 || this.isInfiniteStamina)) {
                speed = this.sprintSpeed;
                if (direction.length() > 0 || input.isAction('Forward')) {
                    if (!this.isInfiniteStamina) this.energy -= 20 * dt;
                }
            } else {
                speed = this.walkSpeed;
                if (this.energy < 100) this.energy += 10 * dt;
            }
            this.energy = Math.max(0, Math.min(100, this.energy));
            if (input.isAction('Crouch')) {
                if (this.onGround) speed = this.crouchSpeed;
            }
            if (this.isFlying || this.isNoclip) speed *= 1.5;
            let forward,
                right;
            if (this.isNoclip) {
                forward = new THREE.Vector3(0, 0, -1).applyEuler(this.rotation);
                right = new THREE.Vector3(1, 0, 0).applyEuler(this.rotation);
            } else {
                forward = new THREE.Vector3(0, 0, -1).applyAxisAngle(new THREE.Vector3(0, 1, 0), this.rotation.y);
                right = new THREE.Vector3(1, 0, 0).applyAxisAngle(new THREE.Vector3(0, 1, 0), this.rotation.y);
            }
            if (input.isAction('Forward')) direction.add(forward);
            if (input.isAction('Backward')) direction.sub(forward);
            if (input.isAction('Right')) direction.add(right);
            if (input.isAction('Left')) direction.sub(right);
            if (direction.length() > 0) direction.normalize();
            moveX = direction.x * speed * dt;
            moveZ = direction.z * speed * dt;
            moveY = direction.y * speed * dt;
        }
        this.position.x += moveX;
        if (this.getCollision(this.position.x, this.position.y, this.position.z)) this.position.x -= moveX;
        this.position.z += moveZ;
        if (this.getCollision(this.position.x, this.position.y, this.position.z)) this.position.z -= moveZ;
        if (this.isFlying || this.isNoclip) {
            this.velocity.y = 0;
            if (this.isNoclip) this.position.y += moveY;
            if (input.isLocked && input.isAction('Jump')) this.position.y += speed * dt;
            if (input.isLocked && input.isAction('Crouch')) this.position.y -= speed * 3.0 * dt;
        } else {
            this.velocity.y -= this.gravity * dt;
            if (input.isLocked && input.isAction('Jump') && this.onGround && !input.isAction('Crouch')) {
                if (this.energy >= 15 || this.isInfiniteStamina) {
                    this.velocity.y = this.jumpForce;
                    this.onGround = false;
                    if (!this.isInfiniteStamina) this.energy -= 15;
                }
            }
            this.position.y += this.velocity.y * dt;
        }
        const targetHeight = (input.isLocked && input.isAction('Crouch')) ? this.heightCrouching : this.heightStanding;
        this.currentHeight += (targetHeight - this.currentHeight) * 15 * dt;
        const targetCrouch = (input.isLocked && input.isAction('Crouch')) ? 1.0 : 0.0;
        this.crouchFactor += (targetCrouch - this.crouchFactor) * 10 * dt;
        const colY = this.getCollision(this.position.x, this.position.y, this.position.z);
        if (colY && !this.isNoclip) {
            if (this.velocity.y < 0) this.applyFallDamage();
            if (this.velocity.y < 0) {
                this.position.y = colY.top;
                this.velocity.y = 0;
                this.onGround = true;
            } else if (this.velocity.y > 0) {
                this.position.y = colY.top - this.currentHeight - 0.01;
                this.velocity.y = 0;
            }
        } else {
            this.onGround = false;
        }
        if (this.position.y < 0 && !this.isNoclip) {
            this.applyFallDamage();
            this.position.y = 0;
            this.velocity.y = 0;
            this.onGround = true;
        }
        if (!this.isFreecam) {
            this.camera.rotation.copy(this.rotation);
            this.camera.position.copy(this.position);
            this.camera.position.y += this.currentHeight;
        }
        this.playerMesh.position.copy(this.position);
        this.playerMesh.rotation.set(0, this.rotation.y, 0);
        const actualHSpeed = Math.sqrt(moveX * moveX + moveZ * moveZ) / dt;
        this.currentSpeed = actualHSpeed;
        updateLimbVisuals(this.playerMesh, this.crouchFactor, dt, this.currentSpeed, !this.onGround);
        if (this.isThirdPerson && !this.isNoclip && !this.isFreecam) {
            const idealDist = 3.5;
            const camDir = new THREE.Vector3(0, 0, 1).applyQuaternion(this.camera.quaternion);
            this.cameraRaycaster.set(this.camera.position, camDir);
            const hits = this.cameraRaycaster.intersectObjects(cameraColliders);
            let realDist = idealDist;
            if (hits.length > 0) {
                if (hits[0].distance < idealDist) realDist = Math.max(0.5, hits[0].distance - 0.2);
            }
            this.camera.translateZ(realDist);
        } else if (this.isThirdPerson && !this.isFreecam) {
            this.camera.translateZ(3.5);
        }
    }
}

const hotbarManager = {
    activeSlot: 1,
    update: (dt, input) => {
        if (!network.isSpawned) return;
        for (let i = 1; i <= 9; i++) {
            if (input.isActionPressed('Slot' + i)) hotbarManager.setSlot(i);
        }
    },
    setSlot: (slot) => {
        document.querySelectorAll('.slot').forEach(el => el.classList.remove('active'));
        document.getElementById('slot-' + slot).classList.add('active');
        hotbarManager.activeSlot = slot;
        if (slot === 1) physicsGun.setActive(true);
        else physicsGun.setActive(false);
    }
};
const game = new Engine3D();

game.add({
    update: (dt) => {
        world.step(1 / 60, dt, 3);
        for (const cube of obstacles) {
            if (cube.userData.body) {
                cube.position.copy(cube.userData.body.position);
                cube.quaternion.copy(cube.userData.body.quaternion);
            }
        }
    }
});

const car1 = new Car(game.scene, world, new CANNON.Vec3(10, 5, 10));
game.add({
    update: (dt, input) => car1.update(dt, input)
});

const player = new FirstPersonController(game.camera, game.scene);
game.add(player);

const network = new NetworkManager(game.scene, player);
network.init();
game.add(network);

const physicsGun = new PhysicsGun(game.camera, game.scene);
physicsGun.playerMesh = player.playerMesh;
game.add(physicsGun);
player.gun = physicsGun;
game.add(hotbarManager);

const interfaceUpdater = {
    update: () => {
        const fpsEl = document.getElementById('fps-display');
        if (fpsEl.style.display !== 'none') fpsEl.innerText = `FPS: ${game.fps}`;
        const coordEl = document.getElementById('coords-display');
        if (coordEl.style.display !== 'none') {
            const p = player.position;
            coordEl.innerText = `X:${p.x.toFixed(1)} Y:${p.y.toFixed(1)} Z:${p.z.toFixed(1)}`;
        }
        document.getElementById('health-fill').style.width = player.health + '%';
        document.getElementById('energy-fill').style.width = player.energy + '%';
    }
};
game.add(interfaceUpdater);

const hemiLight = new THREE.HemisphereLight(0xffffff, 0x444444, 0.6);
game.add(hemiLight);
const dirLight = new THREE.DirectionalLight(0xffffff, 1.5);
dirLight.position.set(50, 100, 50);
dirLight.castShadow = true;
dirLight.shadow.mapSize.width = 2048;
dirLight.shadow.mapSize.height = 2048;
dirLight.shadow.camera.left = -50;
dirLight.shadow.camera.right = 50;
dirLight.shadow.camera.top = 50;
dirLight.shadow.camera.bottom = -50;
dirLight.shadow.bias = -0.0005;
game.add(dirLight);
const floorMat = new THREE.MeshStandardMaterial({
    map: darkGrid,
    roughness: 0.8,
    metalness: 0.2
});
const floor = new THREE.Mesh(new THREE.PlaneGeometry(200, 200), floorMat);
floor.rotation.x = -Math.PI / 2;
floor.receiveShadow = true;
game.add(floor);
cameraColliders.push(floor);
const floorShape = new CANNON.Plane();
const floorBody = new CANNON.Body({
    mass: 0,
    material: defaultMaterial
});
floorBody.addShape(floorShape);
floorBody.quaternion.setFromEuler(-Math.PI / 2, 0, 0);
world.addBody(floorBody);

function updateSliderLabel(sliderId, displayId, defaultValue) {
    const slider = document.getElementById(sliderId);
    const display = document.getElementById(displayId);
    const check = () => {
        if (sliderId === 'opt-shadows') {
            const vals = ['OFF', 'LOW', 'HIGH'];
            display.innerText = vals[slider.value];
        } else if (sliderId === 'opt-preset') {
            const vals = ['PERFORMANCE', 'BALANCED', 'HIGH', 'ULTRA'];
            display.innerText = vals[slider.value];
        } else if (sliderId === 'opt-res') {
            display.innerText = slider.value + '%';
        } else {
            if (parseInt(slider.value) === defaultValue) display.innerText = slider.value + " (default)";
            else display.innerText = slider.value;
        }
    };
    check();
    return (e) => {
        check();
        return parseInt(e.target.value);
    };
}

let activeDragElement = null;
let offsetX = 0;
let offsetY = 0;

function enterEditMode(elementId, displayName) {
    const el = document.getElementById(elementId);
    const menu = document.getElementById('pause-menu');
    const toolbar = document.getElementById('edit-toolbar');
    const nameLabel = document.getElementById('edit-target-name');
    const colorInput = document.getElementById('edit-color');
    const sizeInput = document.getElementById('edit-size');
    const posButton = document.getElementById('edit-pos-btn');
    const finishBtn = document.getElementById('btn-finish-edit');
    menu.classList.add('editing');
    toolbar.classList.add('visible');
    el.classList.add('draggable');
    const wasVisible = el.style.display !== 'none';
    el.style.display = 'block';
    nameLabel.innerText = displayName;
    colorInput.value = "#ffffff";
    sizeInput.value = parseInt(window.getComputedStyle(el).fontSize) || 16;
    colorInput.oninput = (e) => el.style.color = e.target.value;
    sizeInput.oninput = (e) => el.style.fontSize = e.target.value + 'px';
    const corners = [{
        name: "Top Left",
        style: {
            top: '10px',
            left: '10px',
            right: 'auto',
            bottom: 'auto'
        }
    }, {
        name: "Top Right",
        style: {
            top: '10px',
            right: '10px',
            left: 'auto',
            bottom: 'auto'
        }
    }, {
        name: "Bottom Right",
        style: {
            bottom: '10px',
            right: '10px',
            top: 'auto',
            left: 'auto'
        }
    }, {
        name: "Bottom Left",
        style: {
            bottom: '10px',
            left: '10px',
            top: 'auto',
            right: 'auto'
        }
    }];
    let cornerIdx = 0;
    posButton.onclick = () => {
        cornerIdx = (cornerIdx + 1) % 4;
        const c = corners[cornerIdx];
        posButton.innerText = c.name;
        Object.assign(el.style, c.style);
    };
    const onMouseDown = (e) => {
        activeDragElement = el;
        offsetX = e.clientX - el.getBoundingClientRect().left;
        offsetY = e.clientY - el.getBoundingClientRect().top;
    };
    el.addEventListener('mousedown', onMouseDown);
    finishBtn.onclick = () => {
        menu.classList.remove('editing');
        toolbar.classList.remove('visible');
        el.classList.remove('draggable');
        if (!wasVisible && !document.getElementById(`ui-${elementId.split('-')[0]}-show`).checked) el.style.display = 'none';
        el.removeEventListener('mousedown', onMouseDown);
        finishBtn.onclick = null;
        colorInput.oninput = null;
        sizeInput.oninput = null;
        posButton.onclick = null;
    };
}
window.addEventListener('mousemove', (e) => {
    if (activeDragElement) {
        activeDragElement.style.left = (e.clientX - offsetX) + 'px';
        activeDragElement.style.top = (e.clientY - offsetY) + 'px';
        activeDragElement.style.bottom = 'auto';
        activeDragElement.style.right = 'auto';
    }
});
window.addEventListener('mouseup', () => {
    activeDragElement = null;
});

window.onload = () => {
    console.log("Game Loaded");
    const menu = document.getElementById('pause-menu');
    const instructions = document.getElementById('instructions');
    const invGrid = document.getElementById('inv-grid-container');
    const loginScreen = document.getElementById('login-screen');
    const nameInput = document.getElementById('player-name-input');
    const joinBtn = document.getElementById('btn-join');

    const joinGame = () => {
        if (!nameInput) return;
        const name = nameInput.value.trim().substring(0, 12);
        if (name.length > 0) {
            network.spawn(name);
            if (loginScreen) loginScreen.style.display = 'none';
            instructions.style.display = 'block';
            document.getElementById('status-bars').style.display = 'flex';
            const hb = document.getElementById('hotbar');
            if (hb) hb.style.display = 'flex';
            const cc = document.getElementById('chat-container');
            if (cc) cc.style.display = 'flex';
            const ch = document.getElementById('crosshair');
            if (ch) ch.style.display = 'block';
            game.input.lock();
        } else {
            nameInput.style.borderColor = '#ff4444';
            setTimeout(() => nameInput.style.borderColor = '#444', 500);
        }
    };

    if (joinBtn) joinBtn.addEventListener('click', joinGame);
    if (nameInput) nameInput.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') joinGame();
    });

    if (invGrid) {
        invGrid.innerHTML = '';
        for (let i = 0; i < 15; i++) {
            const s = document.createElement('div');
            s.className = 'inv-slot';
            invGrid.appendChild(s);
        }
    }

    game.input.onUnlock = () => {
        const admin = document.getElementById('admin-menu');
        const inv = document.getElementById('inventory-menu');
        if (network.isSpawned && !admin.classList.contains('visible') && !inv.classList.contains('visible') && !player.isDead && !network.isChatting) {
            menu.classList.add('visible');
        }
    };
    game.input.onLock = () => {
        menu.classList.remove('visible');
        document.getElementById('admin-menu').classList.remove('visible');
        document.getElementById('inventory-menu').classList.remove('visible');
        instructions.style.opacity = 0;
        const chatContainer = document.getElementById('chat-container');
        const chatInput = document.getElementById('chat-input');
        if (chatContainer && chatContainer.classList.contains('active')) {
            chatContainer.classList.remove('active');
            chatInput.blur();
            network.isChatting = false;
        }
    };

    document.getElementById('btn-respawn').addEventListener('click', () => {
        player.respawn();
    });
    document.getElementById('instructions').addEventListener('click', () => game.input.lock());
    document.getElementById('btn-resume').addEventListener('click', () => game.input.lock());
    document.getElementById('btn-close-admin').addEventListener('click', () => {
        document.getElementById('admin-menu').classList.remove('visible');
        game.input.lock();
    });
    document.getElementById('cheat-fly').addEventListener('change', (e) => player.isFlying = e.target.checked);
    document.getElementById('cheat-noclip').addEventListener('change', (e) => player.isNoclip = e.target.checked);
    document.getElementById('cheat-freecam').addEventListener('change', (e) => player.isFreecam = e.target.checked);
    document.getElementById('cheat-freecam-move').addEventListener('change', (e) => player.isFreecamMove = e.target.checked);
    document.getElementById('cheat-god').addEventListener('change', (e) => player.isGodMode = e.target.checked);
    document.getElementById('cheat-stamina').addEventListener('change', (e) => player.isInfiniteStamina = e.target.checked);
    document.getElementById('opt-grab-dist').addEventListener('input', (e) => physicsGun.maxGrabDistance = updateSliderLabel('opt-grab-dist', 'val-grab', 30)(e));
    document.querySelectorAll('.tab-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
            document.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'));
            btn.classList.add('active');
            document.getElementById(btn.dataset.target).classList.add('active');
        });
    });
    document.querySelectorAll('.keybind-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            const action = btn.dataset.action;
            btn.classList.add('recording');
            btn.innerText = "Press key...";
            game.input.bindNextKey(action, (newCode) => {
                btn.innerText = newCode;
                btn.classList.remove('recording');
            });
        });
    });
    document.getElementById('ui-fps-show').addEventListener('change', (e) => document.getElementById('fps-display').style.display = e.target.checked ? 'block' : 'none');
    document.getElementById('ui-coords-show').addEventListener('change', (e) => document.getElementById('coords-display').style.display = e.target.checked ? 'block' : 'none');
    document.getElementById('btn-edit-fps').addEventListener('click', () => enterEditMode('fps-display', 'FPS Counter'));
    document.getElementById('btn-edit-coords').addEventListener('click', () => enterEditMode('coords-display', 'Coordinates'));
    document.getElementById('opt-fov').addEventListener('input', (e) => game.setFOV(updateSliderLabel('opt-fov', 'val-fov', 75)(e)));
    document.getElementById('opt-dist').addEventListener('input', (e) => game.setRenderDistance(updateSliderLabel('opt-dist', 'val-dist', 60)(e)));
    document.getElementById('opt-sens').addEventListener('input', (e) => player.sensitivity = updateSliderLabel('opt-sens', 'val-sens', 20)(e) / 10000);
    document.getElementById('opt-grav').addEventListener('input', (e) => player.gravity = updateSliderLabel('opt-grav', 'val-grav', 30)(e));
    document.getElementById('opt-jump').addEventListener('input', (e) => player.jumpForce = updateSliderLabel('opt-jump', 'val-jump', 12)(e));
    document.getElementById('opt-speed').addEventListener('input', (e) => player.walkSpeed = updateSliderLabel('opt-speed', 'val-speed', 10)(e));
    document.getElementById('opt-sprint').addEventListener('input', (e) => player.sprintSpeed = updateSliderLabel('opt-sprint', 'val-sprint', 18)(e));

    function applyGraphicsPreset(val) {
        const shadowSlider = document.getElementById('opt-shadows');
        const bloomCheck = document.getElementById('opt-bloom');
        const resSlider = document.getElementById('opt-res');
        if (val === 0) {
            shadowSlider.value = 0;
            bloomCheck.checked = false;
            resSlider.value = 75;
        } else if (val === 1) {
            shadowSlider.value = 1;
            bloomCheck.checked = false;
            resSlider.value = 100;
        } else if (val === 2) {
            shadowSlider.value = 2;
            bloomCheck.checked = true;
            resSlider.value = 100;
        } else if (val === 3) {
            shadowSlider.value = 2;
            bloomCheck.checked = true;
            resSlider.value = 100;
        }
        shadowSlider.dispatchEvent(new Event('input'));
        bloomCheck.dispatchEvent(new Event('change'));
        resSlider.dispatchEvent(new Event('input'));
    }
    document.getElementById('opt-preset').addEventListener('input', (e) => {
        updateSliderLabel('opt-preset', 'val-preset')(e);
        applyGraphicsPreset(parseInt(e.target.value));
    });
    document.getElementById('opt-shadows').addEventListener('input', (e) => {
        updateSliderLabel('opt-shadows', 'val-shadows')(e);
        const val = parseInt(e.target.value);
        if (val === 0) {
            game.setShadowsEnabled(false);
        } else {
            game.setShadowsEnabled(true);
            dirLight.shadow.mapSize.width = val === 1 ? 1024 : 2048;
            dirLight.shadow.mapSize.height = val === 1 ? 1024 : 2048;
            dirLight.shadow.map.dispose();
            dirLight.shadow.map = null;
        }
    });
    document.getElementById('opt-bloom').addEventListener('change', (e) => {
        game.setBloomEnabled(e.target.checked);
    });
    document.getElementById('opt-res').addEventListener('input', (e) => {
        updateSliderLabel('opt-res', 'val-res')(e);
        game.setResolutionScale(parseInt(e.target.value));
    });
    updateSliderLabel('opt-grab-dist', 'val-grab', 30);
    updateSliderLabel('opt-fov', 'val-fov', 75);
    updateSliderLabel('opt-dist', 'val-dist', 60);
    updateSliderLabel('opt-sens', 'val-sens', 20);
    updateSliderLabel('opt-grav', 'val-grav', 30);
    updateSliderLabel('opt-jump', 'val-jump', 12);
    updateSliderLabel('opt-speed', 'val-speed', 10);
    updateSliderLabel('opt-sprint', 'val-sprint', 18);
    updateSliderLabel('opt-preset', 'val-preset');
    updateSliderLabel('opt-shadows', 'val-shadows');
    updateSliderLabel('opt-res', 'val-res');

    // Start engine but wait for spawn
    game.start();
};