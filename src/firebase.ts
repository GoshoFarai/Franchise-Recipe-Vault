import { initializeApp } from 'firebase/app';
import { getAuth } from 'firebase/auth';
import { getFirestore } from 'firebase/firestore';

const firebaseConfig = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID,
  storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID,
  appId: import.meta.env.VITE_FIREBASE_APP_ID,
  firestoreDatabaseId: import.meta.env.VITE_FIREBASE_FIRESTORE_DATABASE_ID,
};

// Debug logging to help identify configuration source
const configSource = import.meta.env.VITE_FIREBASE_PROJECT_ID ? 'Secrets Panel' : 'Missing Configuration';
console.log(`[Firebase] Initializing with project: ${firebaseConfig.projectId} (Source: ${configSource})`);
console.log(`[Firebase] Database ID: ${firebaseConfig.firestoreDatabaseId}`);
console.log(`[Firebase] API Key (first 5): ${firebaseConfig.apiKey?.substring(0, 5)}...`);

if (!firebaseConfig.apiKey || !firebaseConfig.projectId) {
  console.error("[Firebase] CRITICAL: Missing API Key or Project ID in configuration!");
}

let app;
let auth: any;
let db: any;
let isFirebaseConfigured = false;

try {
  if (firebaseConfig.apiKey && firebaseConfig.projectId) {
    app = initializeApp(firebaseConfig);
    auth = getAuth(app);
    db = getFirestore(app, firebaseConfig.firestoreDatabaseId);
    isFirebaseConfigured = true;
  } else {
    console.warn("[Firebase] Skipping initialization: Missing API Key or Project ID.");
  }
} catch (error) {
  console.error("[Firebase] Initialization failed:", error);
}

export { auth, db, isFirebaseConfigured };
