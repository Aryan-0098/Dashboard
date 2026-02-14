
import { initializeApp, getApps, getApp } from "firebase/app";
import { getFirestore } from "firebase/firestore";

// Using Android config temporarily as web config wasn't provided.
// Ideally, user should create a Web App in Firebase console for better analytics/security.
const firebaseConfig = {
    apiKey: "AIzaSyCPGlDjT7EJ0ND3p5krO4GbP0vq9iv_UFM",
    authDomain: "sanary-8f0ed.firebaseapp.com",
    projectId: "sanary-8f0ed",
    storageBucket: "sanary-8f0ed.firebasestorage.app",
    messagingSenderId: "141945564139",
    appId: "1:141945564139:web:d2f6202ea250f2de9807ae", // Placeholder web app ID or same as Android (won't affect Firestore)
};

// Initialize Firebase
const app = !getApps().length ? initializeApp(firebaseConfig) : getApp();
const db = getFirestore(app);

export { db };
