import * as admin from 'firebase-admin';
import { initializeApp, getApps } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { getStorage } from 'firebase-admin/storage';
import dotenv from 'dotenv';

dotenv.config();

let db;
let storage;

try {
    const apps = getApps();
    if (apps.length === 0) {
        const config = {
            credential: admin.credential.applicationDefault()
        };
        
        if (process.env.FIREBASE_PROJECT_ID) {
            config.storageBucket = `${process.env.FIREBASE_PROJECT_ID}.appspot.com`;
        }
        
        initializeApp(config);
        console.log('Firebase Admin initialized successfully');
    }
    
    db = getFirestore();
    storage = getStorage();
} catch (error) {
    console.error('Firebase Initialization Error:', error.message);
}

export { admin, db, storage };
