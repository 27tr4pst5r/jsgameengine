import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';

/* --- INPUT SYSTEM --- */
export class InputHandler {
    constructor() {
        this.keys = {}; this.pressKeys = {}; this.mouseDelta = { x: 0, y: 0 }; this.scrollDelta = 0; this.isLocked = false;
        // CHANGED: 'Voice' defaults to 'KeyT'
        this.bindings = { 'Forward': 'KeyW', 'Backward': 'KeyS', 'Left': 'KeyA', 'Right': 'KeyD', 'Jump': 'Space', 'Crouch': 'ShiftLeft', 'Sprint': 'ControlLeft', 'Rotate': 'KeyR', 'Inventory': 'KeyE', 'Interact' : 'KeyF', 'Fire': 'Mouse0', 'AltFire': 'Mouse2', 'ToggleView': 'KeyV', 'AdminMenu': 'Backquote', 'Chat': 'Enter', 'PlayerList': 'Tab', 'Voice': 'KeyT', 'Slot1': 'Digit1', 'Slot2': 'Digit2', 'Slot3': 'Digit3', 'Slot4': 'Digit4', 'Slot5': 'Digit5', 'Slot6': 'Digit6', 'Slot7': 'Digit7', 'Slot8': 'Digit8', 'Slot9': 'Digit9' };
        this.onUnlock = null; this.onLock = null; this.rebindCallback = null;
        window.addEventListener('contextmenu', (e) => e.preventDefault());
        window.addEventListener('keydown', (e) => { if (this.rebindCallback) { e.preventDefault(); this.rebindCallback(e.code); this.rebindCallback = null; return; } if (!this.keys[e.code]) this.pressKeys[e.code] = true; this.keys[e.code] = true; if (this.isLocked && e.code !== 'F12' && e.code !== 'F5' && e.code !== 'Escape') e.preventDefault(); });
        window.addEventListener('keyup', (e) => { if (!this.rebindCallback) this.keys[e.code] = false; });
        window.addEventListener('mousedown', (e) => { if (this.isLocked) { const code = 'Mouse' + e.button; if (!this.keys[code]) this.pressKeys[code] = true; this.keys[code] = true; } });
        window.addEventListener('mouseup', (e) => { this.keys['Mouse' + e.button] = false; });
        document.addEventListener('mousemove', (e) => { if (this.isLocked) { this.mouseDelta.x += e.movementX || 0; this.mouseDelta.y += e.movementY || 0; } });
        document.addEventListener('wheel', (e) => { if (this.isLocked) this.scrollDelta += e.deltaY; }, { passive: true });
        document.addEventListener('pointerlockchange', () => { this.isLocked = document.pointerLockElement === document.body; if (this.isLocked && this.onLock) this.onLock(); if (!this.isLocked && this.onUnlock) this.onUnlock(); });
        window.addEventListener('beforeunload', (e) => { e.preventDefault(); e.returnValue = ''; });
    }
    isAction(actionName) { return this.keys[this.bindings[actionName]] === true; }
    isActionPressed(actionName) { return this.pressKeys[this.bindings[actionName]] === true; }
    bindNextKey(actionName, onDone) { this.rebindCallback = (newCode) => { this.bindings[actionName] = newCode; if (onDone) onDone(newCode); }; }
    resetFrame() { this.mouseDelta.x = 0; this.mouseDelta.y = 0; this.scrollDelta = 0; this.pressKeys = {}; }
    lock() { document.body.requestPointerLock(); }
    unlock() { document.exitPointerLock(); }
}

/* --- THE 3D ENGINE --- */
export class Engine3D {
    constructor() {
        this.scene = new THREE.Scene();
        this.scene.background = new THREE.Color(0x87CEEB); 
        this.scene.fog = new THREE.FogExp2(0x87CEEB, 0.008);

        this.renderer = new THREE.WebGLRenderer({ antialias: false, powerPreference: "high-performance" });
        this.renderer.setSize(window.innerWidth, window.innerHeight);
        this.renderer.shadowMap.enabled = true;
        this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
        
        this.renderer.outputColorSpace = THREE.SRGBColorSpace;
        this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
        this.renderer.toneMappingExposure = 1.0;
        
        document.body.appendChild(this.renderer.domElement);

        this.camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.1, 1000);
        this.scene.add(this.camera);

        this.composer = new EffectComposer(this.renderer);
        this.renderPass = new RenderPass(this.scene, this.camera);
        this.composer.addPass(this.renderPass);

        this.bloomPass = new UnrealBloomPass(new THREE.Vector2(window.innerWidth, window.innerHeight), 1.5, 0.4, 0.85);
        this.bloomPass.threshold = 0.8;
        this.bloomPass.strength = 0.6;  
        this.bloomPass.radius = 0.5;   
        this.composer.addPass(this.bloomPass);

        this.outputPass = new OutputPass();
        this.composer.addPass(this.outputPass);

        this.updatables = [];
        this.input = new InputHandler();
        
        this.fps = 0; this.frames = 0; this.lastTime = performance.now(); this.fpsUpdateInterval = 100; 

        window.addEventListener('resize', () => {
            this.camera.aspect = window.innerWidth / window.innerHeight;
            this.camera.updateProjectionMatrix();
            this.renderer.setSize(window.innerWidth, window.innerHeight);
            this.composer.setSize(window.innerWidth, window.innerHeight);
        });
    }

    add(object) {
        if (object instanceof THREE.Object3D) { this.scene.add(object); } 
        else if (object.mesh) { this.scene.add(object.mesh); if (object.update) this.updatables.push(object); } 
        else if (object.update) { this.updatables.push(object); }
    }

    // --- GRAPHICS API ---
    setFOV(val) {
        this.camera.fov = val;
        this.camera.updateProjectionMatrix();
    }

    setRenderDistance(val) {
        this.camera.far = val;
        this.scene.fog.density = 1.5 / val;
        this.camera.updateProjectionMatrix();
    }

    setBloomEnabled(enabled) {
        this.bloomPass.enabled = enabled;
    }

    setShadowsEnabled(enabled) {
        this.renderer.shadowMap.enabled = enabled;
        // Trigger a re-compile of materials effectively by waking up the scene
        this.scene.traverse((child) => {
            if (child.material) child.material.needsUpdate = true;
        });
    }

    setResolutionScale(percent) {
        const scale = percent / 100;
        const w = window.innerWidth * scale;
        const h = window.innerHeight * scale;
        this.renderer.setSize(w, h, false); // false = prevent resizing the canvas DOM element
        this.composer.setSize(w, h);
        // Ensure DOM style stretches the lower res image
        this.renderer.domElement.style.width = window.innerWidth + 'px';
        this.renderer.domElement.style.height = window.innerHeight + 'px';
    }

    start() {
        const clock = new THREE.Clock();
        const animate = () => {
            requestAnimationFrame(animate);
            const dt = Math.min(clock.getDelta(), 0.1); 
            const now = performance.now();
            this.frames++;
            if (now >= this.lastTime + this.fpsUpdateInterval) {
                this.fps = Math.round((this.frames * 1000) / (now - this.lastTime));
                this.frames = 0; this.lastTime = now;
            }
            this.updatables.forEach(obj => obj.update(dt, this.input)); 
            this.composer.render();
            this.input.resetFrame();
        };
        animate();
    }
}